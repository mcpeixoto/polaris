# Self-hosting Polaris

This document is for somebody who administers machines, has never seen this codebase, and
wants to run Polaris for their own organisation. It describes what the code does today, not
what the design documents in this directory plan for it — several of those describe object
storage, a search service, a job queue and a metrics endpoint that are specified but not yet
wired up, and a runbook that sends you looking for them wastes an afternoon. Where something
in the compose files or the older documents implies a component that nothing connects to,
this document says so rather than leaving you to find out.

Everything below was checked against `services/internal/platform/config.go`, the `Makefile`,
the compose files and `services/migrations/`. If this document and one of those disagree,
the source is right and this is a bug.

## What you are actually running

Four binaries are built from one image (`services/Dockerfile`), and `command:` selects which
one a container runs. They share a revision by construction, which is the point: three
separately built services can disagree about the GraphQL schema, and this arrangement makes
that impossible.

| Process | Listens on | Serves | Fails how |
|---|---|---|---|
| `api` | `:8088` | GraphQL, auth, the bootstrap snapshot | The app cannot load or mutate anything |
| `sync` | `:8089` | The WebSocket delta hub | Clients keep working offline and stop seeing each other's changes |
| `worker` | nothing | Partition creation, retention pruning, email digests | Silently, for weeks, and then all at once — see below |
| `polarisctl` | — | Migrations and maintenance, run to completion | — |

Plus a static bundle: `web/` builds an SPA and serves it from nginx on `:8080`. It is the
same bundle the desktop app ships.

**One datastore.** Postgres holds everything: entities, the sync change log, sessions,
idempotency keys, the full-text indexes. The sync fan-out is `LISTEN`/`NOTIFY` on the same
connection pool, not a message broker. Rate-limit counters live in each process's memory.

The bundled `docker-compose.yml` also starts a Valkey container and offers MinIO and
Meilisearch behind profiles. **Nothing in the Go code connects to any of them today** —
there is no Redis client in `services/go.mod`, and no `internal/files` or `internal/search`
package for the S3 and Meilisearch variables in `.env.example` to configure. They are
placed for work that is planned. You can run the whole product without them; if you are
sizing a box, do not budget for them.

## What it needs

### PostgreSQL

**Version 17.** The compose files pin `postgres:17.2-alpine` and CI runs the same. Nothing
in the schema requires 17 specifically, but nothing is tested below it either.

Three extensions, created by the first migration:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes, for uuid_generate_v7()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram indexes on titles and names
CREATE EXTENSION IF NOT EXISTS unaccent;   -- diacritic folding for search and filters
```

All three ship with a stock Postgres install, but creating an extension needs a privileged
role. **This rules out any managed Postgres that does not offer these three**, and it means
the role in `DATABASE_URL` must be able to create extensions on the first run — not merely
own the schema. If your provider pre-installs extensions and forbids `CREATE EXTENSION`, the
`IF NOT EXISTS` makes migration 1 a no-op and you are fine; if it does neither, Polaris will
not start.

`unaccent` deserves a warning that only bites later. `search_fold()` is declared `IMMUTABLE`
so it can be used in index expressions, and that is a promise about a rules file on disk. A
Postgres **major** version upgrade can ship a different `unaccent.rules`, at which point the
existing index entries were folded by the old rules and incoming queries by the new — a
handful of rows quietly stop matching. Reindex after a major upgrade; see *Upgrades*.

Create the database with a deterministic collation, or two installs will sort the same issue
list differently and you will chase it as an application bug:

```
POSTGRES_INITDB_ARGS="--locale-provider=icu --icu-locale=en-US --encoding=UTF8"
```

This can only be set at `initdb` time. Changing it later means a dump and reload.

### Memory

The interesting number is not the steady state, it is the login spike.

| Component | Budget | Why |
|---|---|---|
| Postgres | 1–2 GB | `shared_buffers` plus per-connection backends at roughly 10 MB each |
| `api` | 512 MB | See the argon2 note below — this is the one that spikes |
| `sync` | 256–512 MB | Connection-bound. Memory scales with concurrent sockets, not with request rate |
| `worker` | 128 MB | It sleeps almost always |
| web (nginx) | 64 MB | Serving static files |
| Reverse proxy | 128 MB | Whatever you use |

Passwords are hashed with argon2id at **64 MiB per hash** (`services/internal/auth/password.go`).
That memory is allocated for the duration of one hash, on every sign-in *and every failed
sign-in attempt*. Eight simultaneous logins is half a gigabyte of transient allocation in the
`api` process. On a 1 GB box a burst of sign-ins — everyone arriving on Monday morning, or
somebody spraying passwords at your login endpoint — is what will OOM-kill the API, not the
issue list. The per-account login limiter (ten attempts per ten minutes, by default) is the
thing that bounds the hostile version of this; the Monday-morning version is bounded by
having the RAM.

**Roughly 2.5 GB for a comfortable small install, 1.5 GB if you are careful and few people
sign in at once.**

### Disk

Postgres is the only thing that grows. There is no attachment storage in this build, so
there is no second growth curve to plan for.

| Table | Growth | Bounded by |
|---|---|---|
| `issue`, `comment`, `label`, … | With the work | Nothing. This is your data |
| `issue_history` | ~25 rows per issue | Nothing today. Retained deliberately |
| `change_log` | One row per mutation, ~1.2 KB | 30 days, pruned by dropping monthly partitions |
| `idempotency_key` | One row per mutation | 24 hours, pruned hourly |
| `account_session` | One per device per 30 days | Refresh token TTL, pruned daily |

A busy workspace of 100k issues lands in the low single-digit gigabytes. **Budget 20 GB and
alert at 80%.** The failure mode of a full disk is that Postgres stops accepting writes,
which presents to users as the entire product being read-only, and recovering needs free
space you no longer have.

### CPU

Two cores is enough for a team. The API is database-bound rather than CPU-bound, with the
exception of argon2 during sign-in — which is deliberately expensive and is a per-core cost.

## Configuration

`services/internal/platform/config.go` is the whole of the tunable surface. If a variable is
not in the table below, **nothing reads it** — including several in `.env.example` and in the
older documents in this directory. The process reads the environment once at startup and
refuses to start on a bad value rather than starting and failing on the first request; a
container that will not come up is a much louder signal than one that 500s intermittently.

### Required

Two, and only two. Everything else has a default that is either correct or safe.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgres://user:password@host:5432/polaris?sslmode=require`. `postgresql://` is accepted and normalised. The process exits if it is unset |
| `POLARIS_JWT_SECRET` | Signs access tokens. **Must be at least 32 bytes when `POLARIS_ENV=production`**, and the process refuses to start otherwise. Generate with `openssl rand -base64 48` |

