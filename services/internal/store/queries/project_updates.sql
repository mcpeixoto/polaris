-- name: CreateProjectUpdate :one
INSERT INTO project_update (id, workspace_id, project_id, health, body, author_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, project_id, health, body, author_id,
          edited_at, deleted_at, created_at, updated_at;

-- name: GetProjectUpdate :one
SELECT id, workspace_id, project_id, health, body, author_id,
       edited_at, deleted_at, created_at, updated_at
FROM project_update
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetProjectUpdateForUpdate :one
SELECT id, workspace_id, project_id, health, body, author_id,
       edited_at, deleted_at, created_at, updated_at
FROM project_update
WHERE id = $1 AND deleted_at IS NULL
FOR UPDATE;

-- name: UpdateProjectUpdate :one
UPDATE project_update
SET health = COALESCE(sqlc.narg(health), health),
    body = COALESCE(sqlc.narg(body), body),
    edited_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, project_id, health, body, author_id,
          edited_at, deleted_at, created_at, updated_at;

-- name: SoftDeleteProjectUpdate :one
UPDATE project_update SET deleted_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, workspace_id, project_id, health, body, author_id,
          edited_at, deleted_at, created_at, updated_at;

-- name: ListProjectUpdatesForProject :many
SELECT id, workspace_id, project_id, health, body, author_id,
       edited_at, deleted_at, created_at, updated_at
FROM project_update
WHERE project_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC;

-- StreamProjectUpdatesForBootstrap: visible when the project is visible.
--
-- name: StreamProjectUpdatesForBootstrap :many
SELECT pu.id, pu.workspace_id, pu.project_id, pu.health, pu.body, pu.author_id,
       pu.edited_at, pu.deleted_at, pu.created_at, pu.updated_at
FROM project_update pu
JOIN project p ON p.id = pu.project_id
WHERE pu.workspace_id = sqlc.arg(workspace_id)
  AND p.deleted_at IS NULL
  AND p.archived_at IS NULL
  AND pu.deleted_at IS NULL
  AND EXISTS (
        SELECT 1 FROM project_team pt
        WHERE pt.project_id = pu.project_id
          AND pt.team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND pu.id > sqlc.arg(after_id)
ORDER BY pu.id
LIMIT sqlc.arg(page_size);
