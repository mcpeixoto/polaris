-- Recurring issue schedules. Column lists follow the table order, same rule as issues.sql.

-- name: CreateRecurringIssue :one
INSERT INTO recurring_issue (id, workspace_id, team_id, title, body, properties,
                             template_id, cadence, next_due_date, last_created_at, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(team_id), sqlc.arg(title),
        COALESCE(sqlc.narg(body)::text, ''), sqlc.arg(properties),
        sqlc.narg(template_id), sqlc.arg(cadence), sqlc.arg(next_due_date),
        sqlc.narg(last_created_at), sqlc.narg(created_by))
RETURNING id, workspace_id, team_id, title, body, properties, template_id, cadence,
          next_due_date, last_created_at, created_by, archived_at, created_at, updated_at;

-- name: GetRecurringIssue :one
SELECT id, workspace_id, team_id, title, body, properties, template_id, cadence,
       next_due_date, last_created_at, created_by, archived_at, created_at, updated_at
FROM recurring_issue
WHERE id = $1;

-- GetRecurringIssueForUpdate locks the row for a mint pass. Two workers racing on the
-- same due date would otherwise both decide it had passed and file two issues.
--
-- name: GetRecurringIssueForUpdate :one
SELECT id, workspace_id, team_id, title, body, properties, template_id, cadence,
       next_due_date, last_created_at, created_by, archived_at, created_at, updated_at
FROM recurring_issue
WHERE id = $1
FOR UPDATE;

-- name: ListRecurringIssuesForTeam :many
SELECT id, workspace_id, team_id, title, body, properties, template_id, cadence,
       next_due_date, last_created_at, created_by, archived_at, created_at, updated_at
FROM recurring_issue
WHERE team_id = $1 AND archived_at IS NULL
ORDER BY next_due_date, title;

-- StreamRecurringIssuesForBootstrap feeds the initial snapshot. The predicate is the
-- team's: a recurring schedule is team-scoped the same way a cycle is, and the change
-- rows are emitted under TeamScope, so the snapshot must not ship a private team's
-- schedules to someone who is not in it.
--
-- Archived schedules are excluded — archiving emits a delete — even though
-- issue.recurring_issue_id may still point at one. That column answers "was this
-- minted from a schedule" from the server side; the replica filters on the live
-- schedule rows.
--
-- name: StreamRecurringIssuesForBootstrap :many
SELECT id, workspace_id, team_id, title, body, properties, template_id, cadence,
       next_due_date, last_created_at, created_by, archived_at, created_at, updated_at
FROM recurring_issue
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: ListActiveRecurringIssues :many
SELECT id, workspace_id, team_id, title, body, properties, template_id, cadence,
       next_due_date, last_created_at, created_by, archived_at, created_at, updated_at
FROM recurring_issue
WHERE archived_at IS NULL
ORDER BY team_id, next_due_date, id;

-- name: UpdateRecurringIssue :one
UPDATE recurring_issue
SET title         = COALESCE(sqlc.narg(title), title),
    body          = COALESCE(sqlc.narg(body), body),
    properties    = COALESCE(sqlc.narg(properties), properties),
    cadence       = COALESCE(sqlc.narg(cadence), cadence),
    next_due_date = COALESCE(sqlc.narg(next_due_date), next_due_date)
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, team_id, title, body, properties, template_id, cadence,
          next_due_date, last_created_at, created_by, archived_at, created_at, updated_at;

-- AdvanceRecurringIssue is the mint path: the due date of the occurrence just filed,
-- and when it was filed. Separate from UpdateRecurringIssue so a settings edit cannot
-- accidentally look like a mint (or the other way around).
--
-- name: AdvanceRecurringIssue :one
UPDATE recurring_issue
SET next_due_date   = sqlc.arg(next_due_date),
    last_created_at = sqlc.arg(last_created_at)
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, team_id, title, body, properties, template_id, cadence,
          next_due_date, last_created_at, created_by, archived_at, created_at, updated_at;

-- name: ArchiveRecurringIssue :one
UPDATE recurring_issue SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, team_id, title, body, properties, template_id, cadence,
          next_due_date, last_created_at, created_by, archived_at, created_at, updated_at;

-- name: UnarchiveRecurringIssue :one
UPDATE recurring_issue SET archived_at = NULL
WHERE id = $1 AND archived_at IS NOT NULL
RETURNING id, workspace_id, team_id, title, body, properties, template_id, cadence,
          next_due_date, last_created_at, created_by, archived_at, created_at, updated_at;
