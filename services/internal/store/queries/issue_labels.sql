-- team_id and group_id are never supplied by a caller: issue_label_denormalise fills them
-- from the issue and the label, and rejects a label the issue's team cannot use. They are
-- still in every RETURNING list because the sync hub judges visibility from them and the
-- client stores them.

-- AddIssueLabel is idempotent on purpose.
--
-- ON CONFLICT DO NOTHING would return no row, leaving the caller unable to tell "already
-- applied" from "the write failed". The no-op update returns the existing row instead, and
-- keeps its original id — which matters because that id is the entity's name on the sync
-- stream, and minting a second one for the same application would be a second entity.
--
-- A conflict on issue_label_one_per_group is NOT swallowed: the issue already carries a
-- different label from this group, and only the caller can decide which survives.
--
-- name: AddIssueLabel :one
INSERT INTO issue_label (id, workspace_id, issue_id, label_id, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(issue_id), sqlc.arg(label_id),
        sqlc.narg(created_by))
ON CONFLICT (issue_id, label_id) DO UPDATE SET created_by = issue_label.created_by
RETURNING id, workspace_id, issue_id, label_id, team_id, group_id, created_by, created_at;

-- Returns the row it removed rather than a count, because the change stream needs the id
-- of the entity that disappeared and the caller only knows the issue and the label.
--
-- name: RemoveIssueLabel :one
DELETE FROM issue_label
WHERE issue_id = sqlc.arg(issue_id) AND label_id = sqlc.arg(label_id)
RETURNING id, workspace_id, issue_id, label_id, team_id, group_id, created_by, created_at;

-- name: ListIssueLabels :many
SELECT id, workspace_id, issue_id, label_id, team_id, group_id, created_by, created_at
FROM issue_label
WHERE issue_id = $1
ORDER BY created_at;

-- StreamIssueLabelsForBootstrap joins the issue rather than trusting the denormalised
-- team_id alone: bootstrap must not ship applications belonging to issues the snapshot
-- itself excludes, or the client renders label chips on rows it does not hold.
--
-- name: StreamIssueLabelsForBootstrap :many
SELECT il.id, il.workspace_id, il.issue_id, il.label_id, il.team_id, il.group_id,
       il.created_by, il.created_at
FROM issue_label il
JOIN issue i ON i.id = il.issue_id
WHERE il.workspace_id = sqlc.arg(workspace_id)
  AND il.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND i.archived_at IS NULL AND i.deleted_at IS NULL
  AND il.id > sqlc.arg(after_id)
ORDER BY il.id
LIMIT sqlc.arg(page_size);

-- BulkAddIssueLabels applies the whole (issue, label) cross product of a bulk edit in one
-- statement. The caller supplies the pairs already expanded, each with its own minted id,
-- because ids come from Go everywhere else in the system and a database-side uuid would
-- make the bulk path the one place they do not.
--
-- DO NOTHING here rather than the no-op update AddIssueLabel uses: the bulk path means
-- "make sure these labels are on these issues", and the rows it returns are exactly the
-- ones it created — which is exactly what belongs on the change stream. Labels already
-- present produce no row and no version.
--
-- The three arrays are zipped by ordinality rather than passed to one multi-argument
-- unnest, which Postgres accepts but sqlc cannot resolve to a catalogue signature.
--
-- name: BulkAddIssueLabels :many
INSERT INTO issue_label (id, workspace_id, issue_id, label_id, created_by)
SELECT a.id, sqlc.arg(workspace_id), b.issue_id, c.label_id, sqlc.narg(created_by)
FROM unnest(sqlc.arg(ids)::uuid[])       WITH ORDINALITY AS a(id, n)
JOIN unnest(sqlc.arg(issue_ids)::uuid[]) WITH ORDINALITY AS b(issue_id, n) USING (n)
JOIN unnest(sqlc.arg(label_ids)::uuid[]) WITH ORDINALITY AS c(label_id, n) USING (n)
ON CONFLICT (issue_id, label_id) DO NOTHING
RETURNING id, workspace_id, issue_id, label_id, team_id, group_id, created_by, created_at;

-- name: BulkRemoveIssueLabels :many
DELETE FROM issue_label
WHERE issue_id = ANY(sqlc.arg(issue_ids)::uuid[])
  AND label_id = ANY(sqlc.arg(label_ids)::uuid[])
RETURNING id, workspace_id, issue_id, label_id, team_id, group_id, created_by, created_at;
