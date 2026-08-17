# Security and operations

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

## Threat model, briefly

Polaris holds every customer's roadmap, private-team discussions, customer revenue attributes, and OAuth tokens for their GitHub and Slack. It sits on a box with ~20 other tenants. The realistic threats, in order:

1. **A leak across the permission boundary** — a private-team issue reaching a non-member through search, sync, an export, an unfurl, or a webhook.
2. **Compromise of stored third-party credentials** — a database dump becomes access to customers' GitHub orgs.
3. **SSRF from webhook/integration URLs into the fleet's internal network** — reaching another tenant's services or the Docker socket.
4. **Untrusted code execution** (coding sessions) with access to secrets or the internal network.
5. **Denial of service via API complexity** — one integration query pattern saturating Postgres for everyone.
6. **Ordinary web vulnerabilities** — XSS through the rich editor being the highest-value target, since it renders user HTML into every teammate's session.

## Controls

### Permission boundary
- **One visibility predicate** (`internal/authz`) used by resolvers, sync deltas, search queries, exports, and webhook fan-out. Adding a second implementation is the bug.
- **Permission fuzz test in CI** (`03-sync-engine.md`): randomly mutate team privacy and membership under load, assert no client ever holds an entity it may not see.
- Search filters are injected **server-side and unconditionally**; a client-supplied filter can only narrow, never widen.
- Exports carry the exporter's visibility, and workspace-wide export is owner-only with an audit entry — matching the product spec.

### Secrets and credentials
- All secrets in `/root/.config/polaris/polaris.env` (root:600), injected via `env_file`. Never in the image, never in the repo, never in `environment:` with a `${VAR:-}` default that would mask the real value.
- **Third-party tokens encrypted at rest** with a key that is *not* in the same env file as the database password — envelope encryption with the key in a distinct file, so a Postgres dump alone is useless.
- API keys and OAuth tokens stored hashed (`sha256` + pepper), shown once at creation.
- Rotation runbook per secret, with the blast radius written down. Rotating `JWT_SIGNING_KEY` logs everyone out; rotating a GitHub app key breaks every installation until reconnected. Knowing which is which at 2 a.m. matters.

### Network
- Datastores on `polaris_internal` only. Nothing NPM can route to may reach Postgres, Redis, MinIO, or Meilisearch.
- `Polaris_worker` has no inbound route at all.
- **Docker socket is never mounted** into any Polaris container.
- SSRF guard on every outbound URL the customer controls: webhook endpoints, custom MCP servers, avatar/preview fetches, importer URLs. Resolve, reject private ranges, pin the resolved IP for the request.
- `REQUIRE_CLOUDFLARE=true`, trusting `CF-Connecting-IP` only from Cloudflare ranges.

### Application
- CSP without `unsafe-inline`; the editor sanitises on **write and render** (DOMPurify server-side too — a malicious payload can arrive through the API, not just the UI).
- `SameSite=Lax`, `HttpOnly`, `Secure` cookies; CSRF tokens on cookie-authenticated mutations. Bearer-token API calls are exempt by construction.
- Uploads: content-type sniffing, extension allow-list, `Content-Disposition: attachment`, served from a **separate origin or with `X-Content-Type-Options: nosniff`** so an uploaded HTML file can't run in the app's origin.
- Dependency scanning (`govulncheck`, `pnpm audit`, Dependabot) in CI; Electron pinned to a supported major and bumped for Chromium CVEs — the known cost of choosing Electron.

### Audit
The product ships an audit log (Enterprise). Operationally: 90-day retention, owner-only, actor + IP + country on every entry, optional SIEM streaming with signing secret. Workspace exports, permission changes, integration installs, and API-key creation must all be recorded — those are the events an incident review needs.

## Observability

| Layer | Tool | What it answers |
|---|---|---|
| Metrics | Prometheus (`/metrics`, internal) + Grafana | Is it slow, and where? |
| Logs | JSON to Docker (capped 10m × 3), optionally shipped to Loki | What happened to this request? |
| Traces | OTel, sampled | Why was this mutation 900 ms? |
| Uptime | External checker on `/healthz` | Is it down when I can't see it? |
| Errors | Sentry (self-hosted or SaaS), separate DSNs for Go and web | What is breaking for users? |

### Metrics worth having on day one

```
polaris_graphql_request_duration_seconds{operation,status}
polaris_graphql_complexity{operation}
polaris_sync_connections{workspace}
polaris_sync_fanout_latency_seconds          # change committed -> client push
polaris_sync_bootstraps_total{reason}        # a spike = resync storm
polaris_sync_resync_total{reason}
polaris_outbox_queue_depth{queue}
polaris_webhook_delivery_total{status}
polaris_webhook_delivery_latency_seconds
polaris_db_pool_wait_seconds
polaris_job_duration_seconds{job}
polaris_search_index_lag_seconds
```

