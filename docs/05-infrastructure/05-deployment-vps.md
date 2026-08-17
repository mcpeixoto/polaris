# Deployment on the VPS

Follows `/root/SERVER_INFRA.md` and the patterns already proven by `MealMindApp`, `Almanac`, and `Montra`. Deviations are marked **[differs]**.

## Before anything: check the box has room

Polaris is materially heavier than the other tenants — it brings a database, a queue, object storage, and a search index.

```bash
free -m                      # need ~5 GB free for the full profile, ~3 GB lean
df -h /                      # need 40+ GB headroom for Postgres + MinIO growth
docker stats --no-stream     # what the other ~20 containers actually use
nproc                        # 4+ vCPU wanted; 2 is workable pre-launch
```

If headroom is thin, start with the **lean profile**: Postgres FTS instead of Meilisearch, a bind-mounted volume instead of MinIO. That is ~1 GB saved and two fewer services, and both are single-package swaps later (`internal/search`, `internal/files`).

## Networks

```bash
# webnet is owned by the NPM stack and must already exist.
docker network inspect webnet >/dev/null || echo "start NPM first"

# ours, spans the compose project; created by app.sh
docker network create polaris_internal
```

Only `Polaris_web`, `Polaris_api`, and `Polaris_sync` sit on `webnet`. Everything else is internal-only. **Nothing NPM can route to may reach Postgres.**

## docker-compose.yml

```yaml
# Polaris — CLOUD deployment on the fleet VPS.
#
# This is the FLEET OVERRIDE. The public repo's default docker-compose.yml is
# self-contained (Caddy, published ports, no NPM) so a stranger can run it —
# see 10-self-host-and-cloud.md. Keep this file out of the public tree.
#
# House rules (see /root/SERVER_INFRA.md):
#   - No `ports:`. NPM is the only thing on :80/:443 and reaches containers by
#     name over `webnet`:
#         polaris.peixotolabs.com -> http://Polaris_web:8080
#         ... /graphql            -> http://Polaris_api:8088   (custom location)
#         ... /sync               -> http://Polaris_sync:8089  (websockets ON)
#   - <Prefix>_<role> container names.
#   - Secrets from a root-owned 600 file OUTSIDE the repo, never committed.
#   - mem_limit + healthcheck + capped logging on every service.
name: polaris

x-common: &common
  restart: unless-stopped
  labels:
    org.opencontainers.image.revision: ${GIT_SHA:-unknown}
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }

x-go-env: &go-env
  env_file: [/root/.config/polaris/polaris.env]
  environment:
    - ENV=production
    - DATABASE_URL=postgres://polaris@Polaris_pgbouncer:6432/polaris?sslmode=disable
    - REDIS_URL=redis://Polaris_cache:6379
    - S3_ENDPOINT=http://Polaris_files:9000
    - SEARCH_URL=http://Polaris_search:7700
    - PUBLIC_URL=https://polaris.peixotolabs.com
    - REQUIRE_CLOUDFLARE=true          # /healthz is checked before this gate
    - LOG_LEVEL=info

services:
  web:
    <<: *common
    image: ghcr.io/peixotolabs/polaris-web:${TAG:-latest}
    container_name: Polaris_web
    mem_limit: 64m
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    networks: [webnet]

  migrate:
    <<: [*common, *go-env]
    image: ghcr.io/peixotolabs/polaris:${TAG:-latest}
    container_name: Polaris_migrate
    command: ["/usr/local/bin/polarisctl", "migrate", "up"]
    restart: "no"                      # runs once per deploy, then exits 0
    depends_on:
      db: { condition: service_healthy }
    networks: [polaris_internal]

  api:
    <<: [*common, *go-env]
    image: ghcr.io/peixotolabs/polaris:${TAG:-latest}
    container_name: Polaris_api
    command: ["/usr/local/bin/api"]
    mem_limit: 512m
    depends_on:
      migrate: { condition: service_completed_successfully }
      cache:   { condition: service_healthy }
    healthcheck:
      test: ["CMD", "/usr/local/bin/polarisctl", "health", "--addr=127.0.0.1:8088"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks: [webnet, polaris_internal]

  sync:
    <<: [*common, *go-env]
    image: ghcr.io/peixotolabs/polaris:${TAG:-latest}
    container_name: Polaris_sync
    command: ["/usr/local/bin/sync"]
    mem_limit: 512m
    # Sockets are long-lived; give in-flight clients time to drain on deploy.
    stop_grace_period: 45s
    depends_on:
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD", "/usr/local/bin/polarisctl", "health", "--addr=127.0.0.1:8089"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks: [webnet, polaris_internal]

  worker:
    <<: [*common, *go-env]
    image: ghcr.io/peixotolabs/polaris:${TAG:-latest}
    container_name: Polaris_worker
    command: ["/usr/local/bin/worker"]
    mem_limit: 512m
    depends_on:
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD", "/usr/local/bin/polarisctl", "health", "--addr=127.0.0.1:8090"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks: [polaris_internal]       # outbound only; nothing routes to it

  db:
    <<: *common
    image: postgres:17.2-alpine
    container_name: Polaris_db
    mem_limit: 2g
    shm_size: 256m                     # parallel workers + sorts need it
    env_file: [/root/.config/polaris/polaris.env]   # POSTGRES_PASSWORD
    environment:
      - POSTGRES_USER=polaris
      - POSTGRES_DB=polaris
      - PGDATA=/var/lib/postgresql/data/pgdata
    command:
      - postgres
      - -c=max_connections=100
      - -c=shared_buffers=512MB
      - -c=effective_cache_size=1536MB
      - -c=work_mem=16MB
      - -c=maintenance_work_mem=256MB
      - -c=random_page_cost=1.1        # NVMe
      - -c=wal_compression=on
      - -c=shared_preload_libraries=pg_stat_statements
    volumes:
      - polaris_db:/var/lib/postgresql/data
      - /srv/polaris/backups:/backups
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U polaris -d polaris"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks: [polaris_internal]

  pgbouncer:
    <<: *common
    image: edoburu/pgbouncer:1.23.1-p2
    container_name: Polaris_pgbouncer
    mem_limit: 128m
    env_file: [/root/.config/polaris/polaris.env]
    environment:
      - DB_HOST=Polaris_db
      - DB_USER=polaris
      - DB_NAME=polaris
      - POOL_MODE=transaction
      - MAX_CLIENT_CONN=500
      - DEFAULT_POOL_SIZE=25
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "nc -z 127.0.0.1 6432"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [polaris_internal]

  cache:
    <<: *common
    image: valkey/valkey:8.0-alpine   # NOT redis:7.4+ (RSALv2/SSPL, not OSI) — see 10-self-host-and-cloud.md
    container_name: Polaris_cache
    mem_limit: 256m
    command: ["valkey-server", "--maxmemory", "192mb",
              "--maxmemory-policy", "allkeys-lru",
              "--appendonly", "yes", "--appendfsync", "everysec"]
    volumes: [polaris_cache:/data]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [polaris_internal]

  files:
    <<: *common
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    container_name: Polaris_files
    mem_limit: 512m
    env_file: [/root/.config/polaris/polaris.env]   # MINIO_ROOT_USER/PASSWORD
    command: ["server", "/data"]
    volumes: [polaris_files:/data]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks: [polaris_internal]

  search:
    <<: *common
    image: getmeili/meilisearch:v1.12
    container_name: Polaris_search
    mem_limit: 512m
    env_file: [/root/.config/polaris/polaris.env]   # MEILI_MASTER_KEY
    environment: [MEILI_ENV=production]
    volumes: [polaris_search:/meili_data]
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:7700/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [polaris_internal]

volumes:
  polaris_db:     { name: polaris_db }
  polaris_cache:  { name: polaris_cache }
  polaris_files:  { name: polaris_files }
  polaris_search: { name: polaris_search }

networks:
  webnet:           { external: true }
  polaris_internal: { external: true }
```

