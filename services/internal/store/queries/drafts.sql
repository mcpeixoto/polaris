-- Drafts are not replicated. Every query is scoped to one user in one workspace: a listing
-- that omitted user_id would be a way to read somebody else's unsent work.

-- name: CreateDraft :one
INSERT INTO draft (id, workspace_id, user_id, kind, payload)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(kind), sqlc.arg(payload))
RETURNING id, workspace_id, user_id, kind, payload, created_at, updated_at;

-- name: UpdateDraftPayload :one
UPDATE draft
SET payload = sqlc.arg(payload)
WHERE id = sqlc.arg(id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
RETURNING id, workspace_id, user_id, kind, payload, created_at, updated_at;

-- name: GetDraft :one
SELECT id, workspace_id, user_id, kind, payload, created_at, updated_at
FROM draft
WHERE id = sqlc.arg(id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id);

-- name: ListDraftsForUser :many
SELECT id, workspace_id, user_id, kind, payload, created_at, updated_at
FROM draft
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND updated_at >= sqlc.arg(since)
ORDER BY updated_at DESC;

-- name: DeleteDraft :one
DELETE FROM draft
WHERE id = sqlc.arg(id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
RETURNING id;

-- name: PruneDrafts :execrows
DELETE FROM draft
WHERE updated_at < sqlc.arg(before);
