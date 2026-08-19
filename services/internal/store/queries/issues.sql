-- Every list below is the issue table's columns, in the table's own order, minus
-- search_vector. Minus, because the generated vector is roughly the size of the text it
-- indexes and nothing above the store reads it — shipping it would put a copy of every
-- title and description on the wire a second time, once per bootstrap row. In the table's
-- order, because that is the rule that makes a missing column obvious: a new column lands
-- at the end, and so does its addition here.

-- name: CreateIssue :one
INSERT INTO issue (id, workspace_id, team_id, number, title, description,
                   state_id, assignee_id, creator_id, priority, sort_order,
                   started_at, completed_at, canceled_at,
                   estimate, due_date, due_date_source, parent_id, sub_issue_sort_order,
                   template_id, project_id, project_milestone_id, cycle_id)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(team_id), sqlc.arg(number),
        sqlc.arg(title), sqlc.arg(description), sqlc.arg(state_id),
        sqlc.narg(assignee_id), sqlc.narg(creator_id), sqlc.arg(priority),
        sqlc.arg(sort_order),
        sqlc.narg(started_at), sqlc.narg(completed_at), sqlc.narg(canceled_at),
        sqlc.narg(estimate), sqlc.narg(due_date),
        -- NOT NULL with a CHECK, so an absent caller has to mean something. 'manual' is
        -- the only honest default: a date an SLA owns is a fact only the SLA subsystem
        -- knows, and guessing it here would make that date look human-editable.
        COALESCE(sqlc.narg(due_date_source)::text, 'manual'),
        sqlc.narg(parent_id), sqlc.narg(sub_issue_sort_order), sqlc.narg(template_id),
        sqlc.narg(project_id), sqlc.narg(project_milestone_id), sqlc.narg(cycle_id))
RETURNING id, workspace_id, team_id, number, title, description, state_id,
          assignee_id, creator_id, priority, sort_order,
          started_at, completed_at, canceled_at,
          archived_at, deleted_at, created_at, updated_at,
          estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id;

-- name: GetIssue :one
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE id = $1 AND deleted_at IS NULL;

-- GetIssueForUpdate locks the row for the rest of the transaction. Used by every update
-- path so that read-modify-write on timestamps (started_at, completed_at) cannot
-- interleave with a concurrent status change and lose one of them.
--
-- name: GetIssueForUpdate :one
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE id = $1 AND deleted_at IS NULL
FOR UPDATE;

-- name: GetIssueByTeamAndNumber :one
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE team_id = sqlc.arg(team_id) AND number = sqlc.arg(number) AND deleted_at IS NULL;

-- name: UpdateIssue :one
UPDATE issue
SET title            = COALESCE(sqlc.narg(title), title),
    description      = COALESCE(sqlc.narg(description), description),
    state_id         = COALESCE(sqlc.narg(state_id), state_id),
    priority         = COALESCE(sqlc.narg(priority), priority),
    sort_order       = COALESCE(sqlc.narg(sort_order), sort_order),
    team_id          = COALESCE(sqlc.narg(team_id), team_id),
    number           = COALESCE(sqlc.narg(number), number),
    due_date_source  = COALESCE(sqlc.narg(due_date_source), due_date_source),
    sub_issue_sort_order = COALESCE(sqlc.narg(sub_issue_sort_order), sub_issue_sort_order),
    -- Assignee is three-state: absent (leave alone), set, or explicitly cleared. A plain
    -- COALESCE cannot express "clear", so the caller passes clear_assignee separately.
    assignee_id  = CASE WHEN sqlc.arg(clear_assignee)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(assignee_id), assignee_id) END,
    -- The same three states, for the same reason. Unestimated is not zero, no due date is
    -- not the epoch, and no parent is not a sub-issue of nothing — each needs a way to say
    -- "remove it" that a nil pointer cannot express.
    estimate     = CASE WHEN sqlc.arg(clear_estimate)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(estimate), estimate) END,
    due_date     = CASE WHEN sqlc.arg(clear_due_date)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(due_date), due_date) END,
    -- Clearing the parent leaves sub_issue_sort_order behind rather than nulling it: if
    -- the issue is re-parented to the same issue by an undo, it lands back where it was.
    parent_id    = CASE WHEN sqlc.arg(clear_parent)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(parent_id), parent_id) END,
    -- Project is three-state for the same reason as parent. Clearing it also drops the
    -- milestone: a milestone without a project is refused by the trigger, and leaving it
    -- set would make the next write fail for a reason the caller cannot see.
    project_id = CASE WHEN sqlc.arg(clear_project)::boolean THEN NULL
                      ELSE COALESCE(sqlc.narg(project_id), project_id) END,
    project_milestone_id = CASE
        WHEN sqlc.arg(clear_project)::boolean OR sqlc.arg(clear_milestone)::boolean THEN NULL
        ELSE COALESCE(sqlc.narg(project_milestone_id), project_milestone_id) END,
    cycle_id = CASE WHEN sqlc.arg(clear_cycle)::boolean THEN NULL
                    ELSE COALESCE(sqlc.narg(cycle_id), cycle_id) END,
    -- Category timestamps are set by the domain layer, which knows the transition rules
    -- (started_at is never cleared once set, because insights read it).
    started_at   = CASE WHEN sqlc.arg(set_timestamps)::boolean THEN sqlc.narg(started_at)   ELSE started_at   END,
    completed_at = CASE WHEN sqlc.arg(set_timestamps)::boolean THEN sqlc.narg(completed_at) ELSE completed_at END,
    canceled_at  = CASE WHEN sqlc.arg(set_timestamps)::boolean THEN sqlc.narg(canceled_at)  ELSE canceled_at  END
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, team_id, number, title, description, state_id,
          assignee_id, creator_id, priority, sort_order,
          started_at, completed_at, canceled_at,
          archived_at, deleted_at, created_at, updated_at,
          estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id;

