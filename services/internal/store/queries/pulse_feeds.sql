-- Personal Pulse feeds. One person's named subset of project updates.

-- name: CreatePulseFeed :one
INSERT INTO pulse_feed (id, workspace_id, user_id, name, project_ids)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, workspace_id, user_id, name, project_ids, created_at, updated_at;

-- name: GetPulseFeed :one
SELECT id, workspace_id, user_id, name, project_ids, created_at, updated_at
FROM pulse_feed
WHERE id = $1;

-- name: GetPulseFeedForUpdate :one
SELECT id, workspace_id, user_id, name, project_ids, created_at, updated_at
FROM pulse_feed
WHERE id = $1
FOR UPDATE;

-- name: UpdatePulseFeed :one
UPDATE pulse_feed
SET name        = sqlc.arg(name),
    project_ids = sqlc.arg(project_ids)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, user_id, name, project_ids, created_at, updated_at;

-- name: DeletePulseFeed :exec
DELETE FROM pulse_feed WHERE id = $1;

-- name: CountPulseFeedsForUser :one
SELECT count(*)::int
FROM pulse_feed
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id);

-- StreamPulseFeedsForBootstrap is one person's feeds. A Pulse feed is personal the way
-- an inbox row is: it travels under a user scope and never appears in anybody else's
-- replica.
--
-- name: StreamPulseFeedsForBootstrap :many
SELECT id, workspace_id, user_id, name, project_ids, created_at, updated_at
FROM pulse_feed
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
