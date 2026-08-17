-- Only one row exists per link. "Blocked by" is a `blocks` row read from the other end,
-- and `related` is stored with the smaller id first, so the reverse listing below is not a
-- second table to keep in step — it is the same rows, read backwards.
--
-- team_id and related_team_id are filled by issue_relation_denormalise and so are absent
-- from every INSERT, but present in every RETURNING: the sync hub decides visibility from
-- them without re-reading issues that may already be gone.

-- name: CreateIssueRelation :one
INSERT INTO issue_relation (id, workspace_id, issue_id, related_issue_id, type, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(issue_id),
        sqlc.arg(related_issue_id), sqlc.arg(type), sqlc.narg(created_by))
RETURNING id, workspace_id, issue_id, related_issue_id, type, team_id, related_team_id,
          created_by, created_at;

-- name: GetIssueRelation :one
SELECT id, workspace_id, issue_id, related_issue_id, type, team_id, related_team_id,
       created_by, created_at
FROM issue_relation
WHERE id = $1;

-- name: DeleteIssueRelation :one
DELETE FROM issue_relation
WHERE id = $1
RETURNING id, workspace_id, issue_id, related_issue_id, type, team_id, related_team_id,
          created_by, created_at;

-- ListIssueRelations is the forward direction: what this issue blocks, duplicates, or is
-- related to.
--
-- name: ListIssueRelations :many
SELECT id, workspace_id, issue_id, related_issue_id, type, team_id, related_team_id,
       created_by, created_at
FROM issue_relation
WHERE issue_id = $1
ORDER BY created_at;

-- ListReverseIssueRelations is the same links read from the far end: what blocks this
-- issue, and what it is a duplicate of. Both listings are needed on the issue panel, which
-- is why issue_relation carries an index on each side.
--
-- name: ListReverseIssueRelations :many
SELECT id, workspace_id, issue_id, related_issue_id, type, team_id, related_team_id,
       created_by, created_at
FROM issue_relation
WHERE related_issue_id = $1
ORDER BY created_at;

-- StreamIssueRelationsForBootstrap ships a relation when the caller can see either end,
-- which is the same rule the hub applies to a live change. Both issues are joined so a
-- relation pointing at an archived or deleted issue is left out: the client would render
-- it as a chip it cannot resolve.
--
-- name: StreamIssueRelationsForBootstrap :many
SELECT r.id, r.workspace_id, r.issue_id, r.related_issue_id, r.type, r.team_id,
       r.related_team_id, r.created_by, r.created_at
FROM issue_relation r
JOIN issue a ON a.id = r.issue_id
JOIN issue b ON b.id = r.related_issue_id
WHERE r.workspace_id = sqlc.arg(workspace_id)
  AND (r.team_id = ANY(sqlc.arg(team_ids)::uuid[])
       OR r.related_team_id = ANY(sqlc.arg(team_ids)::uuid[]))
  AND a.archived_at IS NULL AND a.deleted_at IS NULL
  AND b.archived_at IS NULL AND b.deleted_at IS NULL
  AND r.id > sqlc.arg(after_id)
ORDER BY r.id
LIMIT sqlc.arg(page_size);

-- CountBlockingIssues is the "this cannot start yet" badge: how many open issues block
-- this one. A completed or cancelled blocker no longer blocks anything, so the count is
-- taken over issues that are still in flight rather than over relations.
--
-- name: CountBlockingIssues :one
SELECT count(*) FROM issue_relation r
JOIN issue i ON i.id = r.issue_id
WHERE r.related_issue_id = $1
  AND r.type = 'blocks'
  AND i.completed_at IS NULL AND i.canceled_at IS NULL
  AND i.archived_at IS NULL AND i.deleted_at IS NULL;
