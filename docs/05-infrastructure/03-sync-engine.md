# Sync engine

The single most expensive subsystem, and the one the product's feel depends on. Everything else in this repo is replaceable; this is not.

**Model:** server-authoritative, local-first. The client holds a permission-scoped replica of its workspace, renders entirely from it, applies mutations optimistically, and reconciles against an ordered change stream.

## Ordering: per-workspace versions

Every write bumps a **gapless, totally ordered version** scoped to the workspace.

```sql
CREATE TABLE workspace_version (
  workspace_id uuid PRIMARY KEY,
  version      bigint NOT NULL DEFAULT 0
);

CREATE TABLE change_log (
  workspace_id uuid   NOT NULL,
  version      bigint NOT NULL,
  entity_type  text   NOT NULL,     -- 'issue' | 'project' | ...
  entity_id    uuid   NOT NULL,
  op           text   NOT NULL,     -- 'upsert' | 'delete' | 'revoke'
  team_id      uuid,                -- visibility key
  scope        jsonb  NOT NULL,     -- extra visibility facts (see below)
  actor_type   text   NOT NULL,     -- user | app_user | integration | system
  actor_id     uuid,
  payload      jsonb,               -- full entity row as clients see it
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, version)
);
CREATE INDEX ON change_log (workspace_id, version) INCLUDE (team_id);
```

Assignment happens **inside the mutation transaction**:

```sql
UPDATE workspace_version
   SET version = version + 1
 WHERE workspace_id = $1
RETURNING version;
```

That row lock serialises writes *per workspace*. A busy workspace does a few writes per second and the lock is held for sub-millisecond; the cost is negligible and the benefit is enormous — **no gaps, no out-of-order commits, no "did I miss a row?" logic on the client.**

> The alternative — global `bigserial` + commit-LSN watermarks — avoids the lock but forces every client to reason about in-flight transactions. Not worth it until a single workspace sustains hundreds of writes/second. Revisit then; the protocol doesn't change, only how `version` is minted.

`payload` is the entity **as the client stores it**, produced by one serialiser shared with the GraphQL layer. If the two ever diverge, the client renders one thing and the API returns another.

## Visibility: filtering the stream

Every client's replica is a *different* subset. The change row carries enough to decide, without re-querying:

```jsonc
// scope examples
{ "kind": "team" }                                   // normal team-scoped entity
{ "kind": "team", "private": true }                  // private team
{ "kind": "workspace" }                              // initiatives, customers, labels
{ "kind": "issue_shared", "shared_with": ["<uid>"] } // Enterprise per-issue sharing
{ "kind": "project", "team_ids": ["…","…"] }         // multi-team project
```

At connect time the session resolves a **visibility set**: accessible team ids (public teams + joined private teams + sub-teams), guest flag, and explicitly shared entity ids. Deltas filter on it:

```go
func (s *Session) Visible(c ChangeRow) bool {
    switch c.Scope.Kind {
    case "workspace":     return !s.IsGuest
    case "team", "project": return s.Teams.HasAny(c.TeamIDs())
    case "issue_shared":  return s.Teams.Has(c.TeamID) || c.SharedWith.Has(s.UserID)
    }
    return false
}
```

**This must be the same predicate the GraphQL resolvers use** (`internal/authz`). Two implementations means one of them leaks a private team.

### Revocation is a first-class event
Access changes are not just data changes:

| Trigger | Emitted |
|---|---|
| Team made private | `revoke` for every entity of that team, to non-members |
| User removed from a team / leaves | `revoke` for that team's entities, to that user |
| Issue un-shared | `revoke` for the issue + sub-tree |
| Guest removed from a team | `revoke` |
| Entity moved to a team the user can't see | `revoke` |

`revoke` carries no payload — the client deletes locally. Without this, a user who loses access keeps a perfectly readable local copy forever.

## Wire protocol

WebSocket, JSON (binary/CBOR later if payload size bites), one connection per workspace.

**Client → server**

```jsonc
{ "t": "hello", "token": "<jwt>", "workspace": "<uuid>",
  "resume": 148213, "clientSchema": 7, "clientId": "<uuid>" }

{ "t": "ping" }                                  // every 30s, required
{ "t": "subscribe", "channels": ["presence:issue:<id>"] }
```