Rotating `POLARIS_JWT_SECRET` invalidates access tokens only. Refresh tokens are opaque
random values stored hashed in `account_session`, so sessions survive a rotation — everybody
gets a new access token within `POLARIS_ACCESS_TOKEN_TTL` and nobody is logged out. That is
worth knowing at 3 a.m.: rotating the signing key is a cheap, low-blast-radius action here,
which is not true of every system.

### Everything else, with its default

| Variable | Default | What happens when unset |
|---|---|---|
| `POLARIS_ENV` | `development` | **Set this to `production`.** Development mode enables GraphQL introspection and a playground handler, accepts `GET /graphql`, and — most importantly — issues session cookies *without* the `Secure` flag. Introspection hands an attacker a complete map of the API surface; the schema is published in the repository anyway, which serves integration authors better |
| `POLARIS_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `POLARIS_PUBLIC_URL` | `http://localhost:5173` | The absolute URL users reach you on. Used to build links in digest emails, and its host is the allowlist the WebSocket handshake is checked against. Wrong value: every socket handshake is rejected and the app never goes live, while HTTP keeps working — a confusing failure worth checking first |
| `POLARIS_REGISTRATION_MODE` | `invite` | Who may create an account: `invite` or `open`. Any other value and the process refuses to start. `invite` admits somebody holding a valid invitation, plus the very first account on an empty install; `open` admits anybody. See *Create the first account* |
| `POLARIS_DEFAULT_PLAN` | `self_hosted` | The entitlement plan a new workspace starts on: `free`, `pro`, `enterprise` or `self_hosted`. Any other value and the process refuses to start. `self_hosted` is unlimited on seats, teams and history; the other three exist for a hosted deployment where the plan comes from billing. You almost certainly want the default |
| `POLARIS_ALLOWED_ORIGINS` | empty | Extra cross-origin callers, comma separated. **Empty is correct for almost every install**: the web client is served from the same origin and needs no CORS at all, and the packaged desktop app's own scheme is allowed unconditionally. Every entry here is echoed back with `Access-Control-Allow-Credentials`, so anything you list can act as your users with their own cookies. It is a list of origins you control |
| `POLARIS_API_ADDR` | `:8088` | Bind address for `api` |
| `POLARIS_SYNC_ADDR` | `:8089` | Bind address for `sync` |
| `POLARIS_ACCESS_TOKEN_TTL` | `15m` | |
| `POLARIS_REFRESH_TOKEN_TTL` | `720h` | 30 days. This is how long a laptop can be shut for and still open signed in |
| `POLARIS_DB_MAX_CONNS` | `10` | Per process. See the pooling note below |
| `POLARIS_DB_MIN_CONNS` | `2` | |
| `POLARIS_DB_MAX_CONN_LIFETIME` | `1h` | Not applied in `sync`, deliberately: recycling the connection holding `LISTEN` would drop the subscription on a timer, and "updates stop arriving for everybody, roughly hourly" is a miserable thing to diagnose |
| `POLARIS_SHUTDOWN_GRACE` | `20s` | How long in-flight requests get to finish on `SIGTERM`. Make your container runtime's stop timeout larger than this or the runtime will `SIGKILL` mid-drain |
| `POLARIS_RATE_LIMIT_ENABLED` | `true` | See *Rate limits* |
| `POLARIS_SMTP_*`, `POLARIS_MAIL_*` | see *Email* | Optional, and absence is supported |

