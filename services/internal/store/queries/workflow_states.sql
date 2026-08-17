-- name: CreateWorkflowState :one
INSERT INTO workflow_state (id, workspace_id, team_id, name, description, color, category, position, is_default, is_system)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, workspace_id, team_id, name, description, color, category, position,
          is_default, is_system, archived_at, created_at, updated_at;

-- name: GetWorkflowState :one
SELECT id, workspace_id, team_id, name, description, color, category, position,
       is_default, is_system, archived_at, created_at, updated_at
FROM workflow_state
WHERE id = $1;

-- name: ListWorkflowStatesForTeam :many
SELECT id, workspace_id, team_id, name, description, color, category, position,
       is_default, is_system, archived_at, created_at, updated_at
FROM workflow_state
WHERE team_id = $1 AND archived_at IS NULL
ORDER BY
  -- Categories have a fixed product order that is not alphabetical and not insertion
  -- order. Encoding it here keeps every caller — list grouping, board columns, bootstrap
  -- and the API — agreeing on one ordering without repeating the CASE.
  CASE category
    WHEN 'triage'    THEN 0
    WHEN 'backlog'   THEN 1
    WHEN 'unstarted' THEN 2
    WHEN 'started'   THEN 3
    WHEN 'completed' THEN 4
    WHEN 'canceled'  THEN 5
    WHEN 'duplicate' THEN 6
  END,
  position;

-- name: ListWorkflowStatesInWorkspace :many
SELECT id, workspace_id, team_id, name, description, color, category, position,
       is_default, is_system, archived_at, created_at, updated_at
FROM workflow_state
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY team_id, position;

-- name: GetDefaultWorkflowStateForTeam :one
SELECT id, workspace_id, team_id, name, description, color, category, position,
       is_default, is_system, archived_at, created_at, updated_at
FROM workflow_state
WHERE team_id = $1 AND is_default AND archived_at IS NULL;

-- name: UpdateWorkflowState :one
UPDATE workflow_state
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    color       = COALESCE(sqlc.narg(color), color),
    position    = COALESCE(sqlc.narg(position), position)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, team_id, name, description, color, category, position,
          is_default, is_system, archived_at, created_at, updated_at;

-- ClearDefaultWorkflowState must run immediately before setting a new default, in the
-- same transaction: workflow_state_team_default_key is a partial unique index, so doing
-- it the other way round fails.
--
-- name: ClearDefaultWorkflowState :exec
UPDATE workflow_state SET is_default = false WHERE team_id = $1 AND is_default;

-- name: SetDefaultWorkflowState :exec
UPDATE workflow_state SET is_default = true WHERE id = $1;

-- name: ArchiveWorkflowState :exec
UPDATE workflow_state SET archived_at = now() WHERE id = $1 AND NOT is_system;

-- UnarchiveWorkflowState returns the row: the archive reached every client as a delete, so
-- putting the status back is an upsert and needs the payload.
--
-- workflow_state_team_name_key is partial on archived_at IS NULL, so the name this status
-- held was released when it was archived and the team may have reused it. The violation is
-- allowed to happen and translated above, rather than pre-checked — a check would be a read
-- the index performs again a moment later, and it would still be racing.
--
-- name: UnarchiveWorkflowState :one
UPDATE workflow_state SET archived_at = NULL
WHERE id = $1 AND archived_at IS NOT NULL AND NOT is_system
RETURNING id, workspace_id, team_id, name, description, color, category, position,
          is_default, is_system, archived_at, created_at, updated_at;

-- name: CountIssuesInWorkflowState :one
SELECT count(*) FROM issue WHERE state_id = $1 AND deleted_at IS NULL;