-- BulkUpdateIssues is the bulk-edit path: one property set across a selection, in one
-- statement, under one version block.
--
-- It never reorders, which is what lets it be a single statement — sort_order is minted
-- per issue from its neighbours, and there is no such thing as one new key for two hundred
-- rows.
--
-- started_at is COALESCEd against itself rather than overwritten. The single-issue path
-- keeps an existing start by reading the row under a lock first; doing that here would
-- mean two hundred locks and two hundred round trips, so the rule that started_at is never
-- cleared once set is expressed in the statement instead. Cycle time is computed from it.
--
-- name: BulkUpdateIssues :many
UPDATE issue
SET state_id     = COALESCE(sqlc.narg(state_id), state_id),
    priority     = COALESCE(sqlc.narg(priority), priority),
    assignee_id  = CASE WHEN sqlc.arg(clear_assignee)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(assignee_id), assignee_id) END,
    estimate     = CASE WHEN sqlc.arg(clear_estimate)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(estimate), estimate) END,
    due_date     = CASE WHEN sqlc.arg(clear_due_date)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(due_date), due_date) END,
    project_id   = CASE WHEN sqlc.arg(clear_project)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(project_id), project_id) END,
    project_milestone_id = CASE
        WHEN sqlc.arg(clear_project)::boolean OR sqlc.arg(clear_milestone)::boolean THEN NULL
        ELSE COALESCE(sqlc.narg(project_milestone_id), project_milestone_id) END,
    cycle_id     = CASE WHEN sqlc.arg(clear_cycle)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(cycle_id), cycle_id) END,
    started_at   = CASE WHEN sqlc.arg(set_timestamps)::boolean
                        THEN COALESCE(started_at, sqlc.narg(started_at)) ELSE started_at END,
    completed_at = CASE WHEN sqlc.arg(set_timestamps)::boolean THEN sqlc.narg(completed_at) ELSE completed_at END,
    canceled_at  = CASE WHEN sqlc.arg(set_timestamps)::boolean THEN sqlc.narg(canceled_at)  ELSE canceled_at  END
WHERE id = ANY(sqlc.arg(ids)::uuid[])
  AND workspace_id = sqlc.arg(workspace_id)
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND deleted_at IS NULL
RETURNING id, workspace_id, team_id, number, title, description, state_id,
          assignee_id, creator_id, priority, sort_order,
          started_at, completed_at, canceled_at,
          archived_at, deleted_at, created_at, updated_at,
          estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id;

-- name: ArchiveIssue :exec
UPDATE issue SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveIssue :exec
UPDATE issue SET archived_at = NULL WHERE id = $1;

-- SoftDeleteIssue records who as well as when.
--
-- deleted_by is nullable and a caller may pass nothing, which is what the retention sweep
-- and any future automation want: a deletion nobody instructed has no person to name, and a
-- guessed one would be worse than a blank on the trash screen.
--
-- name: SoftDeleteIssue :exec
UPDATE issue SET deleted_at = now(), deleted_by = sqlc.narg(deleted_by)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- RestoreIssue returns the row because a restore puts the issue back on the sync stream,
-- and the payload has to be the issue as it is now — not as the client last saw it before
-- the delete.
--
-- The window is a parameter rather than a literal: how long a delete stays undoable is a
-- product decision, and burying "30 days" in a query means changing it is a migration.
--
-- deleted_by is cleared alongside deleted_at. Leaving it set would make a live issue carry
-- the name of somebody who deleted it once and was overruled, which is a fact the activity
-- feed already holds and this column would then contradict on the next delete.
--
-- name: RestoreIssue :one
UPDATE issue SET deleted_at = NULL, deleted_by = NULL
WHERE id = sqlc.arg(id) AND deleted_at IS NOT NULL AND deleted_at > sqlc.arg(deleted_after)
RETURNING id, workspace_id, team_id, number, title, description, state_id,
          assignee_id, creator_id, priority, sort_order,
          started_at, completed_at, canceled_at,
          archived_at, deleted_at, created_at, updated_at,
          estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id;

