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

-- ListMyIssueActivity is My Issues → Activity: recent curated history on issues the caller
-- is assigned, created, or subscribed to. Newest first.
--
-- Network-fetched on purpose. issue_history is the permanent, curated feed — not the change
-- log that drives sync — so it is not in the replica. A personal cross-issue cut of the
-- same table is the same kind of read as issueHistory(issueId), with the relevance filter
-- the Assigned / Created / Subscribed tabs already imply.
--
-- Team membership comes from the principal's team_ids (same bargain as ListMyIssues). The
-- plan's history window is applied in Go after this returns, matching ListIssueHistory.
--
-- name: ListMyIssueActivity :many
SELECT h.id, h.workspace_id, h.issue_id, h.actor_type, h.actor_id, h.kind,
       h.from_value, h.to_value, h.grouped_at, h.created_at,
       i.title AS issue_title, i.number AS issue_number, t.key AS team_key
FROM issue_history h
JOIN issue i ON i.id = h.issue_id
JOIN team  t ON t.id = i.team_id
WHERE h.workspace_id = sqlc.arg(workspace_id)
  AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND i.archived_at IS NULL
  AND i.deleted_at IS NULL
  AND (
    i.assignee_id = sqlc.arg(user_id)
    OR i.creator_id = sqlc.arg(user_id)
    OR EXISTS (
      SELECT 1 FROM issue_subscription s
      WHERE s.issue_id = i.id
        AND s.user_id = sqlc.arg(user_id)
        AND s.unsubscribed = false
    )
  )
ORDER BY h.created_at DESC, h.id DESC
LIMIT sqlc.arg(page_size);
