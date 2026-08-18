# Deploying a release

How a Polaris release reaches a server, and the handful of rules that make the difference
between a deploy and an outage. It says nothing about *which* server: the supported way to
run Polaris is the compose file in this repository, described in
[`11-self-hosting.md`](11-self-hosting.md), and everything here holds whether that stack sits
behind its own Caddy, behind a proxy you already run, or behind something else entirely.

Deployment onto a machine that already has a shared reverse proxy — host names, container
naming, an automated deploy timer — is operator-specific and is not in this repository.

## Before anything: check the box has room

Polaris brings a database, and optionally an object store and a search index.

```bash
free -m                      # ~5 GB free for the full profile, ~3 GB lean
df -h /                      # 40+ GB headroom for Postgres growth
docker stats --no-stream     # what is already running on this machine
nproc                        # 4+ vCPU wanted; 2 is workable for a small team
```

If headroom is thin, run the **lean profile**: Postgres full-text search instead of
Meilisearch, a bind-mounted volume instead of MinIO. That is roughly a gigabyte saved and two
fewer services, and both are single-package swaps later (`internal/search`, `internal/files`).
The default compose file is already lean — the other two are opt-in profiles, which is why
`docker compose up` on a fresh clone starts a working stack and nothing else.

## Four rules that are not about Polaris

These are the ones worth stating because getting any of them wrong produces a failure that
looks like something else.

**Publish a port, or put the container on a proxy network — not both.** If something else on
the machine owns `:80` and `:443`, Polaris must not publish ports at all; the proxy reaches
the containers by name on a shared network. Publishing anyway means the app is reachable on a
high port without the proxy's TLS, its rate limits or its access log, and nothing will tell
you. The compose file in this repository publishes ports and runs its own Caddy, because that
is what a stranger cloning it needs; an operator behind an existing proxy overrides it.

**Nothing the proxy can route to may reach Postgres.** The web, API and sync containers sit on
the ingress network. The database, the cache, the object store and the search index sit on an
internal network only. A datastore on the ingress network is one hostname typo away from being
addressable from outside.

**Secrets come from a root-owned `600` file outside the repository.** Not from a committed
`.env`, not baked into an image, not passed on a command line where `ps` can read it. The
compose file interpolates them at start; nothing writes them anywhere the application user
can read.

**Every service carries a memory limit, a healthcheck and capped logging.** An unbounded
container takes the machine down with it rather than dying alone, an unhealthy one keeps
receiving traffic, and uncapped JSON logs fill the disk on a schedule nobody set. This is
cheap to add and expensive to retrofit at three in the morning.

## Deploy is publishing a release

```bash
git tag v1.4.0
git push origin main --tags
```

Never a manual `docker compose restart` against a dirty tree: the whole point is that what is
running can be named, and a hand-edited container cannot be.

### Sequence

1. CI builds and pushes the images, tagged with the release and the commit SHA.
2. The checkout is fast-forwarded and the tag written into the environment.
3. `docker compose pull` — images arrive before anything stops.
4. Migrations run to completion, holding an advisory lock. **A failed migration aborts the
   deploy before any new code starts**, which is the single most valuable step here.
5. `docker compose up -d` recreates api → sync → worker → web.
6. Health-check the public `/healthz`; on failure, roll back to the previous tag.

### Zero-downtime, honestly

With one replica per role there is a **2–5 second gap** when the API restarts and a dropped
socket when sync restarts. Clients keep rendering from their local replica and reconnect with
backoff, so in practice nobody sees it — a direct benefit of the local-first design rather
than something the deploy does cleverly. If you want true zero-downtime, run two replicas per
role behind the proxy and restart them one at a time; the processes are stateless and already
tolerate it.

### The rollback rule

A tag deploy reverts **code, not schema**. Migrations must therefore be additive and
compatible with the previous revision — see [`04-data-layer.md`](04-data-layer.md). A
migration that breaks release N-1 turns rollback into an outage, which is the one failure
mode this whole sequence exists to avoid.

## CI

| Job | Does |
|---|---|
| `lint` | `go vet`, `eslint`, and the cross-artefact discipline scripts under `scripts/` |
| `generate-check` | Regenerates gqlgen and sqlc output; fails if the tree is dirty |
| `test-go` | Unit and integration against a real Postgres, race detector on |
| `test-web` | Vitest, plus Playwright against a compose-up stack |
| `sync-conformance` | The property, permission and offline suites from [`03-sync-engine.md`](03-sync-engine.md) |
| `build-images` | Multi-arch, pushed to the registry, tagged with the git tag and SHA |
| `build-desktop` | macOS and Windows runners; signs, notarises and uploads to a GitHub Release |

Only the two `build-*` jobs run on tags; the rest run on every pull request.
