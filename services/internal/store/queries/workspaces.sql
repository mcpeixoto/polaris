-- name: CreateWorkspace :one
INSERT INTO workspace (id, name, url_key, plan, settings)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, url_key, logo_url, settings, plan,
          archived_at, deleted_at, created_at, updated_at,
          plan_expires_at, seat_limit, plan_lapsed_at;

-- name: GetWorkspace :one
SELECT id, name, url_key, logo_url, settings, plan,
       archived_at, deleted_at, created_at, updated_at,
       plan_expires_at, seat_limit, plan_lapsed_at
FROM workspace
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetWorkspaceByURLKey :one
SELECT id, name, url_key, logo_url, settings, plan,
       archived_at, deleted_at, created_at, updated_at,
       plan_expires_at, seat_limit, plan_lapsed_at
FROM workspace
WHERE url_key = $1 AND deleted_at IS NULL;

-- name: UpdateWorkspace :one
UPDATE workspace
SET name     = COALESCE(sqlc.narg(name), name),
    logo_url = COALESCE(sqlc.narg(logo_url), logo_url),
    settings = COALESCE(sqlc.narg(settings), settings)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, name, url_key, logo_url, settings, plan,
          archived_at, deleted_at, created_at, updated_at,
          plan_expires_at, seat_limit, plan_lapsed_at;

-- CountWorkspaceSeats is the number the seat limit is checked against.
--
-- App users are excluded because a bot is not a person: charging for an integration's
-- identity would make every integration a purchasing decision. Suspended and archived
-- users are excluded because suspending somebody is how an admin frees a seat, and a
-- suspension that does not is a suspension that does nothing anybody asked for.
--
-- Run in the same transaction as the write that would consume the seat, or two concurrent
-- invitations each see one seat free and the workspace ends up one over its limit.
--
-- name: CountWorkspaceSeats :one
SELECT count(*) FROM "user"
WHERE workspace_id = $1
  AND kind = 'human'
  AND status = 'active'
  AND archived_at IS NULL;

-- name: InitWorkspaceVersion :exec
INSERT INTO workspace_version (workspace_id, version) VALUES ($1, 0)
ON CONFLICT (workspace_id) DO NOTHING;

-- BumpWorkspaceVersion is the serialisation point of the entire sync engine.
--
-- The UPDATE takes a row lock held until the transaction commits, so writes to one
-- workspace are totally ordered and the version sequence has no gaps. That is what lets
-- a client say "I am at 148213, send me everything after" and trust the answer without
-- reasoning about transactions still in flight.
--
-- Cost: a few sub-millisecond lock waits per second on a busy workspace. Benefit: the
-- client has no gap-detection logic at all.
--
-- name: BumpWorkspaceVersion :one
UPDATE workspace_version
SET version = version + 1
WHERE workspace_id = $1
RETURNING version;

-- name: GetWorkspaceVersion :one
SELECT version FROM workspace_version WHERE workspace_id = $1;

-- CountWorkspacesForAccount bounds how many one account may create.
--
-- The same predicates as ListWorkspacesForAccount, and they have to stay the same: a cap
-- counted differently from the switcher is a cap somebody hits with a screen in front of
-- them showing fewer workspaces than the number they were refused at.
--
-- Membership, not authorship, because `workspace` records no creator. Being invited to
-- somebody else's workspace therefore spends a slot, which is the conservative direction
-- and the one that matches what the number is protecting: how many workspaces this account
-- can cause the server to keep bootstrapping, syncing and fanning out for.
--
-- name: CountWorkspacesForAccount :one
SELECT count(*) FROM workspace w
JOIN "user" u ON u.workspace_id = w.id
WHERE u.account_id = $1
  AND u.archived_at IS NULL
  AND u.status = 'active'
  AND w.deleted_at IS NULL;

-- name: ListWorkspacesForAccount :many
SELECT w.id, w.name, w.url_key, w.logo_url, w.settings, w.plan,
       w.archived_at, w.deleted_at, w.created_at, w.updated_at,
       w.plan_expires_at, w.seat_limit, w.plan_lapsed_at,
       u.id AS user_id, u.role AS user_role
FROM workspace w
JOIN "user" u ON u.workspace_id = w.id
WHERE u.account_id = $1
  AND u.archived_at IS NULL
  AND u.status = 'active'
  AND w.deleted_at IS NULL
ORDER BY w.name;

-- BumpWorkspaceVersionBy reserves n consecutive versions in one statement and returns
-- the LAST one; the caller assigns (version-n+1 .. version) to its change rows.
--
-- A bulk action touching 200 issues is one round trip and one lock acquisition instead
-- of 200 of each, while keeping the sequence gapless.
--
-- name: BumpWorkspaceVersionBy :one
UPDATE workspace_version
SET version = version + sqlc.arg(n)::bigint
WHERE workspace_id = sqlc.arg(workspace_id)
RETURNING version;

-- NotifySyncHub wakes the sync hubs for a workspace.
--
-- Deliberately pg_notify rather than a Valkey PUBLISH after commit: NOTIFY is delivered
-- by Postgres *on commit* and not at all on rollback, so a wakeup can never be sent for a
-- change that did not happen, and a committed change can never fail to send one. A
-- publish-after-commit has a window where the process dies between the two and the delta
-- sits unseen until someone reconnects.
--
-- The payload is only the workspace id and the new version watermark. Hubs read the rows
-- themselves, which keeps the message tiny and means a hub that misses one self-heals on
-- the next.
--
-- Cost: hubs need a session-mode connection for LISTEN, so they connect straight to
-- Postgres rather than through pgbouncer's transaction pool. See POLARIS_LISTEN_DATABASE_URL.
--
-- name: NotifySyncHub :exec
SELECT pg_notify('polaris_sync', sqlc.arg(payload)::text);
