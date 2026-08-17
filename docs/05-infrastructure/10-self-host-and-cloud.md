# Two deployment modes: self-host and cloud

> **Status.** This document describes the intended design, and some of it is not built. As of
> milestone 1 there is no object store, no separate search service, no metrics endpoint and no
> job queue: attachments are unimplemented, search is Postgres full-text and trigram in the
> main database, nothing serves `/metrics`, and the worker is a ticker running idempotent jobs
> rather than a queue. `services/internal/platform/config.go` is the authority on what is
> configurable and [`11-self-hosting.md`](11-self-hosting.md) on what actually runs.
>
> Kept as a design document rather than trimmed to today's code, because the reasoning is
> still the plan. But a reader could not previously tell the two apart, and the failure that
> produces is somebody filing a bug against a subsystem nobody has written.

The repo is public, so `docker-compose.yml` must work for a stranger on a bare VPS. The fleet-specific arrangement (NPM, `webnet`, `<Prefix>_<role>`, root-owned env files) is **an override**, not the default. This revises `05-deployment-vps.md`, which assumed fleet-only.

## The three files

```
docker-compose.yml            # public default: self-contained, Caddy, publishes 80/443
docker-compose.fleet.yml      # our VPS: NPM ingress, webnet, no ports  (private repo or gitignored)
compose.dev.yml               # local dev: ports published, hot reload
```

Self-hoster:
```bash
git clone https://github.com/…/polaris && cd polaris
cp .env.example .env          # POLARIS_DOMAIN + POLARIS_EMAIL are the only required values
docker compose up -d
```

Us:
```bash
docker compose -f docker-compose.yml -f docker-compose.fleet.yml up -d
```

The fleet override drops `caddy`, removes every `ports:`, renames containers to `<Prefix>_<role>`, attaches `webnet`, and repoints `env_file` at `/root/.config/polaris/polaris.env`.

## Public default compose

Design goals: **one command, no required secrets, no external accounts.**

```yaml
name: polaris

services:
  caddy:                      # self-host only; the fleet override removes this
    image: caddy:2.9-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment:
      - POLARIS_DOMAIN=${POLARIS_DOMAIN}
      - POLARIS_EMAIL=${POLARIS_EMAIL}       # ACME registration
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

  api:
    image: ghcr.io/peixotolabs/polaris:${POLARIS_VERSION:-latest}   # core, AGPL
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgres://polaris:${POSTGRES_PASSWORD}@db:5432/polaris?sslmode=disable
      - REDIS_URL=redis://cache:6379
      - PUBLIC_URL=https://${POLARIS_DOMAIN}
      - FILES_DRIVER=${FILES_DRIVER:-filesystem}     # filesystem | s3
      - SEARCH_DRIVER=${SEARCH_DRIVER:-postgres}     # postgres | meilisearch
      - SECRET_FILE=/var/lib/polaris/secrets.json    # auto-generated on first boot
      - TELEMETRY=${TELEMETRY:-off}
    volumes: [polaris_state:/var/lib/polaris, polaris_files:/var/lib/polaris/files]
    depends_on: { db: {condition: service_healthy}, cache: {condition: service_healthy} }

  sync:   { image: ghcr.io/peixotolabs/polaris:${POLARIS_VERSION:-latest}, command: ["sync"],   … }
  worker: { image: ghcr.io/peixotolabs/polaris:${POLARIS_VERSION:-latest}, command: ["worker"], … }
  web:    { image: ghcr.io/peixotolabs/polaris-web:${POLARIS_VERSION:-latest}, … }

  db:
    image: postgres:17.2-alpine
    environment: [POSTGRES_USER=polaris, POSTGRES_DB=polaris, POSTGRES_PASSWORD=${POSTGRES_PASSWORD}]
    volumes: [polaris_db:/var/lib/postgresql/data]

  cache:
    image: valkey/valkey:8.0-alpine        # NOT redis:7.4 — see below
    command: ["valkey-server","--appendonly","yes"]
    volumes: [polaris_cache:/data]

  # opt-in extras
  search:
    profiles: ["meilisearch"]
    image: getmeili/meilisearch:v1.12
  files:
    profiles: ["s3"]
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
```

`docker compose --profile meilisearch --profile s3 up -d` for the full stack; the default is the lean one.

### Redis → Valkey
**Redis 7.4+ is RSALv2/SSPLv1 — not an OSI-approved licence.** Shipping it as a default dependency of an AGPL project invites a licensing argument you cannot win and that some corporate users' policies forbid outright. **Valkey 8** is the BSD-licensed fork, wire-compatible, drop-in for asynq and every Go client. Change it now, while it costs one line.

### Pluggable drivers
Two interfaces already exist in the design; self-host makes them load-bearing.

| Driver | Default (self-host) | Cloud | Interface |
|---|---|---|---|
| Files | `filesystem` (a volume) | `s3` (MinIO → R2 later) | `internal/files` |
| Search | `postgres` (FTS + trigram) | `meilisearch` | `internal/search` |
| Mail | `smtp` (BYO) or none | relay | `internal/mailer` |
| AI | BYO provider key | credits + managed keys | `internal/ai` |

