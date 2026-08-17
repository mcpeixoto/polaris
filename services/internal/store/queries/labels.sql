-- name: CreateLabel :one
INSERT INTO label (id, workspace_id, team_id, parent_id, is_group, name, description, color, position)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(team_id), sqlc.narg(parent_id),
        sqlc.arg(is_group), sqlc.arg(name), sqlc.narg(description),
        -- NOT NULL with a product default. A caller that has no opinion about colour must
        -- not be able to write an empty string that renders as a transparent chip.
        COALESCE(sqlc.narg(color)::text, '#6b7280'),
        sqlc.arg(position))
RETURNING id, workspace_id, team_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: GetLabel :one
SELECT id, workspace_id, team_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM label
WHERE id = $1;

-- name: ListLabelsInWorkspace :many
SELECT id, workspace_id, team_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM label
WHERE workspace_id = $1 AND archived_at IS NULL
-- scope_key sorts workspace labels (the all-zero sentinel) ahead of every team's, so a
-- single pass over this result renders the picker's sections in order.
ORDER BY scope_key, position;

-- ListLabelsForTeam is what the label picker on an issue may offer: the workspace's own
-- labels plus that one team's. A label from another team is not merely hidden here — the
-- issue_label trigger rejects it — so this list and the write rule agree by construction.
--
-- name: ListLabelsForTeam :many
SELECT id, workspace_id, team_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND (team_id IS NULL OR team_id = sqlc.arg(team_id))
  AND archived_at IS NULL
ORDER BY scope_key, position;

-- name: ListLabelsInGroup :many
SELECT id, workspace_id, team_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM label
WHERE parent_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: UpdateLabel :one
UPDATE label
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    color       = COALESCE(sqlc.narg(color), color),
    position    = COALESCE(sqlc.narg(position), position),
    is_group    = COALESCE(sqlc.narg(is_group), is_group),
    -- The group is three-state: absent (leave alone), moved into a group, or lifted out
    -- of one. Same shape as clear_assignee on issue, for the same reason — a plain
    -- COALESCE cannot say "clear".
    --
    -- Moving a label between groups rewrites issue_label.group_id by trigger, and that
    -- propagation can fail if an issue would end up holding two labels from one group.
    -- Letting it fail is deliberate: the alternative silently drops something a user
    -- applied by hand.
    parent_id   = CASE WHEN sqlc.arg(clear_parent)::boolean THEN NULL
                       ELSE COALESCE(sqlc.narg(parent_id), parent_id) END
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, team_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- name: ArchiveLabel :one
UPDATE label SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, team_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- UnarchiveLabel is the way back, and it returns the row because putting a label back is an
-- upsert on the sync stream — every client dropped it when the archive arrived as a delete,
-- so the payload is the only thing that can restore it.
--
-- label_scope_name_key is partial on archived_at IS NULL, so archiving a label frees its
-- name and somebody may since have taken it. This statement lets the unique violation
-- happen rather than checking first: the check would be a read the index re-does anyway,
-- and between the two somebody can still take the name.
--
-- name: UnarchiveLabel :one
UPDATE label SET archived_at = NULL
WHERE id = $1 AND archived_at IS NOT NULL
RETURNING id, workspace_id, team_id, parent_id, is_group, name, description, color,
          position, archived_at, created_at, updated_at;

-- GetArchivedLabel reads a label the ordinary path treats as gone.
--
-- Only the unarchive uses it. loadLabel refuses an archived row on purpose — it is absent
-- from every picker, every listing and every replica — and widening that would put the row
-- back in reach of the reads that are meant not to see it.
--
-- name: GetArchivedLabel :one
SELECT id, workspace_id, team_id, parent_id, is_group, name, description, color,
       position, archived_at, created_at, updated_at
FROM label
WHERE id = $1 AND archived_at IS NOT NULL;

-- Neighbour lookups for fractional-index insertion. Positions are only ever compared
-- within one scope, so the predicate matches scope_key's own definition: NULL team means
-- the workspace scope, and IS NOT DISTINCT FROM is what makes that comparable in one
-- expression instead of two query variants.
--
-- name: GetLabelPositionBefore :one
SELECT position FROM label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND team_id IS NOT DISTINCT FROM sqlc.narg(team_id)
  AND position < sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- name: GetLabelPositionAfter :one
SELECT position FROM label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND team_id IS NOT DISTINCT FROM sqlc.narg(team_id)
  AND position > sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position
LIMIT 1;

-- name: GetLastLabelPosition :one
SELECT position FROM label
WHERE workspace_id = sqlc.arg(workspace_id)
  AND team_id IS NOT DISTINCT FROM sqlc.narg(team_id)
  AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- CountIssuesWithLabel answers "is this label worth keeping" before an archive, and is the
-- number the confirmation dialog shows. Counted through the issue so an archived or
-- deleted issue does not inflate it.
--
-- name: CountIssuesWithLabel :one
SELECT count(*) FROM issue_label il
JOIN issue i ON i.id = il.issue_id
WHERE il.label_id = $1 AND i.archived_at IS NULL AND i.deleted_at IS NULL;