**Connection pool arithmetic.** The default of 10 is low because it is a *per-process*
number and the defaults assume a pooler in front. Three processes at 10 is 30 backends
against a Postgres whose own default `max_connections` is 100 — fine. Three replicas each of
three processes is 90, and you are one `psql` away from "too many clients". Either raise
`max_connections` (each backend costs about 10 MB) or put pgbouncer in transaction mode in
front. The code already sets pgx's exec mode to `describe`, which is the setting a
transaction pooler requires; getting that wrong produces "prepared statement already exists"
errors that only appear under concurrency in production.

### Declared but not wired up

Two variables exist in `config.go`, are parsed, and are then read by nothing:

| Variable | Reality |
|---|---|
| `VALKEY_URL` | No Redis or Valkey client is linked into the binary. Setting it does nothing; leaving the container out of your compose file breaks nothing except a `depends_on` you should also remove |
| `POLARIS_METRICS_ADDR` | No metrics server is started and there is no `/metrics` endpoint. `docs/05-infrastructure/08-security-and-operations.md` lists the metrics that are intended; none of them exist yet |

They are documented here rather than omitted so that you do not spend an hour working out
why your Prometheus scrape returns connection-refused.

### One variable that is not in `config.go`

`POLARIS_LISTEN_DATABASE_URL` is read directly by `cmd/sync/main.go`, and only there. Set it
**only if `sync` would otherwise reach Postgres through a transaction-mode pooler.** `LISTEN`
is session state; in transaction mode the pooled connection is handed to somebody else
between statements and the subscription silently evaporates, at which point the hub stops
waking up and nobody's changes propagate — with no error anywhere. Point this at Postgres
directly, bypassing the pooler, and leave `DATABASE_URL` pooled for everything else. If you
have no pooler, leave it unset.

### Rate limits

Every limit is a per-caller token bucket, and every default is set roughly an order of
magnitude above the busiest plausible human. The stated test they have to pass is a
three-person install sharing an office IP where nobody ever sees a 429, because a limit that
catches a real user is a limit that gets switched off, and a switched-off limit protects
nothing.

| Variable | Default | Scope |
|---|---|---|
| `POLARIS_RATE_LIMIT_GRAPHQL_REQUESTS` | `5000` / `1h` | Per authenticated caller |
| `POLARIS_RATE_LIMIT_GRAPHQL_COMPLEXITY` | `2000000` / `1h` | The same traffic, charged in complexity points, so a client looping on one expensive query is caught as well as one looping on a trivial one |
| `POLARIS_RATE_LIMIT_LOGIN_ATTEMPTS` | `10` / `10m` | Per **account**, whoever is asking. The tightest budget in the process, and the only one aimed at an attacker rather than a runaway client |
| `POLARIS_RATE_LIMIT_ANON_REQUESTS` | `120` / `1m` | Per source address, unauthenticated |
| `POLARIS_RATE_LIMIT_BOOTSTRAPS` | `10` / `10m` | Workspace snapshots per user |
| `POLARIS_RATE_LIMIT_MAX_CALLERS` | `100000` | Bounds the limiter's memory. Keys are caller-supplied, so the map is unbounded by construction and something has to cap it |

Each period has its own `_PERIOD` variable. Any individual limit set to `0` switches that
class off; `POLARIS_RATE_LIMIT_ENABLED=false` switches all of them off, which is the honest
escape hatch if you have put your own limiter in front.

**The counters are in each process's memory, not shared.** Two API replicas therefore enforce
twice the configured limit, because each sees half the traffic and charges its own bucket.
Halve the numbers if you run replicas, or accept the drift — but know which you are doing.

### Where secrets go

Not in the repository, not in the image, and not in a compose `environment:` block.

