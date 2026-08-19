-- Cycles. Column lists follow the table order, same rule as issues.sql.

-- name: CreateCycle :one
INSERT INTO cycle (id, workspace_id, team_id, number, name, description, starts_at, ends_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(team_id), sqlc.arg(number),
        sqlc.arg(name), sqlc.narg(description), sqlc.arg(starts_at), sqlc.arg(ends_at))
RETURNING id, workspace_id, team_id, number, name, description, starts_at, ends_at,
          completed_at, archived_at, created_at, updated_at;

-- name: GetCycle :one
SELECT id, workspace_id, team_id, number, name, description, starts_at, ends_at,
       completed_at, archived_at, created_at, updated_at
FROM cycle
WHERE id = $1;

-- name: ListCyclesForTeam :many
SELECT id, workspace_id, team_id, number, name, description, starts_at, ends_at,
       completed_at, archived_at, created_at, updated_at
FROM cycle
WHERE team_id = $1 AND archived_at IS NULL
ORDER BY starts_at;

-- name: LastCycleNumber :one
SELECT number FROM cycle
WHERE team_id = $1
ORDER BY number DESC
LIMIT 1;

-- name: StreamCyclesForBootstrap :many
SELECT id, workspace_id, team_id, number, name, description, starts_at, ends_at,
       completed_at, archived_at, created_at, updated_at
FROM cycle
WHERE workspace_id = sqlc.arg(workspace_id)
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND archived_at IS NULL
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: CompleteCycle :one
UPDATE cycle SET completed_at = sqlc.arg(completed_at)
WHERE id = sqlc.arg(id) AND completed_at IS NULL
RETURNING id, workspace_id, team_id, number, name, description, starts_at, ends_at,
          completed_at, archived_at, created_at, updated_at;

-- Upcoming cycles that have not started: dropped when the team turns cycles off.
-- name: DeleteUpcomingCycles :many
DELETE FROM cycle
WHERE team_id = sqlc.arg(team_id)
  AND starts_at > sqlc.arg(now)
  AND completed_at IS NULL
RETURNING id;

-- Open work in a closing cycle: unstarted and started, not backlog/triage/canceled/completed.
-- name: ListOpenIssuesInCycle :many
SELECT i.id, i.workspace_id, i.team_id, i.number, i.title, i.description, i.state_id,
       i.assignee_id, i.creator_id, i.priority, i.sort_order,
       i.started_at, i.completed_at, i.canceled_at,
       i.archived_at, i.deleted_at, i.created_at, i.updated_at,
       i.estimate, i.due_date, i.due_date_source, i.parent_id, i.sub_issue_sort_order,
       i.template_id, i.deleted_by, i.project_id, i.project_milestone_id, i.cycle_id, i.snoozed_until, i.auto_closed_at
FROM issue i
JOIN workflow_state s ON s.id = i.state_id
WHERE i.cycle_id = sqlc.arg(cycle_id)
  AND i.archived_at IS NULL AND i.deleted_at IS NULL
  AND s.category IN ('unstarted', 'started');

-- Cycle-less issues in a given category, for auto-add.
-- name: ListCyclelessIssuesByCategory :many
SELECT i.id, i.workspace_id, i.team_id, i.number, i.title, i.description, i.state_id,
       i.assignee_id, i.creator_id, i.priority, i.sort_order,
       i.started_at, i.completed_at, i.canceled_at,
       i.archived_at, i.deleted_at, i.created_at, i.updated_at,
       i.estimate, i.due_date, i.due_date_source, i.parent_id, i.sub_issue_sort_order,
       i.template_id, i.deleted_by, i.project_id, i.project_milestone_id, i.cycle_id, i.snoozed_until, i.auto_closed_at
FROM issue i
JOIN workflow_state s ON s.id = i.state_id
WHERE i.team_id = sqlc.arg(team_id)
  AND i.cycle_id IS NULL
  AND i.archived_at IS NULL AND i.deleted_at IS NULL
  AND s.category = sqlc.arg(category);

-- name: SetIssueCycle :exec
UPDATE issue SET cycle_id = sqlc.narg(cycle_id)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: ArchiveCycle :exec
UPDATE cycle SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveCycle :one
UPDATE cycle SET archived_at = NULL WHERE id = $1
RETURNING id, workspace_id, team_id, number, name, description, starts_at, ends_at,
          completed_at, archived_at, created_at, updated_at;

-- name: ListArchivedCyclesForTeam :many
SELECT id, workspace_id, team_id, number, name, description, starts_at, ends_at,
       completed_at, archived_at, created_at, updated_at
FROM cycle
WHERE team_id = $1 AND archived_at IS NOT NULL
ORDER BY archived_at DESC;

-- Completed cycles past the team's archive period. A cycle that was never completed
-- is still the current or upcoming window and must not disappear under people's feet.
--
-- name: ListStaleCompletedCycles :many
SELECT id, workspace_id, team_id, number, name, description, starts_at, ends_at,
       completed_at, archived_at, created_at, updated_at
FROM cycle
WHERE team_id = sqlc.arg(team_id)
  AND archived_at IS NULL
  AND completed_at IS NOT NULL
  AND completed_at < sqlc.arg(cutoff)
ORDER BY completed_at, id;
