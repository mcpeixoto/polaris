-- Replicated columns only. webhook_secret is never selected here.

-- name: CreateSentryConnection :one
INSERT INTO sentry_connection (
  id, workspace_id, creator_id, enabled, default_team_id,
  organization_slug, webhook_secret, connected_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING id, workspace_id, creator_id, enabled, default_team_id,
          organization_slug, connected_at, created_at, updated_at;

-- name: GetSentryConnection :one
SELECT id, workspace_id, creator_id, enabled, default_team_id,
       organization_slug, connected_at, created_at, updated_at
FROM sentry_connection
WHERE workspace_id = $1;

-- name: GetSentryConnectionSecret :one
SELECT webhook_secret
FROM sentry_connection
WHERE workspace_id = $1;

-- name: UpdateSentryConnection :one
UPDATE sentry_connection
SET default_team_id = COALESCE(sqlc.narg(default_team_id), default_team_id),
    organization_slug = COALESCE(sqlc.narg(organization_slug), organization_slug),
    enabled = COALESCE(sqlc.narg(enabled), enabled),
    connected_at = COALESCE(sqlc.narg(connected_at), connected_at)
WHERE workspace_id = sqlc.arg(workspace_id)
RETURNING id, workspace_id, creator_id, enabled, default_team_id,
          organization_slug, connected_at, created_at, updated_at;

-- name: ClearSentryConnectionOrganizationSlug :exec
UPDATE sentry_connection
SET organization_slug = NULL
WHERE workspace_id = $1;

-- name: SetSentryConnectionSecret :exec
UPDATE sentry_connection
SET webhook_secret = sqlc.arg(webhook_secret)
WHERE workspace_id = sqlc.arg(workspace_id);

-- name: DeleteSentryConnection :exec
DELETE FROM sentry_connection WHERE workspace_id = $1;

-- name: StreamSentryConnectionsForBootstrap :many
SELECT id, workspace_id, creator_id, enabled, default_team_id,
       organization_slug, connected_at, created_at, updated_at
FROM sentry_connection
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