Put them in a single file outside the checkout, owned by root, mode `600`, and reference it
from `env_file:`. Something like `/etc/polaris/polaris.env`. Three specific traps:

- **Never commit a real `.env`.** The `.gitignore` here already excludes `.env`, `.env.*`,
  `*.pem` and `*.key` while keeping `.env.example`. Keep it that way. Git history cannot
  forget a blob, so a secret committed once is a secret rotated, not a secret deleted.
- **Never bake secrets into an image.** An image layer is readable by anybody who can pull
  it, and `docker history` shows build arguments.
- **Never write `${POLARIS_JWT_SECRET:-something}` in a compose file.** A default masks the
  missing value and the stack comes up signing tokens with a string that is in your
  repository. Use `${VAR:?message}` so the stack refuses to start instead.

A default JWT secret in production means anybody who has read the repository can mint a token
for any account. That is the failure the "at least 32 bytes in production" check exists to
catch, and it catches only the length, not the fact that you copied the example value.

## First run

### 1. Prepare the database

Create the database and a role that can create extensions. Restrict what the role can reach:
the datastore should sit on a network your reverse proxy cannot route to. Nothing that
serves public traffic needs a path to Postgres except the three Polaris processes.

### 2. Run the migrations, as their own step

```bash
polarisctl migrate up --database "$DATABASE_URL"
# migrated to version N (dirty=false)
```

The version is the number of the last migration in `services/migrations/`, whatever that is
in the release you are running. What matters is `dirty=false`.

Run this as a one-shot container or command that exits, **before** starting `api`, `sync` or
`worker` — not on service startup. Migrations take a Postgres advisory lock for their
duration, so two replicas racing to migrate the same database is safe, but a migration that
fails part-way while three services are already accepting traffic is not. Doing it as a
discrete step means a failed migration aborts the rollout before any new code starts.

`golang-migrate` runs against the SQL embedded in the binary, so the tool always matches the
schema the running code expects. There is no separate migrations directory to deploy.

### 3. Start the services

Start order matters less than it looks — the pool refuses to open without a reachable
database, so starting `api` first only burns restart attempts — but datastore, then
migrations, then services is the order that produces readable logs.

### 4. Create the first account

**Registration is invite-only by default, and the first account is how you get in.**
`POST /auth/register` admits exactly two people on a default install:

1. Somebody holding a valid, pending, unexpired invitation.
2. The **very first** account, on an install whose `account` table is empty.

That second rule is yours to use, once:

```bash
curl -X POST https://polaris.example.invalid/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.invalid","password":"a passphrase, at least 10 characters"}'
```

or just use the sign-up form. Then create a workspace, which any authenticated account may
do. From that moment the endpoint refuses everybody who does not hold an invitation:

```json
{"error":{"code":"FORBIDDEN","message":"this server is invite-only — ask an admin to send you an invitation link"}}
```

**Do this before you point DNS at the box.** The window between starting the API and
creating your account is the one moment a stranger could take the install, because on an
empty database their registration is as valid as yours. It is a small window and it is under
your control: bring the stack up, register, and only then publish the hostname. If the box
was already reachable, check that the account you are signed in as is the one you made —
`SELECT email, created_at FROM account ORDER BY created_at` is the whole audit.

Two people racing that window cannot both win: the check runs under a transaction-scoped
advisory lock, so the second attempt reads a table that already has a row in it and is
refused. And **deleting the first account does not reopen the door** — the check counts every
account row including soft-deleted ones, because an install whose owner deleted their own
login is not a fresh install, it is your server with your issues still in it.

### Inviting everybody else

An admin invites from the members screen, which mints a link containing a single-use token.
The invited person follows it and registers in one step: the token travels **on** the
registration call, so they do not need an account first, and the account and the workspace
membership are created in the same transaction. There is no state where somebody has one and
not the other.

Every refused invitation says the same thing, whatever was wrong with it:

```json
{"error":{"code":"FORBIDDEN","message":"this invitation cannot be used — ask for a new one, and sign up with the address it was sent to"}}
```

A token that never existed, one that was revoked, one that expired after its 14 days, one
already accepted, and one presented with a different email address are deliberately
indistinguishable. If you are supporting somebody who sees it, the useful questions are "is
the link the most recent one" and "are you signing up with the exact address it was sent to";
the server will not tell you which of the two it was, on purpose.

Invitations do not require a mail relay. With `POLARIS_SMTP_HOST` empty the admin copies the
link out of the members screen and sends it however they like.

### If you want an open server anyway

```
POLARIS_REGISTRATION_MODE=open
```