`sync_fanout_latency` and `sync_bootstraps_total` are the two that tell you the product feels wrong before users report it.

### Alerts (to `ALERT_WEBHOOK_URL`)

| Alert | Threshold | Why it matters |
|---|---|---|
| Health check failing | 2 consecutive | Site down |
| p99 GraphQL latency | > 1 s for 5 min | Usually a plan flip or a missing index |
| Sync fan-out p99 | > 2 s for 5 min | Feels broken even though nothing errors |
| Bootstrap rate | > 10× baseline | Resync storm — the self-inflicted outage |
| Webhook queue depth | > 1,000 for 10 min | Integrations silently stale |
| Webhook failure rate | > 20% for one endpoint | That customer's automation is dead |
| DB connections | > 80% of pool | Saturation before it becomes timeouts |
| Disk | > 80% | Postgres + MinIO growth, or unbounded logs |
| Nightly backup | did not complete | The alert that pays for the whole system |
| Restore drill | not run in 40 days | Backups that were never restored |
| Cert expiry | < 14 days | NPM wildcard renewal failure |

## Runbooks

Written before they're needed, kept in `docs/runbooks/`:

| Situation | First moves |
|---|---|
| **Site down** | `./app.sh status`; `docker logs Polaris_api --tail=200`; check disk and `free -m`; check NPM is up (it serves 20 sites, so it's probably not NPM) |
| **Slow app** | Grafana p99 by operation → `pg_stat_statements` top by total time → `EXPLAIN` the offender → check for a plan flip after a data-volume change |
| **Resync storm** | Set the bootstrap kill-switch to serve cached snapshots; check whether a deploy changed `clientSchema`; roll back if so |
| **Bad deploy** | Auto-rollback should have fired; if not, `git checkout <prev tag> && ./app.sh restart`. **Verify the migration is compatible before rolling back** |
| **Bad migration** | Restore PITR to just before it on a scratch instance, extract what's needed. Never `DROP` your way out on the live database |
| **Data loss report** | Check soft-delete first (30-day window) — most "lost data" is a deleted issue or an archived project |
| **Webhook endpoint failing** | Delivery log for that endpoint; if it's the customer's outage, the auto-disable already fired; re-enable after they fix it |
| **Compromised token** | Revoke in `oauth_token`/`api_key`, force re-auth, audit-log query for that actor's activity, notify the workspace owner |
| **Disk full** | Docker logs are capped, so suspect Postgres bloat or MinIO. `polarisctl prune --change-log`, then vacuum |

## Backups and recovery targets

| Target | Value | Backed by |
|---|---|---|
| **RPO** | ≤ 5 min | WAL archiving to offsite |
| **RTO** | ≤ 2 h | Monthly restore drill; the drill's wall-clock is the real number |
| Nightly logical | 30 days | `pg_dump -Fc` → `/srv/polaris/backups` + offsite |
| PITR | 14 days | pgBackRest full weekly + daily incremental |
| Object storage | 30 days | `mc mirror` to B2/R2 |
| Config | in git | Except `polaris.env`, which lives in a password manager |

**The drill is the control, not the backup.** `scripts/restore-drill.sh` runs monthly: restore last night's dump into a throwaway container, run migrations, boot the API, hit `/healthz` and one real query, publish the elapsed time. If it hasn't run in 40 days, that alerts.

## Capacity limits to enforce in product

Infrastructure limits that must surface as product behaviour rather than 500s:

| Limit | Value | Behaviour |
|---|---|---|
| Issues per team | 60,000 non-archived | Warning banner to team members, warning email to admins first, then block integration/API creation |
| Open notifications | 2,000 | Oldest auto-archived |
| Attachment size | 25 MB | Rejected with a clear message at presign time |
| Workspace storage | quota per plan | Presign refuses; admin sees usage |
| Export size | 250 issues member / 2,000 admin | Documented, enforced |
| Bootstrap payload | soft cap | Beyond it, tiered bootstrap kicks in |
| Concurrent WS per user | 8 | Oldest dropped |

Every one of these exists in the product spec because the source product hit it. They are cheaper to implement than to discover.

## Compliance posture (when customers start asking)

- **GDPR** is unavoidable with EU customers: data export, deletion (the 48-hour workspace-deletion window plus a real purge job), a subprocessor list, and a DPA. Design the purge job early — "delete everything for workspace W across 30 tables, object storage, and search" is not a Friday-afternoon task.
- **SOC 2** is a 6–12 month programme (policies, access reviews, change management, vendor reviews, evidence collection). Start collecting evidence — audit logs, deploy records, access reviews — long before starting the audit.
- **Data residency** (US/EU) as specified in the product docs is an architecture decision, not a feature: it means separate deployments with a shared identity plane. Decide before the first EU enterprise customer asks, because retrofitting it is a migration project.
- **HIPAA** requires a BAA and drags encryption, access-log, and retention requirements across everything. Only pursue with a customer contract in hand.
