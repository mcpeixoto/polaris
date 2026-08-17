-- name: CreateUser :one
INSERT INTO "user" (id, workspace_id, account_id, name, display_name, avatar_url, timezone, role, kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, workspace_id, account_id, name, display_name, avatar_url, timezone,
          role, status, kind, last_seen_at,
          archived_at, created_at, updated_at, notification_prefs;

-- name: GetUser :one
SELECT id, workspace_id, account_id, name, display_name, avatar_url, timezone,
       role, status, kind, last_seen_at,
       archived_at, created_at, updated_at, notification_prefs
FROM "user"
WHERE id = $1;

-- name: GetUserByAccountAndWorkspace :one
SELECT id, workspace_id, account_id, name, display_name, avatar_url, timezone,
       role, status, kind, last_seen_at,
       archived_at, created_at, updated_at, notification_prefs
FROM "user"
WHERE account_id = sqlc.arg(account_id) AND workspace_id = sqlc.arg(workspace_id);

-- name: ListUsersInWorkspace :many
SELECT id, workspace_id, account_id, name, display_name, avatar_url, timezone,
       role, status, kind, last_seen_at,
       archived_at, created_at, updated_at, notification_prefs
FROM "user"
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY display_name;

-- name: UpdateUserProfile :one
UPDATE "user"
SET name         = COALESCE(sqlc.narg(name), name),
    display_name = COALESCE(sqlc.narg(display_name), display_name),
    avatar_url   = COALESCE(sqlc.narg(avatar_url), avatar_url),
    timezone     = COALESCE(sqlc.narg(timezone), timezone)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, account_id, name, display_name, avatar_url, timezone,
          role, status, kind, last_seen_at,
          archived_at, created_at, updated_at, notification_prefs;

-- name: SetUserRole :one
UPDATE "user" SET role = sqlc.arg(role) WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, account_id, name, display_name, avatar_url, timezone,
          role, status, kind, last_seen_at,
          archived_at, created_at, updated_at, notification_prefs;

-- name: SetUserStatus :one
UPDATE "user" SET status = sqlc.arg(status) WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, account_id, name, display_name, avatar_url, timezone,
          role, status, kind, last_seen_at,
          archived_at, created_at, updated_at, notification_prefs;

-- Preferences are replaced whole, not merged.
--
-- The client sends the complete bag it is holding, because a per-key patch would need a
-- delete sentinel to turn a channel off — jsonb_set cannot express "remove this key" and a
-- toggle that can only ever be switched on is not a preference. The bag is small and read
-- by one user at a time, so there is nothing to save by being cleverer.
--
-- name: UpdateUserNotificationPrefs :one
UPDATE "user" SET notification_prefs = sqlc.arg(notification_prefs)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, account_id, name, display_name, avatar_url, timezone,
          role, status, kind, last_seen_at,
          archived_at, created_at, updated_at, notification_prefs;

-- name: TouchUserLastSeen :exec
UPDATE "user" SET last_seen_at = now() WHERE id = $1;

-- RemoveUserFromWorkspace takes somebody out of the workspace without taking their work.
--
-- Both columns move together and neither alone is a removal: archived_at is what drops them
-- from the directory, the assignee picker and the seat count, and status is what
-- ResolvePrincipal reads to refuse their next request. Archiving without suspending leaves a
-- removed person still able to work; suspending without archiving is a suspension, which is
-- a different thing and one an admin can undo.
--
-- The row stays. Every issue, comment and history entry that names them references it, and
-- those foreign keys are ON DELETE SET NULL — deleting the row would not delete their work,
-- it would silently unattribute years of it.
--
-- name: RemoveUserFromWorkspace :one
UPDATE "user" SET archived_at = now(), status = 'suspended'
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, account_id, name, display_name, avatar_url, timezone,
          role, status, kind, last_seen_at,
          archived_at, created_at, updated_at, notification_prefs;

-- CountAdminsInWorkspace guards the "you cannot demote or suspend the last admin"
-- rule. Run inside the same transaction as the demotion, or two concurrent demotions
-- each see one remaining admin and lock everyone out of the workspace.
--
-- name: CountActiveAdminsInWorkspace :one
SELECT count(*) FROM "user"
WHERE workspace_id = $1
  AND role IN ('owner', 'admin')
  AND status = 'active'
  AND archived_at IS NULL;
