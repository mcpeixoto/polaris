-- Initiative labels and their applications to initiatives.

-- name: CreateInitiativeLabel :one
INSERT INTO initiative_label (id, workspace_id, parent_id, is_group, name, description, color, position)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(parent_id), sqlc.arg(is_group),
        sqlc.arg(name), sqlc.narg(description),
        COALESCE(sqlc.narg(color)::text, '#6b7280'),
        sqlc.arg(position))
RETURNING id, workspace_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: GetInitiativeLabel :one
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM initiative_label
WHERE id = $1;

-- name: ListInitiativeLabelsInWorkspace :many
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM initiative_label
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: StreamInitiativeLabelsForBootstrap :many
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM initiative_label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND sqlc.arg(include_workspace_scoped)::boolean
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: ListInitiativeLabelsInGroup :many
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM initiative_label
WHERE parent_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: UpdateInitiativeLabel :one
UPDATE initiative_label
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

-- name: ArchiveInitiativeLabel :one
UPDATE initiative_label SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: UnarchiveInitiativeLabel :one
UPDATE initiative_label SET archived_at = NULL
WHERE id = $1 AND archived_at IS NOT NULL
RETURNING id, workspace_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: GetArchivedInitiativeLabel :one
SELECT id, workspace_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM initiative_label
WHERE id = $1 AND archived_at IS NOT NULL;

-- name: GetLastInitiativeLabelPosition :one
SELECT position FROM initiative_label
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- name: GetInitiativeLabelPositionAfter :one
SELECT position FROM initiative_label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND position > sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position
LIMIT 1;

-- name: CountInitiativesWithInitiativeLabel :one
SELECT count(*) FROM initiative_label_link WHERE label_id = $1;

-- name: AddInitiativeLabelLink :one
INSERT INTO initiative_label_link (id, workspace_id, initiative_id, label_id, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(initiative_id), sqlc.arg(label_id),
        sqlc.narg(created_by))
ON CONFLICT (initiative_id, label_id) DO UPDATE SET label_id = EXCLUDED.label_id
RETURNING id, workspace_id, initiative_id, label_id, group_id, created_by, created_at;

-- name: RemoveInitiativeLabelLink :one
DELETE FROM initiative_label_link
WHERE initiative_id = sqlc.arg(initiative_id) AND label_id = sqlc.arg(label_id)
RETURNING id, workspace_id, initiative_id, label_id, group_id, created_by, created_at;

-- name: ListInitiativeLabelLinks :many
SELECT id, workspace_id, initiative_id, label_id, group_id, created_by, created_at
FROM initiative_label_link
WHERE initiative_id = $1
ORDER BY created_at;

-- StreamInitiativeLabelLinksForBootstrap: only applications on initiatives the principal can see.
--
-- name: StreamInitiativeLabelLinksForBootstrap :many
SELECT l.id, l.workspace_id, l.initiative_id, l.label_id, l.group_id, l.created_by, l.created_at
FROM initiative_label_link l
JOIN initiative i ON i.id = l.initiative_id
LEFT JOIN team lt ON lt.id = i.lead_team_id
WHERE l.workspace_id = sqlc.arg(workspace_id)
  AND i.deleted_at IS NULL
  AND i.archived_at IS NULL
  AND (
        i.lead_team_id IS NULL
        OR lt.private = false
        OR i.lead_team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND l.id > sqlc.arg(after_id)
ORDER BY l.id
LIMIT sqlc.arg(page_size);
