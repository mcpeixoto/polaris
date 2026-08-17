-- name: AppendIssueHistory :exec
INSERT INTO issue_history (id, workspace_id, issue_id, actor_type, actor_id, kind,
                           from_value, to_value, grouped_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListIssueHistory :many
SELECT id, workspace_id, issue_id, actor_type, actor_id, kind,
       from_value, to_value, grouped_at, created_at
FROM issue_history
WHERE issue_id = $1
ORDER BY created_at;

-- FindGroupableHistoryEntry implements the folding rule: a run of same-kind changes by
-- the same actor within a short window shows as one entry in the feed rather than five.
-- Returning the existing row lets the writer update it instead of appending.
--
-- name: FindGroupableHistoryEntry :one
SELECT id, workspace_id, issue_id, actor_type, actor_id, kind,
       from_value, to_value, grouped_at, created_at
FROM issue_history
WHERE issue_id = sqlc.arg(issue_id)
  AND kind = sqlc.arg(kind)
  AND actor_type = sqlc.arg(actor_type)
  AND actor_id IS NOT DISTINCT FROM sqlc.narg(actor_id)
  AND created_at > sqlc.arg(since)
ORDER BY created_at DESC
LIMIT 1;

-- name: UpdateIssueHistoryTarget :exec
UPDATE issue_history SET to_value = sqlc.arg(to_value), grouped_at = now()
WHERE id = sqlc.arg(id);