Anybody who can reach the endpoint gets an account, rate-limited and nothing more, and any
account can create its own workspace on your install. This is a real supported setting for a
community or demo instance, and it is off by default because it is the configuration `README`
says is not ready: there are no per-workspace quotas and no abuse controls behind it yet. If
you set it on a box the internet can reach, put an allowlist in front of `POST /auth/register`
at the reverse proxy, or accept that you are running a public signup form.

### What is still not here

**There is no email verification.** The `email_verified_at` column exists and nothing ever
sets it. Invite-only registration makes this much less interesting than it was — the address
was chosen by an admin, and the invitation only redeems for that address — but on an install
running `open` mode, an address in the account table is a string somebody typed and nothing
more.

There is no setup wizard, and no CLI that creates an account: `polarisctl` has five commands
and none of them is this. The first-account rule is deliberately the only way in.

### 5. Check the workspace plan

Nothing to do, unless you changed `POLARIS_DEFAULT_PLAN`. A workspace created by this build
starts on `self_hosted`: unlimited seats, unlimited teams, unlimited history. That is what
the README means by "self-host free and unlimited on seats", and it is the default precisely
so that nobody has to find this section.

It reports `false` for SSO and the audit log, correctly — that code is excluded from the
community build by a `//go:build ee` tag, so it is absent from the binary rather than present
and disabled.

If you are reading this because a workspace of yours says it has a five-seat limit, it was
created by an earlier build. Until recently the create path wrote `'free'` — a hosted-tier
plan — for everybody, including self-hosted installs. Nothing enforced those caps, so the
effect was a settings screen quoting a limit that did not apply; the fix is one statement:

```sql
UPDATE workspace SET plan = 'self_hosted' WHERE url_key = 'your-workspace';
```

### 6. Check it came up

```bash
curl -fsS https://polaris.example.invalid/healthz   # "ok"  — the process is alive
curl -fsS https://polaris.example.invalid/readyz    # "ready" — and the database answers
```

## TLS and reverse proxying

