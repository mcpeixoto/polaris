# Data layer

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

## PostgreSQL

**Version 17.** Single instance on the VPS, on `polaris_internal` only.

### Sizing model

| Entity | Row size (with indexes) | 100k-issue workspace |
|---|---|---|
| issue | ~1.5 KB | 150 MB |
| issue_history | ~350 B × ~25/issue | 875 MB |
| comment | ~700 B × ~4/issue | 280 MB |
| change_log (30d) | ~1.2 KB × writes | 200 MB–1 GB |
| attachments (metadata) | ~400 B | 20 MB |
| everything else | — | ~100 MB |

**≈2–3 GB per large workspace.** Ten such workspaces still fits comfortably on a 160 GB NVMe. The growth risk is `issue_history` and `change_log`, not issues — both need partitioning and pruning from day one, not retrofitted.

### Key schema decisions

```sql
-- every table
workspace_id uuid NOT NULL,   -- on EVERY table, even where derivable
id           uuid PRIMARY KEY DEFAULT uuidv7(),
created_at   timestamptz NOT NULL DEFAULT now(),
updated_at   timestamptz NOT NULL DEFAULT now(),
archived_at  timestamptz,
deleted_at   timestamptz      -- 30-day recovery window
```

`workspace_id` everywhere is redundant and deliberate: every query filters on it, every index leads with it, and it makes a future per-workspace shard or export trivially expressible.

**Issue identifiers.** `team_id + number`, with the number from a per-team counter row (same lock pattern as the sync version). Plus:

```sql
CREATE TABLE issue_identifier_history (
  workspace_id uuid, old_identifier text, issue_id uuid,
  PRIMARY KEY (workspace_id, old_identifier)
);
```

Old identifiers must resolve forever — team moves mint a new one, but URLs, git magic words, autolinks, and release scanning all still reference the old.

**Partitioning** (monthly, by `created_at`):
- `change_log` — dropped after 30 days, so partitions are dropped, never `DELETE`d
- `issue_history` — retained, but partitioning keeps index bloat and vacuum cost bounded
- `webhook_delivery` — 14-day retention
- `audit_entry` — 90-day retention (matches the product spec)

**Status categories** are an enum-like lookup, never free text: `triage|backlog|unstarted|started|completed|canceled|duplicate`. Import mapping, insights, automations, and cross-team filters all key off the category rather than the name.

### Indexes the filter grammar needs

The product's filter language compiles to SQL, and the wrong index set makes every view slow.

```sql
-- the workhorse
CREATE INDEX ON issue (workspace_id, team_id, state_id)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX ON issue (workspace_id, assignee_id, updated_at DESC);
CREATE INDEX ON issue (workspace_id, project_id);
CREATE INDEX ON issue (workspace_id, cycle_id);
CREATE INDEX ON issue (workspace_id, updated_at DESC);   -- API orderBy: updatedAt
CREATE INDEX ON issue (workspace_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX ON issue (workspace_id, sla_status) WHERE sla_status IS NOT NULL;

-- many-to-many
CREATE INDEX ON issue_label (label_id, issue_id);
CREATE INDEX ON issue_label (issue_id, label_id);

-- text
CREATE INDEX ON issue USING gin (to_tsvector('simple', title || ' ' || coalesce(description,'')));
CREATE INDEX ON issue USING gin (title gin_trgm_ops);   -- typo-tolerant quick find
```

Rules that keep this honest:
1. **Partial indexes on `deleted_at IS NULL`** — the overwhelming majority of queries exclude deleted rows.
2. **Every list query is `LIMIT`ed** and cursor-paginated on `(sort_key, id)`; never `OFFSET`.
3. **`EXPLAIN` regression tests** for the ten most common view shapes, run in CI against seeded data. A plan flip from index scan to seq scan is a production incident that shows up as "the app got slow" three weeks later.
4. **`pg_stat_statements` on**, reviewed when a latency alert fires.

### Connection pooling

`pgbouncer` in **transaction** mode.

```
max_client_conn = 500
default_pool_size = 25      # per (db,user)
reserve_pool_size = 5
server_idle_timeout = 60
```

Go opens few connections, but `api` × N + `sync` × N + `worker` × N add up, and each Postgres backend costs ~10 MB. Transaction mode forbids session-level state — no `SET`, no advisory-lock-across-statements, no prepared-statement names shared across transactions. `pgx` handles this with `statement_cache_mode=describe`; set it explicitly or you will chase a confusing "prepared statement already exists" bug.

Long-running work (bootstrap streaming, exports, imports) uses a **separate direct pool** bypassing pgbouncer — a 40-second snapshot transaction must not hold a pooled slot.

### Migrations

`golang-migrate`, **forward-only, additive, and deploy-compatible with the previous revision** — the tag-deploy rollback path reverts code, not schema, so a migration that breaks release N-1 turns a rollback into an outage.

