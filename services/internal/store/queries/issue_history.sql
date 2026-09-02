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

-- ListIssueHistoryForIssues is ListIssueHistory for a whole page of issues at once, for the
-- reason ListCommentsForIssues gives: the API hydrates a list in one pass, and a per-issue
-- read there is three queries per visible row.
--
-- name: ListIssueHistoryForIssues :many
SELECT h.id, h.workspace_id, h.issue_id, h.actor_type, h.actor_id, h.kind,
       h.from_value, h.to_value, h.grouped_at, h.created_at
FROM issue_history h
JOIN issue i ON i.id = h.issue_id
JOIN team  t ON t.id = i.team_id
WHERE h.issue_id = ANY(sqlc.arg(issue_ids)::uuid[])
  AND h.workspace_id = sqlc.arg(workspace_id)
  AND (NOT t.private OR t.id = ANY(sqlc.arg(team_ids)::uuid[]))
ORDER BY h.issue_id, h.created_at;