**[differs] from the rest of the fleet:** images are pulled from GHCR rather than built on the box. Building a Go + Vite + Electron stack on a shared VPS competes for CPU with twenty live sites; CI builds, the box pulls.

## Secrets

`/root/.config/polaris/polaris.env`, `root:root`, `600`, never committed:

```ini
# Database
POSTGRES_PASSWORD=
# Auth
JWT_SIGNING_KEY=            # openssl rand -hex 32
SESSION_PEPPER=             # openssl rand -hex 32
# Object storage
MINIO_ROOT_USER=
MINIO_ROOT_PASSWORD=
S3_ACCESS_KEY=
S3_SECRET_KEY=
# Search
MEILI_MASTER_KEY=
# Email
POLARIS_SMTP_HOST=          # relay, e.g. email-smtp.eu-west-1.amazonaws.com — empty disables email entirely
POLARIS_SMTP_PORT=587
POLARIS_SMTP_USERNAME=
POLARIS_SMTP_PASSWORD=
POLARIS_MAIL_FROM=notifications@polaris.peixotolabs.com
POLARIS_MAIL_FROM_NAME=Polaris
INBOUND_MAIL_SECRET=        # verifies the inbound-parse webhook
# Integrations (per provider, added as they ship)
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
# Ops
ALERT_WEBHOOK_URL=          # set at deploy time, not "later"
BACKUP_REMOTE=              # b2://... or r2://...
BACKUP_ENCRYPTION_KEY=
```

`ALERT_WEBHOOK_URL` unset is a known live gap on other fleet stacks. Here it is the only thing between a stuck webhook queue or a failed nightly backup and silence.

## app.sh

Same shape as `Almanac/app.sh` and `MealMindApp/app.sh`:

```bash
#!/usr/bin/env bash
# Polaris — VPS services entrypoint (house standard, see /root/SERVER_INFRA.md
# and docs/05-infrastructure/05-deployment-vps.md).
#
#   web/     SPA (nginx)          -> polaris.peixotolabs.com     Polaris_web
#   api/     GraphQL + OAuth      -> /graphql /oauth /webhooks    Polaris_api
#   sync/    WebSocket hub        -> /sync                        Polaris_sync
#   worker/  jobs + cron          -> (no public host)             Polaris_worker
#   db cache files search         -> (internal only)
#
#   ./app.sh start|stop|restart|status|logs [web|api|sync|worker|db|cache|files|search]
#
# Deploy to prod is `git tag vX.Y.Z && git push --tags` — admin-deploy.timer
# picks it up, health-checks and auto-rolls-back. This script is for emergencies
# and local bring-up.
set -euo pipefail
cd "$(dirname "$0")"

ORDER=(db pgbouncer cache files search migrate api sync worker web)

ensure_networks() {
  docker network inspect webnet >/dev/null 2>&1 || {
    echo "webnet is missing. It belongs to the Nginx Proxy Manager stack; start that first." >&2
    exit 1; }
  docker network inspect polaris_internal >/dev/null 2>&1 \
    || docker network create polaris_internal >/dev/null
}
```

Startup walks `ORDER` forwards, shutdown backwards — the API's pool refuses to open without a reachable database, so starting it first only burns restart attempts.

## NPM configuration (manual, once)

Proxy Host → `polaris.peixotolabs.com` → `http://Polaris_web:8080`
- Block Common Exploits: **on**
- SSL: existing `*.peixotolabs.com` wildcard (**cert id 1** — do not issue a new one)
- Force SSL + HTTP/2: **on**

Then **Custom Locations**:

| Location | Forward | Extra |
|---|---|---|
| `/graphql` | `Polaris_api:8088` | — |
| `/oauth` | `Polaris_api:8088` | — |
| `/webhooks` | `Polaris_api:8088` | `client_max_body_size 25m;` (email intake) |
| `/files` | `Polaris_api:8088` | — |
| `/sync/bootstrap` | `Polaris_api:8088` | `proxy_read_timeout 300s; proxy_buffering off;` |
| `/sync` | `Polaris_sync:8089` | **Websockets Support ON**, `proxy_read_timeout 3600s;` |

Getting `/sync` wrong is the classic first-day failure: without the websocket toggle the upgrade 502s; without the timeout, idle sockets die every 60s and clients reconnect-storm.

**Cloudflare:** the orange proxy cuts idle WebSockets at ~100 s regardless of nginx — the 30 s client ping in the protocol handles it. Also raise the zone's upload limit or keep email/import payloads under 100 MB.

## Deploy

Fleet standard — publish a release, never a manual restart:

```bash
git commit ...                    # a dirty tree blocks auto-deploy
git tag v1.4.0
git push origin main --tags       # admin-deploy.timer (5-min poll) does the rest
```

Registry entry in `/root/AdminPanel/registry.yml`:

```yaml
- name: Polaris
  dir: /root/Polaris
  domains: [polaris.peixotolabs.com]
  deploy: auto
  health: https://polaris.peixotolabs.com/healthz
```

### Deploy sequence
1. CI builds and pushes `ghcr.io/peixotolabs/polaris:vX.Y.Z` and `polaris-web:vX.Y.Z`.
2. Timer fast-forwards the checkout, writes `TAG` and `GIT_SHA` into `.env`.
3. `docker compose pull` (no downtime — images arrive first).
4. `Polaris_migrate` runs to completion, holding an advisory lock. **A failed migration aborts the deploy before any new code starts.**
5. `docker compose up -d` recreates api → sync → worker → web.
6. Health-check the public `/healthz`; on failure, roll back to the previous tag and alert.

### Zero-downtime, honestly
With one replica per role there is a **2–5 s gap** on api restart and a socket drop on sync restart. Clients keep rendering from the local store and reconnect with backoff, so users see nothing — that is a direct benefit of the local-first design. If you later want true zero-downtime, run two replicas per role behind NPM's upstream and restart them one at a time; the app is stateless and already tolerates it.

### Rollback rule
The tag-deploy path reverts **code, not schema**. Migrations must therefore be additive and compatible with the previous revision — see `04-data-layer.md`. A migration that breaks release N-1 turns rollback into an outage.

## CI (GitHub Actions)

| Job | Does |
|---|---|
| `lint` | `golangci-lint`, `eslint`, import-boundary check (`graph/` may not import `store/`) |
| `generate-check` | Regenerates gqlgen/sqlc/codegen; fails if the tree is dirty |
| `test-go` | Unit + testcontainers integration, race detector on |
| `test-web` | Vitest + Playwright against a compose-up stack |
| `sync-conformance` | The property/permission/offline suite from `03-sync-engine.md` |
| `explain-check` | Runs the ten canonical view queries against seeded data, fails on a seq-scan regression |
| `build-images` | Multi-arch (amd64 for the VPS), pushes to GHCR, tagged with the git tag + SHA |
| `build-desktop` | macOS + Windows runners, signs and notarises, uploads to a GitHub Release |
| `publish-sdk` | On tag, publishes `@polaris/sdk` |

Only `build-images` and `build-desktop` run on tags; the rest run on every PR.
