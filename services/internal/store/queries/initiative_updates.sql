-- name: CreateInitiativeUpdate :one
INSERT INTO initiative_update (id, workspace_id, initiative_id, health, body, author_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, initiative_id, health, body, author_id,
          edited_at, deleted_at, created_at, updated_at;

-- name: GetInitiativeUpdate :one
SELECT id, workspace_id, initiative_id, health, body, author_id,
       edited_at, deleted_at, created_at, updated_at
FROM initiative_update
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetInitiativeUpdateForUpdate :one
SELECT id, workspace_id, initiative_id, health, body, author_id,
       edited_at, deleted_at, created_at, updated_at
FROM initiative_update
WHERE id = $1 AND deleted_at IS NULL
FOR UPDATE;

-- name: UpdateInitiativeUpdate :one
UPDATE initiative_update
SET health = COALESCE(sqlc.narg(health), health),
    body = COALESCE(sqlc.narg(body), body),
    edited_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, initiative_id, health, body, author_id,
          edited_at, deleted_at, created_at, updated_at;

-- name: SoftDeleteInitiativeUpdate :one
UPDATE initiative_update SET deleted_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, workspace_id, initiative_id, health, body, author_id,
          edited_at, deleted_at, created_at, updated_at;

-- name: ListInitiativeUpdatesForInitiative :many
SELECT id, workspace_id, initiative_id, health, body, author_id,
       edited_at, deleted_at, created_at, updated_at
FROM initiative_update
WHERE initiative_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC;

-- StreamInitiativeUpdatesForBootstrap: visible when the initiative is visible.
--
-- name: StreamInitiativeUpdatesForBootstrap :many
SELECT iu.id, iu.workspace_id, iu.initiative_id, iu.health, iu.body, iu.author_id,
       iu.edited_at, iu.deleted_at, iu.created_at, iu.updated_at
FROM initiative_update iu
JOIN initiative i ON i.id = iu.initiative_id
LEFT JOIN team lt ON lt.id = i.lead_team_id
WHERE iu.workspace_id = sqlc.arg(workspace_id)
  AND i.deleted_at IS NULL
  AND i.archived_at IS NULL
  AND iu.deleted_at IS NULL
  AND (
        i.lead_team_id IS NULL
        OR lt.private = false
        OR i.lead_team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND iu.id > sqlc.arg(after_id)
ORDER BY iu.id
LIMIT sqlc.arg(page_size);