**Server → client**

```jsonc
{ "t": "ready", "version": 148213, "serverTime": "…", "heartbeat": 30 }

{ "t": "delta", "from": 148213, "to": 148219, "changes": [
    { "v": 148214, "type": "issue", "id": "…", "op": "upsert",
      "actor": {"type":"user","id":"…"}, "payload": { … } },
    { "v": 148217, "type": "comment", "id": "…", "op": "delete" }
]}

{ "t": "resync", "reason": "gap_too_large" | "schema_changed" | "permissions_changed" }
{ "t": "ack",  "ops": ["<opId>", …], "version": 148220 }
{ "t": "nack", "op": "<opId>", "code": "CONFLICT|FORBIDDEN|VALIDATION", "server": { … } }
{ "t": "pong" }
```

Mutations do **not** travel over the WebSocket. They go over `POST /graphql` — same path integrations and the SDK use, so there is exactly one write path with one authorisation and rate-limiting implementation. The socket is a read channel plus acknowledgements.

## Bootstrap

```
GET /sync/bootstrap?workspace=W&schema=7
Accept: application/x-ndjson
```

Server, inside one `REPEATABLE READ` transaction:
1. Read the current `version` → emit as the first line.
2. Stream permission-filtered rows per entity type, in dependency order (teams → statuses → labels → members → cycles → projects → milestones → issues → relations → comments → …).
3. Emit a terminator.

Gzip on. Chunked. The client writes into IndexedDB in batched transactions with a progress UI.

**Scoping the snapshot is a product decision, not just a technical one.** Do not ship the entire history:

| Included at bootstrap | Loaded on demand |
|---|---|
| All teams, statuses, labels, members, cycles, projects, milestones, initiatives, views, templates | Archived issues (never cached — matches Linear) |
| Non-archived issues, their properties and relations | Comments beyond the most recent N per issue |
| Recent comments + attachments for recent issues | Documents' full text (metadata only at boot) |
| Customers and requests (unless guest) | Old activity history |
| Your notifications | Insights results (always server-side) |

A 100k-issue workspace at ~1.2 KB/issue is ~120 MB raw, ~15–25 MB gzipped — a slow but survivable first load. Beyond that, add a second tier: bootstrap only issues from the last N months plus everything referenced by your views, and lazily fetch the rest. Build the tiering hook now even if it's a no-op.

## Client store

```
IndexedDB: polaris/<workspaceId>/v<clientSchema>
  objectStores: issue, project, cycle, comment, label, team, user, …
  meta: { version, bootstrapAt, clientSchema }
  outbox: [{ opId, mutation, variables, optimisticPatch, attempts, createdAt }]
```

On load, entities are read into memory (typed arrays / maps) and secondary indexes are built: by team, by status, by assignee, by project, by cycle, by label, by updatedAt, plus a title trigram map for in-view find. Filters, grouping, ordering, and peek all execute against these. **Target: <16 ms to re-render a 5,000-issue filtered list.**

`clientSchema` is bumped whenever the local shape changes. On mismatch: drop the database and re-bootstrap. Cheap, obvious, and impossible to get subtly wrong — which matters more than the one-off cost.

## Mutations, optimism, and conflict

```ts
async function mutate(op: Op) {
  const patch = applyOptimistic(op)          // 1. local apply, instant render
  await outbox.append({ opId: uuidv7(), op, patch })
  try {
    const res = await gql(op)                // 2. authoritative write
    outbox.resolve(op.opId, res)             // 3. server truth replaces patch
  } catch (e) {
    if (isOffline(e)) return                 // stays queued
    rollback(patch); surfaceError(e)
  }
}
```

**Idempotency.** Every mutation carries `opId`. The server records `(client_id, op_id)` for 24h and returns the original result on replay — so a retry after a dropped response never double-applies.

**Conflict policy — deliberately boring:**

| Data | Policy |
|---|---|
| Scalar fields (status, assignee, priority, dates, estimate) | **Last write wins**, server-ordered. The delta stream carries the truth; the client discards its optimistic patch |
| Sets (labels, subscribers, members) | Add/remove ops, not whole-set writes — so two concurrent label adds both survive |
| Ordering (manual sort, priority order) | Fractional-index keys (`between(prev, next)`), server-validated. Avoids reindex storms; global order is a product requirement |
| Rich text (descriptions, documents, comments in edit) | **Yjs CRDT** over a separate awareness channel; the delta stream carries only the resulting snapshot + version |
| Counters/derived (progress %, milestone completion) | Never client-authored; computed server-side and shipped as payload |