Polaris speaks plain HTTP and expects something in front of it to terminate TLS. It does not
issue certificates, does not redirect HTTP to HTTPS, and does not set HSTS — the application
sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` and
`Cache-Control: no-store` on API responses, and the Content-Security-Policy is set on the
document by whatever serves the SPA. `Strict-Transport-Security` is the proxy's job, because
the proxy is the only thing that knows whether TLS is actually terminated.

Use whatever you already run. The requirements are the same for all of them.

### Everything on one hostname

Serve the SPA and the API from the same origin. Then the browser sees one origin, no CORS is
involved for first-party clients, cookies work on every path, and the desktop app points at
a single base URL. Splitting them across hostnames is possible but means adding the SPA's
origin to `POLARIS_ALLOWED_ORIGINS`, which is a credentialed allowlist you then have to keep
correct.

### The routing table

| Path | Goes to | Notes |
|---|---|---|
| `/sync/bootstrap` | **`api`** `:8088` | **Must be matched before `/sync`.** Long-running: allow a read timeout of several minutes and turn response buffering off, because it streams a snapshot |
| `/sync` | `sync` `:8089` | WebSocket upgrade must be enabled. Idle read timeout must be long — an idle socket is this service's normal state |
| `/graphql` | `api` `:8088` | |
| `/auth/*` | `api` `:8088` | |
| `/healthz`, `/readyz` | `api` `:8088` | Or wherever you want your uptime check to land |
| everything else | web `:8080` | The SPA, which handles its own client-side routing |

The first row is the trap. The bootstrap snapshot is served by the **api** process, not the
sync process, despite living under `/sync/`. A proxy rule that sends everything matching
`/sync*` to the sync service will send `/sync/bootstrap` there too, and the sync process's
mux has exactly two routes — `/healthz` and an exact-match `/sync` — so the bootstrap 404s.
The symptom is an app that connects its socket successfully and then never loads any data.

The bundled `Caddyfile` in this repository has this bug: its `handle /sync*` block precedes
nothing that catches `/sync/bootstrap`. If you use it, add a `handle /sync/bootstrap` block
routing to `api:8088` **above** the `/sync*` one.

The second trap is the WebSocket configuration. Without the upgrade enabled the handshake
502s; with the upgrade but a 60-second idle read timeout, every socket dies on the minute and
every client reconnects at once. The protocol sends a heartbeat every 30 seconds and treats
60 seconds of silence as a dead peer, so any proxy idle timeout comfortably above a minute
works — an hour is a common choice.

If a CDN or protective proxy sits in front, check its own WebSocket idle limit. Several cut
idle sockets at around 100 seconds regardless of what your origin proxy says; the 30-second
heartbeat is what keeps those alive, and it is why the heartbeat is not configurable.

### Cookies

The refresh token is an `HttpOnly`, `SameSite=Lax` cookie. The `Secure` flag is set whenever
`POLARIS_ENV` is anything other than `development`. Two consequences:

- Serving a production install over plain HTTP means the browser drops the cookie and sign-in
  appears to do nothing at all, with no error.
- Running with `POLARIS_ENV=development` behind TLS works, and ships a cookie without
  `Secure` plus an introspectable GraphQL endpoint. Do not.

## Email

**Email is optional and its absence is a supported configuration.** With `POLARIS_SMTP_HOST`
empty, the product runs exactly as it does with a relay configured, except that the worker
logs one line at startup —

```
email delivery is not configured; notification digests will not be sent
```

— and never registers the digest job at all. Nothing else changes. The inbox works, and it
is the durable record; email is only how a notification reaches somebody who is not looking
at the inbox. Nothing in this build requires email to sign in, to invite somebody, or to
recover an account, so there is no bootstrapping problem: an install with no relay is a
complete install.

This is deliberate. Requiring a relay before anything works is named in this repository as
the most common way self-hosted onboarding fails.

If you do want digests:

| Variable | Default | Notes |
|---|---|---|
| `POLARIS_SMTP_HOST` | empty | Setting it is what enables the digest job |
| `POLARIS_SMTP_PORT` | `587` | |
| `POLARIS_SMTP_USERNAME` | empty | Optional |
| `POLARIS_SMTP_PASSWORD` | empty | Optional |
| `POLARIS_SMTP_TIMEOUT` | `30s` | Bounds one delivery, dial to `QUIT` |
| `POLARIS_MAIL_FROM` | `polaris@localhost` | Set it |
| `POLARIS_MAIL_FROM_NAME` | `Polaris` | |

Username and password are optional on purpose: a postfix bound to `127.0.0.1` that accepts
anything from the machine it runs on is the ordinary self-hosted arrangement, and requiring a
username there would mean inventing one.

What the client does, so you can predict it:

- **STARTTLS whenever the relay offers it.** If credentials are configured and the relay does
  *not* offer STARTTLS, the send is refused rather than downgraded. Sending a password in
  the clear to something claiming not to support encryption is precisely the downgrade an
  attacker on the path would arrange.
- **Certificate verification, except on loopback.** On `127.0.0.1` a certificate proves
  nothing that is not already true, and the common local-postfix setup has a self-signed one.
- **`EHLO` uses the domain of `POLARIS_MAIL_FROM`**, not `localhost`. That domain is also the
  `Message-ID` domain and is what SPF and DKIM are checked against, so it has to be a domain
  this install is allowed to send as. A mismatch here is the difference between the inbox and
  the spam folder, and it is the most common reason self-hosted digests vanish.

Delivery failures are logged at warning level, not error. A relay having a bad minute, an
address bouncing or a certificate expiring are all recoverable on the next hourly pass, and
none of them is the class of problem — a disk filling, a partition missing — that the error
level in the worker is reserved for.

Two operational notes. The digest job runs hourly, and that hour is the *resolution*, not the
cadence: each recipient's own preference decides whether they are due. And delivery is
**at most once** — a notification is claimed with a single `UPDATE ... WHERE emailed_at IS
NULL ... RETURNING` before the message is handed to the relay, so a process killed in between
loses that digest rather than sending it twice. The news is not lost; it is still unread in
the inbox.

## Backup and restore

Everything that matters is in Postgres. There is no object store and no separate index to
coordinate, which makes this simpler than the design documents in this directory imply.

### What a correct backup is

**One `pg_dump` of the whole database, taken as a single snapshot.**

```bash
pg_dump -Fc -d "$DATABASE_URL" > polaris-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Custom format (`-Fc`) rather than plain SQL, because it restores selectively and in parallel,
which is what you want at 3 a.m. when only one table is wrong.

The "single snapshot" part is the load-bearing half, and it is why per-table dumps and
clever partial backups are wrong here. `pg_dump` runs in one MVCC snapshot, so everything it
writes is mutually consistent. Four things have to be consistent with each other or the sync
stream breaks after the restore:

| Must travel together | Why |
|---|---|
| `workspace_version` | The sync clock. One row per workspace, incremented under a row lock inside every mutation transaction |
| `change_log` | Every delta, stamped with the version minted from that counter |
| The entity tables | What the deltas describe |
| `account_session` | Refresh tokens. Restored without them, every user is silently signed out |

A restore where `change_log` is newer than `workspace_version` mints duplicate versions for
different changes, and clients that hold one of them will never be told about the other. A
restore where the counter is newer than the log leaves gaps that read as pruned data. Neither
produces an error; both produce clients that quietly disagree with the server. Take the dump
as one snapshot and none of this can happen.

Also worth backing up, though not for correctness: your secrets file (in a password manager,
not next to the dumps) and your reverse-proxy configuration.

Nothing else needs to be. Valkey holds nothing. Rate-limit counters are in process memory and
are supposed to be lost.

### Restoring

```bash
createdb polaris_restored
pg_restore -d polaris_restored --clean --if-exists polaris-20260101T030000Z.dump
polarisctl migrate up --database "postgres://…/polaris_restored"   # no-op if same version
```

Then point `DATABASE_URL` at it and start `api`. Check `/readyz`, then run one real query.

### The thing that goes wrong after a restore

**Restoring rewinds `workspace_version`, and connected clients do not notice.**

A client stores the highest version it has seen and resumes from it. The server checks
whether that cursor is *below* the retention floor — if the deltas have been pruned it forces
a re-bootstrap, correctly. It does **not** check whether the cursor is *above* the server's
current version, because in normal operation that cannot happen. After a restore it can: the
client holds version 5,000 and the restored database's counter says 4,200.

The catch-up loop runs while `cursor < current`, which is false, so it delivers nothing. New
mutations then mint versions 4,201, 4,202 — all below the client's cursor, all filtered out.
The client sits there connected, heartbeating, showing a version number, and receives nothing
ever again. No error is logged and no alert fires.

The fix is one statement, run after the restore and before users reconnect. Push the counter
past anything a client could be holding:

```sql
UPDATE workspace_version SET version = version + 100000;
```

Now every resuming client's cursor is below `current`, the catch-up loop runs, finds no rows
above the cursor, and sends a `resync` — which is exactly right. Each client drops its local
copy and bootstraps cleanly. The margin needs to exceed the number of mutations between the
backup and the failure; 100,000 is generous for a small install and costs nothing, since the
counter is a `bigint` and gaps in it are harmless.

The second post-restore effect is smaller and worth a heads-up rather than an action:
`notification.emailed_at` rolls back with everything else, so digests that were sent between
the backup and the restore can be sent a second time. There is no way to unsend the first
copy and no way to suppress the second without hand-editing the column, so the honest move is
to tell people it may happen.

### The drill

A backup you have not restored is a rumour. Restore last night's dump into a throwaway
database, run `polarisctl migrate up` against it, boot an API pointed at it, hit `/readyz`,
and open one issue. Time it. That wall-clock number is your actual recovery time; every other
number you might quote is a guess.

## Upgrades

```bash
# 1. Back up, and verify the dump is non-empty before continuing.
pg_dump -Fc -d "$DATABASE_URL" > pre-upgrade.dump

# 2. Fetch the new images. Nothing is running the new code yet.
docker compose pull

# 3. Migrate as a discrete step that must exit 0.
docker compose run --rm migrate

# 4. Roll the services.
docker compose up -d
```

The order is the whole point: images arrive before anything changes, and a failed migration
stops the upgrade while the old code is still running and still correct.

### Migrations are forward-only

`polarisctl migrate down` exists for local iteration and **refuses to run when
`POLARIS_ENV=production`**. This is not squeamishness. The rule that makes it safe is that
every migration must be additive and compatible with the previously deployed revision, which
is what lets you roll code back without rolling the schema back. Expand and contract, always:
add a nullable column in release N, start reading it in N+1, drop the old one in N+2. Never
rename or drop in the same release that stops using something.

Rolling back the application after an upgrade therefore reverts **code, not schema**, and
that is a supported operation. Rolling back the schema is not.

### When a migration fails

```
$ polarisctl migrate status --database "$DATABASE_URL"
version=17 dirty=true
WARNING: the schema is dirty — a migration failed part-way and must be resolved by hand
```

`dirty=true` means a migration started, failed part-way, and the database is in neither the
old shape nor the new one. Do not run `migrate up` again — it will refuse, and if it did not
it would compound the damage. Restore the pre-upgrade dump, or work out by hand what the
failed migration achieved, finish or undo it in a transaction, and clear the dirty flag in
`schema_migrations`. The dump is much less work.

### A schema bump that forces every client to re-download

`domain.ClientSchemaVersion` (currently 2) is the shape version of the client's local store.
When a release increments it, every client drops its local database and bootstraps again on
first connect. That is cheap, obvious and impossible to get subtly wrong, which matters more
than the one-off download — but on a large install it means every connected client requests a
snapshot at once. Release notes should say when it changed; if they do, upgrade at a quiet
hour and expect a burst of bootstrap traffic.

### Upgrading Postgres itself

A **major** version upgrade needs one extra step, because of the `unaccent` caveat above:

```sql
REINDEX INDEX CONCURRENTLY issue_search_idx;
REINDEX INDEX CONCURRENTLY comment_search_idx;
REINDEX INDEX CONCURRENTLY issue_title_folded_trgm;
REINDEX INDEX CONCURRENTLY issue_description_folded_trgm;
```

Those four are the ones built over `search_fold()`.

Skipping it does not produce an error. It produces a small number of issues that stop turning
up in search for accented queries, discovered months later by a user who is certain the issue
exists.

## Is it healthy?

### Endpoints

| Check | Where | What a failure means |
|---|---|---|
| `GET /healthz` | `api` `:8088`, `sync` `:8089`, web `:8080` | The process is alive. Deliberately touches no database, so that "is the process up" and "is the database reachable" stay separable during an incident |
| `GET /readyz` | `api` only | The process is alive **and** a database ping succeeded within 2 seconds. This is the one to put behind an external uptime check |

`/healthz` is excluded from the request log, because a container runtime polling it every few
seconds would otherwise be most of your log volume.

**The worker has no HTTP endpoint at all.** It opens no listener. Any healthcheck you have
seen that points at a worker port — including the one in
`docs/05-infrastructure/05-deployment-vps.md`, which references a `polarisctl health`
subcommand that does not exist — is checking nothing. Check the worker two other ways:

1. It logs `worker started` with a job count at boot. Four jobs with no relay configured,
   five with one.
2. Its most important job leaves a trace in the database. See below.

### What to actually watch

**The partition canary.** The worker creates `change_log` partitions four months ahead, every
six hours and once at boot. If it stops, writes keep succeeding — they land in
`change_log_default`, which exists precisely so that a missed job does not break every write
in the product at midnight on the first of the month. But a partition can never afterwards be
created for a month whose rows are already sitting in the default, so the problem compounds
silently and gets harder to fix the longer it runs. Alert on this:

```sql
SELECT count(*) FROM change_log_default;   -- expected: 0
```

Anything above zero means the worker has not run recently. Fix by running
`polarisctl partitions ensure` and then moving those rows into their proper partitions before
they accumulate.

**Migration state**, after every deploy:

```bash
polarisctl migrate status --database "$DATABASE_URL"   # version=N dirty=false
```

**Disk**, at 80%. Postgres is the only thing that grows and a full disk stops writes.

**Retention is doing its job.** `change_log` should hold about 30 days:

```sql
SELECT min(created_at), max(created_at), count(*) FROM change_log;
```

A `min` much older than 30 days means the nightly prune is not running.

**Log volume and level.** Logs are structured JSON to stdout. The `api` process logs one line
per request with method, path, status and duration. If you are shipping them anywhere, cap
the container's local buffer — `max-size: 10m, max-file: 3` is the setting in the bundled
compose — because unbounded Docker logs are a classic way to fill a disk and take Postgres
down with them.

There is no metrics endpoint to scrape and no built-in alerting. Until there is, an external
uptime check on `/readyz`, a disk alert, and the `change_log_default` query above are most of
the value.

### The four failures worth recognising by their symptom

| Symptom | Likely cause |
|---|---|
| App loads, socket connects, no data ever appears | `/sync/bootstrap` is being routed to the sync service instead of the api |
| Sign-in appears to do nothing, no error | `Secure` cookie over plain HTTP, or `POLARIS_ENV` unset behind TLS |
| Everything works but nobody sees each other's changes | The hub's `LISTEN` connection went through a transaction-mode pooler — set `POLARIS_LISTEN_DATABASE_URL` |
| Sockets drop and reconnect on a fixed interval | Proxy idle read timeout below the 30-second heartbeat's tolerance |

## What is not here yet

So you do not go looking. All of these are described somewhere in `docs/` as though they
exist:

- **Object storage and attachments.** No `internal/files` package, no attachment table. The
  MinIO container and the `POLARIS_S3_*` variables in `.env.example` configure nothing.
- **A search service.** Search is Postgres full-text and trigram indexes, which is a complete
  implementation and needs no extra service. The Meilisearch container and `POLARIS_MEILI_*`
  configure nothing.
- **A job queue.** The worker is a set of interval loops in one process. There is no queue to
  monitor and no queued work to lose on restart.
- **Metrics, tracing, `polarisctl backup`, `polarisctl doctor`, `polarisctl reindex`, a setup
  wizard, an `/admin/system` diagnostics page, email verification.**

Invite-only signup *is* here, and is the default — see *Create the first account* above.

`polarisctl` has exactly five commands: `migrate up|down|status`, `partitions ensure`,
`prune change-log`, `seed`, and `help`. `polarisctl help` lists them, and it is the honest
answer to "what can this tool do".
