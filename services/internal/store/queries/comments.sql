-- name: CreateComment :one
INSERT INTO comment (
  id, workspace_id, issue_id, parent_id, body, actor_type, actor_id,
  anchor_start, anchor_end, quote
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, workspace_id, issue_id, parent_id, body, actor_type, actor_id,
          edited_at, resolved_at, resolved_by, archived_at, deleted_at, created_at, updated_at,
          anchor_start, anchor_end, quote;

-- name: GetComment :one
SELECT id, workspace_id, issue_id, parent_id, body, actor_type, actor_id,
       edited_at, resolved_at, resolved_by, archived_at, deleted_at, created_at, updated_at,
       anchor_start, anchor_end, quote
FROM comment
WHERE id = $1 AND deleted_at IS NULL;

-- name: ListCommentsForIssue :many
SELECT id, workspace_id, issue_id, parent_id, body, actor_type, actor_id,
       edited_at, resolved_at, resolved_by, archived_at, deleted_at, created_at, updated_at,
       anchor_start, anchor_end, quote
FROM comment
WHERE issue_id = $1 AND deleted_at IS NULL
ORDER BY created_at;

-- name: UpdateCommentBody :one
UPDATE comment SET body = sqlc.arg(body), edited_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, issue_id, parent_id, body, actor_type, actor_id,
          edited_at, resolved_at, resolved_by, archived_at, deleted_at, created_at, updated_at,
          anchor_start, anchor_end, quote;

-- name: SetCommentResolution :one
UPDATE comment
SET resolved_at = sqlc.narg(resolved_at), resolved_by = sqlc.narg(resolved_by)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, issue_id, parent_id, body, actor_type, actor_id,
          edited_at, resolved_at, resolved_by, archived_at, deleted_at, created_at, updated_at,
          anchor_start, anchor_end, quote;

-- name: SoftDeleteComment :exec
UPDATE comment SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;

-- StreamCommentsForBootstrap ships EVERY live comment on every live issue the caller can
-- see, paged by id.
--
-- This comment used to say it shipped "the most recent comments only", with full history
-- loaded on demand when an issue is opened, and pointed at the tiering table in
-- docs/05-infrastructure/03-sync-engine.md. That was never implemented — there is no bound
-- here beyond the page size, which is a cursor and not a limit. On a seeded ten-thousand
-- issue workspace comments are the second-largest contributor to the snapshot, so the
-- difference is not academic.
--
-- Left unbounded rather than quietly capped, because capping it is a product decision with a
-- client-side counterpart: the replica would hold a partial thread, and every screen that
-- reads comments straight out of it would need to know when to go and ask for the rest. The
-- honest state is an accurate comment and a known cost.
--
-- name: StreamCommentsForBootstrap :many
SELECT c.id, c.workspace_id, c.issue_id, c.parent_id, c.body, c.actor_type, c.actor_id,
       c.edited_at, c.resolved_at, c.resolved_by, c.archived_at, c.deleted_at,
       c.created_at, c.updated_at, c.anchor_start, c.anchor_end, c.quote
FROM comment c
JOIN issue i ON i.id = c.issue_id
WHERE c.workspace_id = sqlc.arg(workspace_id)
  AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND i.archived_at IS NULL AND i.deleted_at IS NULL
  AND c.deleted_at IS NULL
  AND c.id > sqlc.arg(after_id)
ORDER BY c.id
LIMIT sqlc.arg(page_size);
