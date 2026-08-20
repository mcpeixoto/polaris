-- Replicated columns only. webhook_url and notify_cursor are never selected here.

-- name: CreateSlackConnection :one
INSERT INTO slack_connection (
  id, workspace_id, creator_id, enabled, default_team_id,
  channel_name, notify_issues, notify_comments, webhook_url, notify_cursor, connected_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
RETURNING id, workspace_id, creator_id, enabled, default_team_id,
          channel_name, notify_issues, notify_comments, connected_at, created_at, updated_at;

-- name: GetSlackConnection :one
SELECT id, workspace_id, creator_id, enabled, default_team_id,
       channel_name, notify_issues, notify_comments, connected_at, created_at, updated_at
FROM slack_connection
WHERE workspace_id = $1;

-- name: GetSlackConnectionWebhookURL :one
SELECT webhook_url
FROM slack_connection
WHERE workspace_id = $1;

-- name: GetSlackConnectionForNotify :one
SELECT id, workspace_id, enabled, notify_issues, notify_comments, webhook_url, notify_cursor
FROM slack_connection
WHERE workspace_id = $1;

-- name: UpdateSlackConnection :one
UPDATE slack_connection
SET default_team_id = COALESCE(sqlc.narg(default_team_id), default_team_id),
    channel_name = COALESCE(sqlc.narg(channel_name), channel_name),
    notify_issues = COALESCE(sqlc.narg(notify_issues), notify_issues),
    notify_comments = COALESCE(sqlc.narg(notify_comments), notify_comments),
    enabled = COALESCE(sqlc.narg(enabled), enabled),
    connected_at = COALESCE(sqlc.narg(connected_at), connected_at)
WHERE workspace_id = sqlc.arg(workspace_id)
RETURNING id, workspace_id, creator_id, enabled, default_team_id,
          channel_name, notify_issues, notify_comments, connected_at, created_at, updated_at;

-- name: ClearSlackConnectionChannelName :exec
UPDATE slack_connection
SET channel_name = NULL
WHERE workspace_id = $1;

-- name: SetSlackConnectionWebhookURL :exec
UPDATE slack_connection
SET webhook_url = sqlc.narg(webhook_url)
WHERE workspace_id = sqlc.arg(workspace_id);

-- name: AdvanceSlackNotifyCursor :exec
UPDATE slack_connection
SET notify_cursor = sqlc.arg(notify_cursor)
WHERE workspace_id = sqlc.arg(workspace_id);

-- name: DeleteSlackConnection :exec
DELETE FROM slack_connection WHERE workspace_id = $1;

-- name: StreamSlackConnectionsForBootstrap :many
SELECT id, workspace_id, creator_id, enabled, default_team_id,
       channel_name, notify_issues, notify_comments, connected_at, created_at, updated_at
FROM slack_connection
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: ListWorkspacesWithPendingSlack :many
SELECT sc.workspace_id
FROM slack_connection sc
JOIN workspace_version wv ON wv.workspace_id = sc.workspace_id
WHERE sc.enabled = true
  AND sc.webhook_url IS NOT NULL
  AND length(btrim(sc.webhook_url)) > 0
  AND wv.version > sc.notify_cursor;
