-- Project labels and their applications to projects.

-- name: CreateProjectLabel :one
INSERT INTO project_label (id, workspace_id, parent_id, is_group, name, description, color, position)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(parent_id), sqlc.arg(is_group),
        sqlc.arg(name), sqlc.narg(description),
        COALESCE(sqlc.narg(color)::text, '#6b7280'),
        sqlc.arg(position))
RETURNING id, workspace_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: GetProjectLabel :one
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM project_label
WHERE id = $1;

-- name: ListProjectLabelsInWorkspace :many
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM project_label
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: StreamProjectLabelsForBootstrap :many
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM project_label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND sqlc.arg(include_workspace_scoped)::boolean
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: ListProjectLabelsInGroup :many
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM project_label
WHERE parent_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: UpdateProjectLabel :one
UPDATE project_label
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    color       = COALESCE(sqlc.narg(color), color),
    position    = COALESCE(sqlc.narg(position), position),
    is_group    = COALESCE(sqlc.narg(is_group), is_group),
    parent_id   = CASE WHEN sqlc.arg(clear_parent)::boolean THEN NULL
                       ELSE COALESCE(sqlc.narg(parent_id), parent_id) END
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: ArchiveProjectLabel :one
UPDATE project_label SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: UnarchiveProjectLabel :one
UPDATE project_label SET archived_at = NULL
WHERE id = $1 AND archived_at IS NOT NULL
RETURNING id, workspace_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: GetArchivedProjectLabel :one
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM project_label
WHERE id = $1 AND archived_at IS NOT NULL;

-- name: GetLastProjectLabelPosition :one
SELECT position FROM project_label
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- name: GetProjectLabelPositionAfter :one
SELECT position FROM project_label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND position > sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position
LIMIT 1;

-- name: CountProjectsWithProjectLabel :one
SELECT count(*) FROM project_label_link WHERE label_id = $1;

-- name: AddProjectLabelLink :one
INSERT INTO project_label_link (id, workspace_id, project_id, label_id, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_id), sqlc.arg(label_id),
        sqlc.narg(created_by))
ON CONFLICT (project_id, label_id) DO UPDATE SET label_id = EXCLUDED.label_id
RETURNING id, workspace_id, project_id, label_id, group_id, created_by, created_at;

-- name: RemoveProjectLabelLink :one
DELETE FROM project_label_link
WHERE project_id = sqlc.arg(project_id) AND label_id = sqlc.arg(label_id)
RETURNING id, workspace_id, project_id, label_id, group_id, created_by, created_at;

-- name: ListProjectLabelLinks :many
SELECT id, workspace_id, project_id, label_id, group_id, created_by, created_at
FROM project_label_link
WHERE project_id = $1
ORDER BY created_at;

-- name: StreamProjectLabelLinksForBootstrap :many
SELECT l.id, l.workspace_id, l.project_id, l.label_id, l.group_id, l.created_by, l.created_at
FROM project_label_link l
WHERE l.workspace_id = sqlc.arg(workspace_id)
  AND EXISTS (
        SELECT 1 FROM project_team visible
        WHERE visible.project_id = l.project_id
          AND visible.team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND l.id > sqlc.arg(after_id)
ORDER BY l.id
LIMIT sqlc.arg(page_size);
