-- Replicated columns only. token is never selected here except on the owner-read
-- and public-feed paths, which are not bootstrap.

-- name: CreateCycleCalendarFeed :one
INSERT INTO cycle_calendar_feed (
  id, workspace_id, team_id, user_id, token
) VALUES (
  $1, $2, $3, $4, $5
)
RETURNING id, workspace_id, team_id, user_id, created_at, updated_at;

-- name: GetCycleCalendarFeedForOwner :one
SELECT id, workspace_id, team_id, user_id, token, created_at, updated_at
FROM cycle_calendar_feed
WHERE team_id = sqlc.arg(team_id) AND user_id = sqlc.arg(user_id);

-- name: GetCycleCalendarFeedByToken :one
SELECT id, workspace_id, team_id, user_id, created_at, updated_at
FROM cycle_calendar_feed
WHERE token = $1;

-- name: StreamCycleCalendarFeedsForBootstrap :many
SELECT id, workspace_id, team_id, user_id, created_at, updated_at
FROM cycle_calendar_feed
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