-- ListDeletedIssues is the "recently deleted" screen. Ordered by deletion time rather than
-- by sort_order, because the only question being asked here is "what did I just lose".
--
-- name: ListDeletedIssues :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE workspace_id = sqlc.arg(workspace_id)
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND deleted_at IS NOT NULL
  AND deleted_at > sqlc.arg(deleted_after)
ORDER BY deleted_at DESC;

-- name: ListIssuesForTeam :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE team_id = $1 AND archived_at IS NULL AND deleted_at IS NULL
ORDER BY sort_order;

-- ListChildIssues feeds the sub-issue list and the progress rollup on the parent. The
-- rollup counts states rather than sums them, so it needs the rows, not an aggregate —
-- and a parent has a handful of children, not a page of them.
--
-- Archived children are included on purpose: the parent's "3 of 5 done" must not silently
-- become "3 of 4" because somebody archived one, which would make a finished parent look
-- unfinished for no visible reason.
--
-- name: ListChildIssues :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE parent_id = $1 AND deleted_at IS NULL
ORDER BY sub_issue_sort_order, id;

-- ListChildIssuesForParents is ListChildIssues for a whole page of parents at once.
--
-- One statement rather than one per row, and that is the entire reason it exists: a list
-- view that renders a progress bar on every parent would otherwise issue a query per
-- visible issue, which is the N+1 the API's hydration layer is built to avoid. The
-- per-parent version above stays for the single-issue path, where the array round trip
-- would buy nothing.
--
-- Ordered by parent first so the caller can group the rows without sorting them again.
--
-- name: ListChildIssuesForParents :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE parent_id = ANY(sqlc.arg(parent_ids)::uuid[])
  AND workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NULL
ORDER BY parent_id, sub_issue_sort_order, id;

-- ListIssuesByIDs reads a scattered set of issues in one round trip, filtered to the teams
-- the caller can see.
--
-- The team filter is in the statement rather than in Go because this is a read by id: a
-- caller who could name an issue in a team they are not in would otherwise get it back,
-- and "did this uuid come back" is the enumeration oracle every not-found in this package
-- exists to close. Archived issues are included — an issue reached by id is reachable
-- whether or not it is on a board, which is the same rule GetIssue follows.
--
-- name: ListIssuesByIDs :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE id = ANY(sqlc.arg(ids)::uuid[])
  AND workspace_id = sqlc.arg(workspace_id)
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND deleted_at IS NULL
ORDER BY id;

-- ListMyIssues is everything assigned to the caller across every team they can see.
--
-- Ordered most-recently-touched first rather than by priority: 0 means "no priority", so
-- the numeric order puts unprioritised work at the top, and the display order is a client
-- concern the replica already implements. This only has to be stable and useful.
--
-- name: ListMyIssues :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE workspace_id = sqlc.arg(workspace_id)
  AND assignee_id = sqlc.arg(assignee_id)
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND archived_at IS NULL
  AND deleted_at IS NULL
  AND (sqlc.arg(include_completed)::boolean
       OR (completed_at IS NULL AND canceled_at IS NULL))
ORDER BY updated_at DESC, id;

-- StreamIssuesForBootstrap feeds the initial snapshot. Ordered by id (UUIDv7, so
-- effectively creation order) and keyset-paginated: OFFSET would degrade quadratically
-- on a workspace with a hundred thousand issues, which is exactly where it matters.
--
-- name: StreamIssuesForBootstrap :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE workspace_id = sqlc.arg(workspace_id)
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND archived_at IS NULL
  AND deleted_at IS NULL
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: CountIssuesInWorkspace :one
SELECT count(*) FROM issue
WHERE workspace_id = $1 AND archived_at IS NULL AND deleted_at IS NULL;