A default install must run in **~1.5 GB RAM** — Postgres, Valkey, three Go processes, nginx. That is what makes "I put it on a €5 box" true, and that story is most of your adoption.

## First-run experience

This is the difference between 50 stars and 5,000. Budget real time for it.

1. `docker compose up -d` → containers healthy in under a minute.
2. First boot **generates its own secrets** (JWT key, session pepper, Postgres password if unset) into `/var/lib/polaris/secrets.json`, `0600`. No secret is *required* in `.env`.
3. Visiting the domain shows a **setup wizard**: create the first admin, name the workspace, choose whether to enable telemetry (default off), optional SMTP.
4. No email configured ⇒ magic-link URLs are printed to the container log and shown on screen. Requiring SMTP before first login is the most common way self-host onboarding fails.
5. Health page at `/healthz`; a diagnostics page at `/admin/system` showing versions, drivers, migration state, queue depth, and disk usage.

Also ship: `deploy/Caddyfile`, a Helm chart (community-maintainable), and a one-liner installer script that just wraps the compose steps for people who want one.

## Upgrades (self-host)

The upgrade path is a support surface — treat it as a feature.

```bash
polarisctl backup            # dumps DB + files, prints the path
docker compose pull
docker compose up -d         # migrate container runs first, holds an advisory lock
```

Rules:
- Migrations are **forward-only and additive** (already the rule for the fleet's rollback path — now also the rule for strangers with no PITR).
- Refuse to start if the binary is older than the schema, with a clear message rather than a crash loop.
- Refuse to skip past the supported upgrade window; tell the user which intermediate version to run.
- Release notes state whether `clientSchema` changed (users will see a one-time re-sync).
- `polarisctl doctor` checks connectivity, disk, migration state, drift, and orphaned files.

## What differs in cloud

Same images (plus `ee/`), different surroundings:

| Concern | Self-host | Cloud |
|---|---|---|
| Ingress | Caddy in-compose | NPM (fleet) |
| Edition | core | `-ee` image + entitlements from the plan |
| Signup | setup wizard, one workspace | waitlist → approval → invite → **many** workspaces on one deployment |
| Entitlement source | `oss` (unlimited) or licence key | `cloud_plan` from billing |
| Quotas | none | per-workspace issues/storage/API, enforced at write time |
| Backups | user's problem (`polarisctl backup` + docs) | pgBackRest + PITR + offsite, drilled monthly |
| Secrets | auto-generated | `/root/.config/polaris/polaris.env` |
| Telemetry | opt-in | operational metrics (first-party, disclosed in the privacy policy) |
| Region | wherever they put it | **EU** |

**Multi-tenancy is already handled**: `workspace_id` on every table, one visibility predicate, per-workspace sync versions. The cloud additions are signup, billing, quotas, and abuse control — not a data-model change. That's the payoff for the earlier decision.

## Residency, simplified

EU-only removes the Phase E regional split from `09-scaling-and-cost.md` entirely.

- **Cloud**: single EU deployment. Say so plainly in the privacy policy and the DPA — "your data is stored in the EU and never leaves it" is a genuine advantage against US-hosted competitors and costs you nothing.
- **Self-host**: residency is whatever the operator's hardware is. Document that it's their call.
- Subprocessors that touch data must also be EU or have adequacy/SCCs: SMTP relay (SES `eu-west-1` or a European provider), error tracking (self-host or EU region), backup storage (Backblaze EU or R2 with EU jurisdiction). **AI providers are the awkward one** — most are US. Disclose them explicitly, keep AI features opt-in per workspace, and offer an EU/self-hosted model option for customers who require it.

## Abuse and cost control (freemium on one VPS)

Invite-only removes the urgency but not the requirement. Before opening signup:

| Control | Mechanism |
|---|---|
| Signup gate | Waitlist + manual approval; email verification mandatory |
| Per-IP caps | Signup and magic-link rate limits, disposable-domain blocklist |
| Storage quota | Enforced at presign — never after the bytes land |
| Issue/API quotas | Counted per workspace, checked at write, surfaced in settings |
| Bootstrap cost | Rate-limited per user (already specced); the dominant free-tier cost |
| Outbound email | Per-workspace hourly cap — a free workspace must never become a spam relay |
| Attachment scanning | Before serving to anyone else |
| Idle reaping | Free workspaces with no login for 6 months: warn, then archive (never silently delete) |
| Kill switch | Per-workspace suspend, reachable in one command |

Model the worst case honestly: 1,000 free workspaces × 1 GB = 1 TB, which the VPS does not have. Storage quota enforcement is therefore **launch-blocking for open signup**, not a later refinement.

## Revised deployment checklist

- [ ] Public `docker-compose.yml` verified on a clean €5 VPS by someone who didn't write it
- [ ] Fleet override in a private repo; nothing fleet-specific in the public tree
- [ ] Valkey substituted for Redis
- [ ] filesystem + postgres drivers are the defaults and are actually tested
- [ ] First-run wizard works with no SMTP configured
- [ ] `polarisctl backup` / `doctor` / `migrate` documented
- [ ] Upgrade tested across two minor versions
- [ ] Quota enforcement in place before open signup
- [ ] Privacy policy, DPA, subprocessor list published before the first cloud user