Expand/contract, always:
```
release N   : add nullable column, backfill in a job, dual-write
release N+1 : start reading the new column
release N+2 : drop the old column
```
Never rename or drop in the same release that stops using something.

Migrations run in an **init container before `api` starts**, exactly once per deploy, guarded by an advisory lock so parallel replicas don't race.

**Extra constraint that doesn't exist in a normal app:** a schema change that alters the shape of a sync payload must bump `clientSchema`, forcing clients to re-bootstrap. Additive optional fields don't; renames, type changes, and removals do. Put this in the PR checklist.

## Redis

One instance, `appendonly no` (nothing here is the system of record), `maxmemory-policy allkeys-lru` for the cache DB.

| Use | Structure | Notes |
|---|---|---|
| Change fan-out | pub/sub `polaris:ws:<workspaceId>` | Watermark only, never payloads |
| Job queue | asynq (lists + zsets) | **This one is durable** — use a separate logical DB with AOF on, or accept that a Redis restart loses queued webhook deliveries |
| Rate limits | `INCR` + `EXPIRE` per (user, window) | Request counts and complexity budgets |
| Idempotency | `SETNX opId` 24h | Mutation replay protection |
| Presence | sets with TTL per document/issue | Ephemeral by design |
| Hot caches | permission sets, workspace settings | Invalidated by change_log |

**Split the queue from the cache.** A `FLUSHDB` on the cache must never drop pending webhook deliveries.

## Object storage — MinIO

S3 API so the migration path to Cloudflare R2 or S3 is a config change, not a code change.

Buckets: `attachments`, `avatars`, `exports`, `imports`, `backups`.

- **Uploads** are presigned PUTs direct from the browser — never proxied through Go.
- **Downloads** go through `/files/:id`: the API checks permission, then 302s to a short-lived (5 min) presigned GET. This is what makes "assets sit behind authentication" true, which the API spec requires.
- **Never make a bucket public.**
- Content-addressed keys (`sha256/ab/cd/<hash>`) deduplicate the same screenshot pasted into twenty issues.
- Antivirus scanning on upload (ClamAV sidecar) — deferred, but leave the hook: user-uploaded files served back to other users is the classic path to hosting malware for someone's org.
- Quotas per workspace, enforced at presign time.

**When to leave MinIO:** the moment attachments exceed ~30% of disk, or you want CDN delivery. R2 has no egress fees and the same API.

## Search — Meilisearch

Indexes: `issues`, `projects`, `documents`, `comments`.

```jsonc
// issues index settings
{
  "searchableAttributes": ["identifier", "title", "description", "comments_blob"],
  "filterableAttributes": ["workspace_id", "team_id", "state_category", "assignee_id",
                           "project_id", "label_ids", "archived", "private_team"],
  "sortableAttributes": ["updated_at", "created_at"],
  "rankingRules": ["words","typo","proximity","attribute","sort","exactness"],
  "stopWords": ["a","an","and","are","as","at","be","but","by","for","if","in","into",
                "is","it","no","not","of","on","or","such","that","the","their","then",
                "there","these","they","this","to","was","will","with"]
}
```

That stop-word list is the one the product spec documents. Quoted queries bypass it; unquoted queries strip it.

**Permission filtering is non-negotiable and happens at query time** — every search request injects `workspace_id = W AND team_id IN (visible teams)`. Never rely on post-filtering results, or a user learns private issue titles from result counts.

Indexing is asynchronous, driven off `change_log` by the worker, batched (200 docs / 2s). Search lag of a second or two is acceptable; a lost document is not — the reindex job (`polarisctl reindex --workspace=W`) must be safe to run any time.

**Start without it.** Postgres FTS (the GIN indexes above) covers search well enough for the first workspaces and removes 512 MB of RAM plus a service from the box. Add Meilisearch when typo tolerance and ranking quality start mattering — the search interface is one Go package either way.

## Backups

Three layers, because losing this database ends the product:

| Layer | Mechanism | Retention | Restores what |
|---|---|---|---|
| Nightly logical | `pg_dump -Fc` → `/srv/polaris/backups` | 30 days (house standard) | "Someone deleted a team" |
| Continuous physical | `pgBackRest` full weekly + incremental daily + WAL archive | 14 days PITR | "The disk died" / "a bad migration at 14:03" |
| Offsite | Both of the above replicated to B2/R2, encrypted | 30 days | "The VPS is gone" |

MinIO buckets replicate to the same offsite target (`mc mirror --watch`). Redis is not backed up — it holds nothing irreplaceable except the job queue, which is acceptable to lose.

**A backup you have not restored is a rumour.** Monthly drill, scripted (`scripts/restore-drill.sh`): pull last night's dump into a throwaway container, run migrations, boot the API against it, hit `/healthz` and one real query, record the wall-clock time. That number is your actual RTO — see `08-security-and-operations.md`.
