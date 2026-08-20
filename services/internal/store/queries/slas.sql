-- name: CreateSlaRule :one
INSERT INTO sla_rule (id, workspace_id, position, filter, action, duration_minutes)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, position, filter, action, duration_minutes, created_at, updated_at;

-- name: GetSlaRule :one
SELECT id, workspace_id, position, filter, action, duration_minutes, created_at, updated_at
FROM sla_rule
WHERE id = $1;

-- name: GetSlaRuleForUpdate :one
SELECT id, workspace_id, position, filter, action, duration_minutes, created_at, updated_at
FROM sla_rule
WHERE id = $1
FOR UPDATE;

-- name: UpdateSlaRule :one
UPDATE sla_rule
SET filter           = COALESCE(sqlc.narg(filter), filter),
    action           = COALESCE(sqlc.narg(action), action),
    duration_minutes = CASE WHEN sqlc.arg(set_duration)::boolean THEN sqlc.narg(duration_minutes)
                            ELSE duration_minutes END,
    position         = COALESCE(sqlc.narg(position), position)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, position, filter, action, duration_minutes, created_at, updated_at;

-- name: DeleteSlaRule :exec
DELETE FROM sla_rule WHERE id = $1;

-- name: LastSlaRulePosition :one
SELECT position FROM sla_rule
WHERE workspace_id = $1
ORDER BY position DESC
LIMIT 1;

-- name: ListSlaRulesInWorkspace :many
SELECT id, workspace_id, position, filter, action, duration_minutes, created_at, updated_at
FROM sla_rule
WHERE workspace_id = $1
ORDER BY position;

-- name: StreamSlaRulesForBootstrap :many
SELECT id, workspace_id, position, filter, action, duration_minutes, created_at, updated_at
FROM sla_rule
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