-- PurgeDeletedIssues hard-deletes a bounded batch of trashed issues and is the only
-- statement in the product that removes an issue row.
--
-- Everything that references the issue goes with it, by foreign key: comment,
-- issue_history, issue_label, issue_relation from both ends, issue_subscription and
-- notification are all ON DELETE CASCADE. Sub-issues are the exception — issue.parent_id is
-- ON DELETE SET NULL — so a child of a purged parent survives, orphaned, which is the same
-- choice the client's own cascade makes for the same reason: a cross-team sub-issue belongs
-- to a team that has lost nothing.
--
-- One statement rather than a SELECT followed by a DELETE. The window between the two would
-- be a window in which somebody restores an issue from the trash screen and has it hard
-- deleted anyway — the one mistake this table has no way back from. FOR UPDATE inside the
-- CTE is what makes the choice of victims and their removal the same instant.
--
-- The limit is not a nicety. Every returned id becomes a change_log row inside the caller's
-- transaction, and the version counter is a workspace-wide row lock, so an unbounded purge
-- of a large trash would hold every other writer in the workspace behind it.
--
-- name: PurgeDeletedIssues :many
WITH doomed AS (
  SELECT d.id FROM issue d
  WHERE d.workspace_id = sqlc.arg(workspace_id)
    AND d.deleted_at IS NOT NULL
    AND d.deleted_at <= sqlc.arg(deleted_before)
  ORDER BY d.deleted_at
  LIMIT sqlc.arg(page_size)
  FOR UPDATE
)
DELETE FROM issue i WHERE i.id IN (SELECT doomed.id FROM doomed)
RETURNING i.id, i.team_id;

-- CountIssuesToPurge is what is left after a batch, so the caller can say whether the trash
-- is empty rather than leaving them to call again and find out.
--
-- name: CountIssuesToPurge :one
SELECT count(*) FROM issue
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NOT NULL
  AND deleted_at <= sqlc.arg(deleted_before);

-- ListWorkspacesWithPurgeableIssues drives the retention sweep, which has no principal and
-- therefore no workspace of its own. Distinct rather than a join over workspace, because
-- the answer wanted is "where is there work to do", and most workspaces have none.
--
-- name: ListWorkspacesWithPurgeableIssues :many
SELECT DISTINCT workspace_id FROM issue
WHERE deleted_at IS NOT NULL AND deleted_at <= sqlc.arg(deleted_before);

-- Neighbour lookups for fractional-index insertion: find the sort_order either side of
-- the target position so a new key can be minted between them.
--
-- name: GetSortOrderBefore :one
SELECT sort_order FROM issue
WHERE team_id = sqlc.arg(team_id) AND state_id = sqlc.arg(state_id)
  AND sort_order < sqlc.arg(sort_order)
  AND archived_at IS NULL AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: GetSortOrderAfter :one
SELECT sort_order FROM issue
WHERE team_id = sqlc.arg(team_id) AND state_id = sqlc.arg(state_id)
  AND sort_order > sqlc.arg(sort_order)
  AND archived_at IS NULL AND deleted_at IS NULL
ORDER BY sort_order
LIMIT 1;

-- name: GetLastSortOrderForState :one
SELECT sort_order FROM issue
WHERE team_id = sqlc.arg(team_id) AND state_id = sqlc.arg(state_id)
  AND archived_at IS NULL AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- The sibling order is its own sequence per parent, unrelated to the team backlog's, so
-- it gets its own neighbour lookups rather than reusing the ones above.
--
-- name: GetSubIssueSortOrderAfter :one
SELECT sub_issue_sort_order FROM issue
WHERE parent_id = sqlc.arg(parent_id)
  AND sub_issue_sort_order > sqlc.arg(sub_issue_sort_order)
  AND deleted_at IS NULL
ORDER BY sub_issue_sort_order
LIMIT 1;

-- name: GetLastSubIssueSortOrder :one
SELECT sub_issue_sort_order FROM issue
WHERE parent_id = $1 AND sub_issue_sort_order IS NOT NULL AND deleted_at IS NULL
ORDER BY sub_issue_sort_order DESC
LIMIT 1;

-- GetIssueExists answers "is this id taken", for the client-minted-id path.
--
-- Deliberately not GetIssue: that filters deleted_at IS NULL, and a soft-deleted issue's
-- id is still occupied — the primary key does not care that the row is hidden. Reusing
-- GetIssue here would let a client claim the id of an issue it had just deleted and hit
-- the unique constraint instead, which surfaces as an internal error rather than as the
-- validation message that explains it.
--
-- Returns only the id: this is an existence check and reading the row would be handing
-- back an issue the caller may have no right to see.
--
-- name: GetIssueExists :one
SELECT id FROM issue WHERE id = $1;

-- ListIssuesForProject is the project's Issues tab. Live issues only; archived and
-- deleted stay off the board the same way they stay off a team list.
--
-- name: ListIssuesForProject :many
SELECT id, workspace_id, team_id, number, title, description, state_id,
       assignee_id, creator_id, priority, sort_order,
       started_at, completed_at, canceled_at,
       archived_at, deleted_at, created_at, updated_at,
       estimate, due_date, due_date_source, parent_id, sub_issue_sort_order, template_id, deleted_by,
          project_id, project_milestone_id, cycle_id
FROM issue
WHERE project_id = $1 AND archived_at IS NULL AND deleted_at IS NULL
ORDER BY sort_order;

