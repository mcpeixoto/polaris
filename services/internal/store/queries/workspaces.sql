-- name: CreateWorkspace :one
INSERT INTO workspace (id, name, url_key, plan, settings)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, url_key, logo_url, settings, plan,
          archived_at, deleted_at, created_at, updated_at,
          plan_expires_at, seat_limit, plan_lapsed_at,
          project_update_reminder_interval_days, project_update_reminder_weekday,
          project_update_reminder_hour, pulse_enabled, pulse_digest_cadence,
          customer_requests_enabled, customer_default_team_id, customer_revenue_unit,
          customer_tiers;

-- name: GetWorkspace :one
SELECT id, name, url_key, logo_url, settings, plan,
       archived_at, deleted_at, created_at, updated_at,
       plan_expires_at, seat_limit, plan_lapsed_at,
       project_update_reminder_interval_days, project_update_reminder_weekday,
       project_update_reminder_hour, pulse_enabled, pulse_digest_cadence,
       customer_requests_enabled, customer_default_team_id, customer_revenue_unit,
       customer_tiers
FROM workspace
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetWorkspaceByURLKey :one
SELECT w.id, w.name, w.url_key, w.logo_url, w.settings, w.plan,
       w.archived_at, w.deleted_at, w.created_at, w.updated_at,
       w.plan_expires_at, w.seat_limit, w.plan_lapsed_at,
       w.project_update_reminder_interval_days, w.project_update_reminder_weekday,
       w.project_update_reminder_hour, w.pulse_enabled, w.pulse_digest_cadence,
       w.customer_requests_enabled, w.customer_default_team_id, w.customer_revenue_unit,
       w.customer_tiers
FROM workspace w
WHERE w.deleted_at IS NULL
  AND (
    w.url_key = sqlc.arg(url_key)
    OR w.id = (
      SELECT a.workspace_id FROM workspace_url_alias a
      WHERE a.url_key = sqlc.arg(url_key)
    )
  );

-- name: InsertWorkspaceURLAlias :exec
INSERT INTO workspace_url_alias (url_key, workspace_id)
VALUES (sqlc.arg(url_key), sqlc.arg(workspace_id))
ON CONFLICT (url_key) DO NOTHING;

-- name: DeleteWorkspaceURLAlias :exec
DELETE FROM workspace_url_alias
WHERE url_key = sqlc.arg(url_key) AND workspace_id = sqlc.arg(workspace_id);

-- name: UpdateWorkspace :one
UPDATE workspace
SET name     = COALESCE(sqlc.narg(name), name),
    logo_url = COALESCE(sqlc.narg(logo_url), logo_url),
    url_key  = COALESCE(sqlc.narg(url_key), url_key),
    settings = COALESCE(sqlc.narg(settings), settings),
    project_update_reminder_interval_days = COALESCE(
        sqlc.narg(project_update_reminder_interval_days),
        project_update_reminder_interval_days),
    project_update_reminder_weekday = COALESCE(
        sqlc.narg(project_update_reminder_weekday), project_update_reminder_weekday),
    project_update_reminder_hour = COALESCE(
        sqlc.narg(project_update_reminder_hour), project_update_reminder_hour),
    pulse_enabled = COALESCE(sqlc.narg(pulse_enabled), pulse_enabled),
    pulse_digest_cadence = COALESCE(sqlc.narg(pulse_digest_cadence), pulse_digest_cadence),
    customer_requests_enabled = COALESCE(
        sqlc.narg(customer_requests_enabled), customer_requests_enabled),
    customer_default_team_id = CASE
        WHEN sqlc.arg(clear_customer_default_team)::boolean THEN NULL
        ELSE COALESCE(sqlc.narg(customer_default_team_id), customer_default_team_id) END,
    customer_revenue_unit = COALESCE(sqlc.narg(customer_revenue_unit), customer_revenue_unit),
    customer_tiers = CASE WHEN sqlc.arg(set_customer_tiers)::boolean THEN sqlc.arg(customer_tiers)
                          ELSE customer_tiers END
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, name, url_key, logo_url, settings, plan,
          archived_at, deleted_at, created_at, updated_at,
          plan_expires_at, seat_limit, plan_lapsed_at,
          project_update_reminder_interval_days, project_update_reminder_weekday,
          project_update_reminder_hour, pulse_enabled, pulse_digest_cadence,
          customer_requests_enabled, customer_default_team_id, customer_revenue_unit,
          customer_tiers;

-- CountWorkspaceSeats is the number the seat limit is checked against.
--
-- App users are excluded because a bot is not a person: charging for an integration's
-- identity would make every integration a purchasing decision. Suspended and archived
-- users are excluded because suspending somebody is how an admin frees a seat, and a
-- suspension that does not is a suspension that does nothing anybody asked for.
--
-- Guests are excluded because they are free, and this query said otherwise. It counted
-- every active human regardless of role, so a workspace that invited a dozen contractors
-- into one team hit its seat limit and was told to upgrade — while
-- docs/06-product-model/02-plans-and-packaging.md sold guests as a core, ungated feature
-- on the grounds that charging for an access-control boundary is user-hostile. Only one
-- of the two could be right, and the query is the one that refuses an invitation.
--
-- (00-overview/03-plan-matrix.md says guests are billed as members. That file describes
-- Linear's packaging as reference and not ours; ours is 06-product-model.)
--
-- web/src/features/admin/entitlements.ts re-implements this predicate against the local
-- replica, to answer without a round trip. The two have to agree or one screen says the
-- workspace is full while the next lets an invitation through.
--
-- Run in the same transaction as the write that would consume the seat, or two concurrent
-- invitations each see one seat free and the workspace ends up one over its limit.
--
-- name: CountWorkspaceSeats :one
SELECT count(*) FROM "user"
WHERE workspace_id = $1
  AND kind = 'human'
  AND status = 'active'
  AND role <> 'guest'
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
