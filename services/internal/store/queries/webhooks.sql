-- Webhooks are not replicated. Queries that list or return a webhook to an API caller
-- never select `secret`. The delivery path is the one place that needs it, and it is a
-- separate query so a future listing that grows a field cannot accidentally start
-- returning credentials.

-- name: CreateWebhook :one
INSERT INTO webhook (id, workspace_id, creator_id, url, secret, enabled,
                     all_public_teams, team_id, resource_types)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(creator_id), sqlc.arg(url),
        sqlc.arg(secret), sqlc.arg(enabled), sqlc.arg(all_public_teams),
        sqlc.narg(team_id), sqlc.arg(resource_types))
RETURNING id, workspace_id, creator_id, url, enabled, all_public_teams, team_id,
          resource_types, consecutive_failures, disabled_at, created_at, updated_at;

-- name: ListWebhooks :many
SELECT id, workspace_id, creator_id, url, enabled, all_public_teams, team_id,
       resource_types, consecutive_failures, disabled_at, created_at, updated_at
FROM webhook
WHERE workspace_id = $1
ORDER BY created_at DESC;

-- name: GetWebhook :one
SELECT id, workspace_id, creator_id, url, enabled, all_public_teams, team_id,
       resource_types, consecutive_failures, disabled_at, created_at, updated_at
FROM webhook
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id);

-- name: ListEnabledWebhooks :many
SELECT id, workspace_id, creator_id, url, enabled, all_public_teams, team_id,
       resource_types, consecutive_failures, disabled_at, created_at, updated_at
FROM webhook
WHERE workspace_id = $1 AND enabled = true;

-- name: UpdateWebhookEnabled :one
UPDATE webhook
SET enabled = sqlc.arg(enabled),
    disabled_at = CASE WHEN sqlc.arg(enabled)::boolean THEN NULL ELSE now() END,
    consecutive_failures = CASE WHEN sqlc.arg(enabled)::boolean THEN 0 ELSE consecutive_failures END
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)
RETURNING id, workspace_id, creator_id, url, enabled, all_public_teams, team_id,
          resource_types, consecutive_failures, disabled_at, created_at, updated_at;

-- name: DisableWebhook :exec
UPDATE webhook
SET enabled = false, disabled_at = now()
WHERE id = $1 AND enabled = true;

-- name: RecordWebhookSuccess :exec
UPDATE webhook SET consecutive_failures = 0 WHERE id = $1;

-- name: RecordWebhookFailure :one
UPDATE webhook
SET consecutive_failures = consecutive_failures + 1
WHERE id = $1
RETURNING consecutive_failures;

-- name: DeleteWebhook :one
DELETE FROM webhook
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)
RETURNING id;

-- name: GetWebhookCursor :one
SELECT coalesce((SELECT version FROM webhook_cursor WHERE workspace_id = $1), 0)::bigint;

-- name: AdvanceWebhookCursor :exec
INSERT INTO webhook_cursor (workspace_id, version)
VALUES (sqlc.arg(workspace_id), sqlc.arg(version))
ON CONFLICT (workspace_id) DO UPDATE SET version = EXCLUDED.version
WHERE EXCLUDED.version > webhook_cursor.version;

-- Pin the cursor at create time so turning a webhook on does not replay the workspace's
-- entire change_log into a stranger's URL.
-- name: EnsureWebhookCursorAtLeast :exec
INSERT INTO webhook_cursor (workspace_id, version)
VALUES (sqlc.arg(workspace_id), sqlc.arg(version))
ON CONFLICT (workspace_id) DO UPDATE SET version = EXCLUDED.version
WHERE EXCLUDED.version > webhook_cursor.version;

-- name: ListWorkspacesWithPendingWebhooks :many
SELECT wv.workspace_id
FROM workspace_version wv
JOIN webhook w ON w.workspace_id = wv.workspace_id AND w.enabled = true
LEFT JOIN webhook_cursor wc ON wc.workspace_id = wv.workspace_id
WHERE wv.version > coalesce(wc.version, 0)
GROUP BY wv.workspace_id;

-- name: InsertWebhookDelivery :one
INSERT INTO webhook_delivery (
  id, workspace_id, webhook_id, change_version, entity_type, entity_id, op, payload
) VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(webhook_id), sqlc.arg(change_version),
  sqlc.arg(entity_type), sqlc.arg(entity_id), sqlc.arg(op), sqlc.arg(payload)
)
ON CONFLICT (webhook_id, change_version) DO NOTHING
RETURNING id, workspace_id, webhook_id, change_version, entity_type, entity_id, op,
          payload, attempt, next_attempt_at, last_status, last_error, last_duration_ms,
          last_snippet, delivered_at, created_at;

-- name: ListDueWebhookDeliveries :many
SELECT d.id, d.workspace_id, d.webhook_id, d.change_version, d.entity_type, d.entity_id,
       d.op, d.payload, d.attempt, d.next_attempt_at, d.last_status, d.last_error,
       d.last_duration_ms, d.last_snippet, d.delivered_at, d.created_at,
       w.url, w.secret, w.enabled
FROM webhook_delivery d
JOIN webhook w ON w.id = d.webhook_id
WHERE d.delivered_at IS NULL
  AND d.next_attempt_at <= sqlc.arg(now)
  AND w.enabled = true
ORDER BY d.next_attempt_at
LIMIT sqlc.arg(page_size);

-- name: MarkWebhookDeliveryDelivered :exec
UPDATE webhook_delivery
SET delivered_at = now(),
    attempt = sqlc.arg(attempt),
    last_status = sqlc.arg(last_status),
    last_error = NULL,
    last_duration_ms = sqlc.arg(last_duration_ms),
    last_snippet = sqlc.narg(last_snippet)
WHERE id = sqlc.arg(id);

-- name: MarkWebhookDeliveryFailed :exec
UPDATE webhook_delivery
SET attempt = sqlc.arg(attempt),
    next_attempt_at = sqlc.arg(next_attempt_at),
    last_status = sqlc.narg(last_status),
    last_error = sqlc.narg(last_error),
    last_duration_ms = sqlc.arg(last_duration_ms),
    last_snippet = sqlc.narg(last_snippet)
WHERE id = sqlc.arg(id);

-- name: ListWebhookDeliveries :many
SELECT id, workspace_id, webhook_id, change_version, entity_type, entity_id, op,
       payload, attempt, next_attempt_at, last_status, last_error, last_duration_ms,
       last_snippet, delivered_at, created_at
FROM webhook_delivery
WHERE webhook_id = sqlc.arg(webhook_id) AND workspace_id = sqlc.arg(workspace_id)
ORDER BY created_at DESC
LIMIT sqlc.arg(page_size);

-- name: CountPendingWebhookDeliveries :one
SELECT count(*)::bigint FROM webhook_delivery
WHERE webhook_id = $1 AND delivered_at IS NULL;

-- name: PruneWebhookDeliveries :execrows
DELETE FROM webhook_delivery WHERE created_at < sqlc.arg(before);
