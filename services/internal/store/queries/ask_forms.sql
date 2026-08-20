-- name: CreateAskForm :one
INSERT INTO ask_form (
  id, workspace_id, team_id, name, description, token, creator_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, workspace_id, team_id, name, description, token, creator_id,
          archived_at, deleted_at, created_at, updated_at;

-- name: GetAskForm :one
SELECT id, workspace_id, team_id, name, description, token, creator_id,
       archived_at, deleted_at, created_at, updated_at
FROM ask_form
WHERE id = $1;

-- name: GetAskFormForUpdate :one
SELECT id, workspace_id, team_id, name, description, token, creator_id,
       archived_at, deleted_at, created_at, updated_at
FROM ask_form
WHERE id = $1
FOR UPDATE;

-- name: GetAskFormByToken :one
SELECT id, workspace_id, team_id, name, description, token, creator_id,
       archived_at, deleted_at, created_at, updated_at
FROM ask_form
WHERE token = $1 AND deleted_at IS NULL AND archived_at IS NULL;

-- name: UpdateAskForm :one
UPDATE ask_form
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, team_id, name, description, token, creator_id,
          archived_at, deleted_at, created_at, updated_at;

-- name: ArchiveAskForm :exec
UPDATE ask_form SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveAskForm :one
UPDATE ask_form SET archived_at = NULL WHERE id = $1
RETURNING id, workspace_id, team_id, name, description, token, creator_id,
          archived_at, deleted_at, created_at, updated_at;

-- name: SoftDeleteAskForm :one
UPDATE ask_form
SET deleted_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, workspace_id, team_id, name, description, token, creator_id,
          archived_at, deleted_at, created_at, updated_at;

-- StreamAskFormsForBootstrap: team-scoped intake forms. Guests and members only
-- receive forms for teams they belong to. Archived and deleted rows stay out:
-- a replica that held a retired form would keep offering a dead link.
--
-- name: StreamAskFormsForBootstrap :many
SELECT id, workspace_id, team_id, name, description, token, creator_id,
       archived_at, deleted_at, created_at, updated_at
FROM ask_form
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NULL
  AND archived_at IS NULL
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
