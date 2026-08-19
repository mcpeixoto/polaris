-- name: CreateDocument :one
INSERT INTO document (
  id, workspace_id, team_id, project_id, title, body, sort_order, creator_id, updated_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
RETURNING id, workspace_id, team_id, project_id, title, body, sort_order,
          creator_id, updated_by, created_at, updated_at, archived_at, deleted_at;

-- name: GetDocument :one
SELECT id, workspace_id, team_id, project_id, title, body, sort_order,
       creator_id, updated_by, created_at, updated_at, archived_at, deleted_at
FROM document
WHERE id = $1;

-- name: GetDocumentForUpdate :one
SELECT id, workspace_id, team_id, project_id, title, body, sort_order,
       creator_id, updated_by, created_at, updated_at, archived_at, deleted_at
FROM document
WHERE id = $1
FOR UPDATE;

-- name: UpdateDocument :one
UPDATE document
SET title = sqlc.arg(title),
    body = sqlc.arg(body),
    updated_by = sqlc.arg(updated_by)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, team_id, project_id, title, body, sort_order,
          creator_id, updated_by, created_at, updated_at, archived_at, deleted_at;

-- name: ArchiveDocument :exec
UPDATE document SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveDocument :one
UPDATE document SET archived_at = NULL WHERE id = $1
RETURNING id, workspace_id, team_id, project_id, title, body, sort_order,
          creator_id, updated_by, created_at, updated_at, archived_at, deleted_at;

-- name: SoftDeleteDocument :one
UPDATE document
SET deleted_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, team_id, project_id, title, body, sort_order,
          creator_id, updated_by, created_at, updated_at, archived_at, deleted_at;

-- name: LastDocumentSortOrderForTeam :one
SELECT sort_order
FROM document
WHERE team_id = $1 AND project_id IS NULL AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: LastDocumentSortOrderForProject :one
SELECT sort_order
FROM document
WHERE project_id = $1 AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: StreamDocumentsForBootstrap :many
SELECT d.id, d.workspace_id, d.team_id, d.project_id, d.title, d.body, d.sort_order,
       d.creator_id, d.updated_by, d.created_at, d.updated_at, d.archived_at, d.deleted_at
FROM document d
WHERE d.workspace_id = sqlc.arg(workspace_id)
  AND d.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND d.deleted_at IS NULL
  AND d.archived_at IS NULL
  AND d.id > sqlc.arg(after_id)
ORDER BY d.id
LIMIT sqlc.arg(page_size);
