-- AddReaction is idempotent by construction.
--
-- DO NOTHING on the unique key rather than a read-then-insert: a second tap on the same
-- face, and a retried mutation, are the same statement and the same outcome. The RETURNING
-- clause is therefore empty when nothing was written, which is exactly the signal the
-- caller needs — no row means no change, so no version and no change_log entry.
--
-- name: AddReaction :many
INSERT INTO reaction (id, workspace_id, comment_id, user_id, emoji)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (comment_id, user_id, emoji) DO NOTHING
RETURNING id, workspace_id, comment_id, user_id, emoji, created_at;

-- RemoveReaction deletes one person's own reaction and returns the row that disappeared.
--
-- The row is returned because its id is the entity's name on the change stream and the
-- caller knows only the comment, the emoji and themselves. Reading it first would be a
-- second round trip that a concurrent removal could invalidate anyway.
--
-- name: RemoveReaction :one
DELETE FROM reaction
WHERE comment_id = sqlc.arg(comment_id)
  AND user_id = sqlc.arg(user_id)
  AND emoji = sqlc.arg(emoji)
RETURNING id, workspace_id, comment_id, user_id, emoji, created_at;

-- GetReaction reads one row by id, for the delete path that names the reaction directly.
--
-- name: GetReaction :one
SELECT id, workspace_id, comment_id, user_id, emoji, created_at
FROM reaction
WHERE id = $1;

-- ListReactionsForComments is the batched read, for the reason ListCommentsForIssues is:
-- a thread is a page of comments and a per-comment query there is a query per row.
--
-- Visibility comes from the comment's issue, applied here so the batched caller has no
-- per-comment place to check it.
--
-- name: ListReactionsForComments :many
SELECT r.id, r.workspace_id, r.comment_id, r.user_id, r.emoji, r.created_at
FROM reaction r
JOIN comment c ON c.id = r.comment_id
JOIN issue   i ON i.id = c.issue_id
JOIN team    t ON t.id = i.team_id
WHERE r.comment_id = ANY(sqlc.arg(comment_ids)::uuid[])
  AND r.workspace_id = sqlc.arg(workspace_id)
  AND c.deleted_at IS NULL
  AND (NOT t.private OR t.id = ANY(sqlc.arg(team_ids)::uuid[]))
ORDER BY r.comment_id, r.created_at;

-- StreamReactionsForBootstrap pages the workspace's reactions into a snapshot, scoped the
-- way the comment stream is: through the issue's team, because a reaction is only ever as
-- visible as the comment it sits on.
--
-- name: StreamReactionsForBootstrap :many
SELECT r.id, r.workspace_id, r.comment_id, r.user_id, r.emoji, r.created_at
FROM reaction r
JOIN comment c ON c.id = r.comment_id
JOIN issue   i ON i.id = c.issue_id
WHERE r.workspace_id = sqlc.arg(workspace_id)
  AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND c.deleted_at IS NULL
  AND r.id > sqlc.arg(after_id)
ORDER BY r.id
LIMIT sqlc.arg(page_size);