This mirrors the documented trade-off in the source product: offline edits can overwrite a teammate's change. Make it *visible* rather than silently lossy — if a delta arrives that conflicts with an unacknowledged op on the same field, show a small "updated by X while you were offline" affordance instead of quietly discarding.

## Reconnect and gaps

```
disconnect → exponential backoff (1s → 30s, jittered), keep rendering from local store
reconnect  → hello{resume: V}
             ├─ V within retention → delta stream from V
             └─ V too old / permissions changed / schema changed → {resync}
                → re-bootstrap (progress UI, store kept until swap succeeds)
```

`change_log` retention: **30 days**, pruned nightly, partitioned monthly. A client offline longer than that re-bootstraps. Keep the retention window comfortably longer than the longest plausible laptop-in-a-drawer.

## Fan-out across replicas

```
api (write) ──> Postgres tx ──> NOTIFY / Redis PUBLISH polaris:ws:<workspaceId> {version}
                                        │
sync replica A ─ SUBSCRIBE ─────────────┤
sync replica B ─ SUBSCRIBE ─────────────┘
   each replica: for its sessions on that workspace,
   fetch change_log rows (version_seen, newVersion], filter by visibility, push
```

Publish only the **version watermark**, not the payload: replicas read the rows from Postgres. That keeps the pub/sub message tiny, avoids Redis becoming a durability dependency, and means a replica that missed a message self-heals on the next one.

Per-workspace row cache in each replica (last ~1000 changes, LRU) keeps the common case out of Postgres entirely.

## Backpressure and abuse limits

| Limit | Value (start) | Behaviour on breach |
|---|---|---|
| Outbound buffer per session | 4 MB or 5,000 changes | Drop buffer, send `{resync}` |
| Delta batch size | 500 changes / 1 MB | Split across frames |
| Connections per user | 8 | Oldest closed |
| Connections per workspace | 2,000 | Reject with retry-after |
| Missed pongs | 2 (60s) | Close; client reconnects |
| Bootstraps per user | 3 / 10 min | 429 — protects against a resync loop stampede |

A resync storm is the realistic outage mode here: one bad deploy sets `clientSchema` wrong, every client re-bootstraps at once, Postgres saturates. Mitigations: jittered resync delays (0–60s), a global bootstrap concurrency semaphore, and a kill-switch env var that serves bootstraps from a cached snapshot.

## Change log ≠ activity log

Two different things that people conflate:

- **`change_log`** — mechanical, every field, 30-day retention, drives sync and outbound webhooks.
- **`issue_history` / activity feed** — a product feature, curated, permanent, and subject to product rules (e.g. property changes in the first 3 minutes after creation are folded into creation and never shown).

Emit both from `domain/events.go`, in the same transaction, from the same call site.

## Test plan (this subsystem earns its own)

1. **Property test:** apply a random op sequence to server + N clients with random disconnects; assert every client converges to server state.
2. **Permission fuzz:** randomly change team privacy/membership mid-stream; assert no client ever holds an entity it may not see (the leak test).
3. **Offline replay:** queue 500 ops offline, reconnect, assert order, idempotency, and no duplicates.
4. **Gap forcing:** set retention to minutes in a test env, force `resync`, assert clean recovery.
5. **Load:** 1,000 simulated clients on one workspace, 20 writes/sec; measure fan-out p99 (< 250 ms target) and memory per connection.
6. **Snapshot consistency:** bootstrap while writes stream; assert the snapshot + subsequent deltas equal the final server state.

## Build order

1. Change log + version minting + `domain/events.go` (Phase 0 — before any feature depends on it)
2. Bootstrap endpoint + IndexedDB store + in-memory indexes
3. WebSocket hub, single replica, no permissions beyond team membership
4. Optimistic mutations + outbox + idempotency
5. Visibility filtering + revoke events (with the private-teams feature)
6. Redis fan-out for multiple replicas
7. Backpressure, resync, retention pruning
8. Yjs channel for documents (with the documents feature)
