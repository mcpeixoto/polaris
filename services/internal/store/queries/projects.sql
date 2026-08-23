-- Projects and the four entity types that hang off them.
--
-- Every SELECT lists columns in the table's own order, same rule as issues.sql: a new
-- column lands at the end, and so does its addition here.

-- ---------------------------------------------------------------------------------------
-- project_status

-- name: CreateProjectStatus :one
INSERT INTO project_status (id, workspace_id, name, description, color, category, position, is_default)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(name), sqlc.narg(description),
        COALESCE(sqlc.narg(color)::text, '#6b7280'),
        sqlc.arg(category), sqlc.arg(position), sqlc.arg(is_default))
RETURNING id, workspace_id, name, description, color, category, position, is_default,
          archived_at, created_at, updated_at;

-- name: GetProjectStatus :one
SELECT id, workspace_id, name, description, color, category, position, is_default,
       archived_at, created_at, updated_at
FROM project_status
WHERE id = $1;

-- name: GetDefaultProjectStatus :one
SELECT id, workspace_id, name, description, color, category, position, is_default,
       archived_at, created_at, updated_at
FROM project_status
WHERE workspace_id = $1 AND is_default AND archived_at IS NULL;

-- name: ListProjectStatuses :many
SELECT id, workspace_id, name, description, color, category, position, is_default,
       archived_at, created_at, updated_at
FROM project_status
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: StreamProjectStatusesForBootstrap :many
SELECT id, workspace_id, name, description, color, category, position, is_default,
       archived_at, created_at, updated_at
FROM project_status
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND sqlc.arg(include_workspace_scoped)::boolean
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: LastProjectStatusPosition :one
SELECT position FROM project_status
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- name: UpdateProjectStatus :one
UPDATE project_status
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    color       = COALESCE(sqlc.narg(color), color),
    category    = COALESCE(sqlc.narg(category), category),
    position    = COALESCE(sqlc.narg(position), position),
    is_default  = COALESCE(sqlc.narg(is_default), is_default)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, name, description, color, category, position, is_default,
          archived_at, created_at, updated_at;

-- name: CountProjectsInProjectStatus :one
SELECT count(*) FROM project WHERE status_id = $1 AND deleted_at IS NULL;

-- name: ArchiveProjectStatus :exec
UPDATE project_status SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveProjectStatus :exec
UPDATE project_status SET archived_at = NULL WHERE id = $1;

-- ClearDefaultProjectStatuses must run immediately before setting a new default, in the
-- same transaction: project_status_workspace_default_key is a partial unique index, so
-- doing it the other way round fails.
--
-- It returns what it demoted. The promotion reaches every client as a delta carrying the
-- promoted row; without the demoted one beside it the old default stays drawn as the
-- default in every replica that did not perform the write.
--
-- name: ClearDefaultProjectStatuses :many
UPDATE project_status SET is_default = false
WHERE workspace_id = $1 AND is_default AND id <> sqlc.arg(except_id)
RETURNING id, workspace_id, name, description, color, category, position, is_default,
          archived_at, created_at, updated_at;

-- ---------------------------------------------------------------------------------------
-- project

-- name: CreateProject :one
INSERT INTO project (id, workspace_id, name, summary, description, icon, color,
                     status_id, priority, lead_id, creator_id, sort_order,
                     start_date, start_date_granularity, target_date, target_date_granularity,
                     project_template_id)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(name), sqlc.narg(summary),
        COALESCE(sqlc.narg(description), ''), sqlc.narg(icon),
        COALESCE(sqlc.narg(color)::text, '#6b7280'),
        sqlc.arg(status_id), sqlc.arg(priority), sqlc.narg(lead_id), sqlc.narg(creator_id),
        sqlc.arg(sort_order),
        sqlc.narg(start_date), sqlc.narg(start_date_granularity),
        sqlc.narg(target_date), sqlc.narg(target_date_granularity),
        sqlc.narg(project_template_id))
RETURNING id, workspace_id, name, summary, description, icon, color,
          status_id, priority, lead_id, creator_id, sort_order,
          start_date, start_date_granularity, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at,
          update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
       project_template_id;

-- name: GetProject :one
SELECT id, workspace_id, name, summary, description, icon, color,
       status_id, priority, lead_id, creator_id, sort_order,
       start_date, start_date_granularity, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at,
       update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
       project_template_id
FROM project
WHERE id = $1 AND deleted_at IS NULL;

-- GetProjectForUpdate locks the row so concurrent team/member edits cannot interleave
-- with a delete, and so a restore reads the same snapshot it writes.
--
-- name: GetProjectForUpdate :one
SELECT id, workspace_id, name, summary, description, icon, color,
       status_id, priority, lead_id, creator_id, sort_order,
       start_date, start_date_granularity, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at,
       update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
       project_template_id
FROM project
WHERE id = $1 AND deleted_at IS NULL
FOR UPDATE;

-- GetProjectIncludingDeleted is the restore path: a live GetProject would 404 the trash.
--
-- name: GetProjectIncludingDeleted :one
SELECT id, workspace_id, name, summary, description, icon, color,
       status_id, priority, lead_id, creator_id, sort_order,
       start_date, start_date_granularity, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at,
       update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
       project_template_id
FROM project
WHERE id = $1
FOR UPDATE;

-- name: ListProjectsInWorkspace :many
SELECT id, workspace_id, name, summary, description, icon, color,
       status_id, priority, lead_id, creator_id, sort_order,
       start_date, start_date_granularity, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at,
       update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
       project_template_id
FROM project
WHERE workspace_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
ORDER BY sort_order;

-- StreamProjectsForBootstrap: a project is visible if the principal is in any of its
-- teams — the same predicate authz.Visible uses for ScopeProject.
--
-- name: StreamProjectsForBootstrap :many
SELECT p.id, p.workspace_id, p.name, p.summary, p.description, p.icon, p.color,
       p.status_id, p.priority, p.lead_id, p.creator_id, p.sort_order,
       p.start_date, p.start_date_granularity, p.target_date, p.target_date_granularity,
       p.archived_at, p.deleted_at, p.deleted_by, p.created_at, p.updated_at,
       p.update_schedule, p.update_reminder_interval_days, p.update_reminder_weekday, p.update_reminder_hour,
       p.project_template_id
FROM project p
WHERE p.workspace_id = sqlc.arg(workspace_id)
  AND p.deleted_at IS NULL
  AND EXISTS (
        SELECT 1 FROM project_team pt
        WHERE pt.project_id = p.id AND pt.team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND p.id > sqlc.arg(after_id)
ORDER BY p.id
LIMIT sqlc.arg(page_size);

-- name: LastProjectSortOrder :one
SELECT sort_order FROM project
WHERE workspace_id = $1 AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: LastProjectSortOrderForPriority :one
SELECT sort_order FROM project
WHERE workspace_id = sqlc.arg(workspace_id) AND priority = sqlc.arg(priority) AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: GetProjectSortOrderAfter :one
SELECT sort_order FROM project
WHERE workspace_id = sqlc.arg(workspace_id) AND priority = sqlc.arg(priority)
  AND sort_order > sqlc.arg(sort_order) AND deleted_at IS NULL
ORDER BY sort_order
LIMIT 1;

-- name: UpdateProject :one
UPDATE project
SET name                     = COALESCE(sqlc.narg(name), name),
    summary                  = COALESCE(sqlc.narg(summary), summary),
    description              = COALESCE(sqlc.narg(description), description),
    icon                     = COALESCE(sqlc.narg(icon), icon),
    color                    = COALESCE(sqlc.narg(color), color),
    status_id                = COALESCE(sqlc.narg(status_id), status_id),
    priority                 = COALESCE(sqlc.narg(priority), priority),
    sort_order               = COALESCE(sqlc.narg(sort_order), sort_order),
    start_date               = CASE WHEN sqlc.arg(clear_start)::boolean THEN NULL
                                    ELSE COALESCE(sqlc.narg(start_date), start_date) END,
    start_date_granularity   = CASE WHEN sqlc.arg(clear_start)::boolean THEN NULL
                                    ELSE COALESCE(sqlc.narg(start_date_granularity), start_date_granularity) END,
    target_date              = CASE WHEN sqlc.arg(clear_target)::boolean THEN NULL
                                    ELSE COALESCE(sqlc.narg(target_date), target_date) END,
    target_date_granularity  = CASE WHEN sqlc.arg(clear_target)::boolean THEN NULL
                                    ELSE COALESCE(sqlc.narg(target_date_granularity), target_date_granularity) END,
    lead_id = CASE WHEN sqlc.arg(clear_lead)::boolean THEN NULL
                   ELSE COALESCE(sqlc.narg(lead_id), lead_id) END,
    update_schedule = COALESCE(sqlc.narg(update_schedule), update_schedule),
    update_reminder_interval_days = COALESCE(
        sqlc.narg(update_reminder_interval_days), update_reminder_interval_days),
    update_reminder_weekday = COALESCE(
        sqlc.narg(update_reminder_weekday), update_reminder_weekday),
    update_reminder_hour = COALESCE(
        sqlc.narg(update_reminder_hour), update_reminder_hour)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, name, summary, description, icon, color,
          status_id, priority, lead_id, creator_id, sort_order,
          start_date, start_date_granularity, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at,
          update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
          project_template_id;

-- name: SoftDeleteProject :exec
UPDATE project SET deleted_at = now(), deleted_by = sqlc.narg(deleted_by)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: RestoreProject :one
UPDATE project SET deleted_at = NULL, deleted_by = NULL
WHERE id = sqlc.arg(id) AND deleted_at IS NOT NULL AND deleted_at > sqlc.arg(deleted_after)
RETURNING id, workspace_id, name, summary, description, icon, color,
          status_id, priority, lead_id, creator_id, sort_order,
          start_date, start_date_granularity, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at,
          update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
          project_template_id;

-- name: ListDeletedProjects :many
SELECT id, workspace_id, name, summary, description, icon, color,
       status_id, priority, lead_id, creator_id, sort_order,
       start_date, start_date_granularity, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at,
       update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
       project_template_id
FROM project
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NOT NULL
  AND deleted_at > sqlc.arg(deleted_after)
ORDER BY deleted_at DESC;

-- ---------------------------------------------------------------------------------------
-- project_team

-- name: AddProjectTeam :one
INSERT INTO project_team (id, workspace_id, project_id, team_id)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_id), sqlc.arg(team_id))
RETURNING id, workspace_id, project_id, team_id, created_at;

-- name: GetProjectTeam :one
SELECT id, workspace_id, project_id, team_id, created_at
FROM project_team
WHERE project_id = sqlc.arg(project_id) AND team_id = sqlc.arg(team_id);

-- name: RemoveProjectTeam :execrows
DELETE FROM project_team
WHERE project_id = sqlc.arg(project_id) AND team_id = sqlc.arg(team_id);

-- name: ListProjectTeams :many
SELECT id, workspace_id, project_id, team_id, created_at
FROM project_team
WHERE project_id = $1
ORDER BY created_at, id;

-- name: ListProjectTeamIDs :many
SELECT team_id FROM project_team WHERE project_id = $1 ORDER BY team_id;

-- name: CountProjectTeams :one
SELECT count(*) FROM project_team WHERE project_id = $1;

-- StreamProjectTeamsForBootstrap follows the parent project's visibility.
--
-- name: StreamProjectTeamsForBootstrap :many
SELECT pt.id, pt.workspace_id, pt.project_id, pt.team_id, pt.created_at
FROM project_team pt
WHERE pt.workspace_id = sqlc.arg(workspace_id)
  AND EXISTS (
        SELECT 1 FROM project_team visible
        WHERE visible.project_id = pt.project_id
          AND visible.team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND pt.id > sqlc.arg(after_id)
ORDER BY pt.id
LIMIT sqlc.arg(page_size);

-- ---------------------------------------------------------------------------------------
-- project_member

-- name: AddProjectMember :one
INSERT INTO project_member (id, workspace_id, project_id, user_id)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_id), sqlc.arg(user_id))
RETURNING id, workspace_id, project_id, user_id, created_at;

-- name: GetProjectMember :one
SELECT id, workspace_id, project_id, user_id, created_at
FROM project_member
WHERE project_id = sqlc.arg(project_id) AND user_id = sqlc.arg(user_id);

-- name: RemoveProjectMember :execrows
DELETE FROM project_member
WHERE project_id = sqlc.arg(project_id) AND user_id = sqlc.arg(user_id);

-- name: ListProjectMembers :many
SELECT id, workspace_id, project_id, user_id, created_at
FROM project_member
WHERE project_id = $1
ORDER BY created_at, id;

-- name: StreamProjectMembersForBootstrap :many
SELECT pm.id, pm.workspace_id, pm.project_id, pm.user_id, pm.created_at
FROM project_member pm
WHERE pm.workspace_id = sqlc.arg(workspace_id)
  AND EXISTS (
        SELECT 1 FROM project_team visible
        WHERE visible.project_id = pm.project_id
          AND visible.team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND pm.id > sqlc.arg(after_id)
ORDER BY pm.id
LIMIT sqlc.arg(page_size);

-- ---------------------------------------------------------------------------------------
-- project_milestone

-- name: CreateProjectMilestone :one
INSERT INTO project_milestone (id, workspace_id, project_id, name, description, target_date, sort_order)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_id), sqlc.arg(name),
        sqlc.narg(description), sqlc.narg(target_date), sqlc.arg(sort_order))
RETURNING id, workspace_id, project_id, name, description, target_date, sort_order,
          archived_at, created_at, updated_at;

-- name: GetProjectMilestone :one
SELECT id, workspace_id, project_id, name, description, target_date, sort_order,
       archived_at, created_at, updated_at
FROM project_milestone
WHERE id = $1 AND archived_at IS NULL;

-- name: ListProjectMilestones :many
SELECT id, workspace_id, project_id, name, description, target_date, sort_order,
       archived_at, created_at, updated_at
FROM project_milestone
WHERE project_id = $1 AND archived_at IS NULL
ORDER BY sort_order;

-- name: LastProjectMilestoneSortOrder :one
SELECT sort_order FROM project_milestone
WHERE project_id = $1 AND archived_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: UpdateProjectMilestone :one
UPDATE project_milestone
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    sort_order  = COALESCE(sqlc.narg(sort_order), sort_order),
    target_date = CASE WHEN sqlc.arg(clear_target)::boolean THEN NULL
                       ELSE COALESCE(sqlc.narg(target_date), target_date) END
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, project_id, name, description, target_date, sort_order,
          archived_at, created_at, updated_at;

-- name: ArchiveProjectMilestone :exec
UPDATE project_milestone SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: StreamProjectMilestonesForBootstrap :many
SELECT m.id, m.workspace_id, m.project_id, m.name, m.description, m.target_date, m.sort_order,
       m.archived_at, m.created_at, m.updated_at
FROM project_milestone m
WHERE m.workspace_id = sqlc.arg(workspace_id)
  AND m.archived_at IS NULL
  AND EXISTS (
        SELECT 1 FROM project_team visible
        WHERE visible.project_id = m.project_id
          AND visible.team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND m.id > sqlc.arg(after_id)
ORDER BY m.id
LIMIT sqlc.arg(page_size);

-- name: ArchiveProject :exec
UPDATE project SET archived_at = now() WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL;

-- name: UnarchiveProject :one
UPDATE project SET archived_at = NULL WHERE id = $1 AND deleted_at IS NULL
RETURNING id, workspace_id, name, summary, description, icon, color,
          status_id, priority, lead_id, creator_id, sort_order,
          start_date, start_date_granularity, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at,
          update_schedule, update_reminder_interval_days, update_reminder_weekday, update_reminder_hour,
          project_template_id;

-- Archived projects linked to this team. A project belongs to the workspace, but the
-- archives page is per-team, so the join is the same visibility rule the live list uses.
--
-- name: ListArchivedProjectsForTeam :many
SELECT p.id, p.workspace_id, p.name, p.summary, p.description, p.icon, p.color,
       p.status_id, p.priority, p.lead_id, p.creator_id, p.sort_order,
       p.start_date, p.start_date_granularity, p.target_date, p.target_date_granularity,
       p.archived_at, p.deleted_at, p.deleted_by, p.created_at, p.updated_at,
       p.update_schedule, p.update_reminder_interval_days, p.update_reminder_weekday, p.update_reminder_hour,
       p.project_template_id
FROM project p
JOIN project_team pt ON pt.project_id = p.id
WHERE pt.team_id = $1 AND p.archived_at IS NOT NULL AND p.deleted_at IS NULL
ORDER BY p.archived_at DESC;

-- Live projects on this team in a completed/canceled status, stale enough to consider.
--
-- name: ListStaleClosedProjectsForTeam :many
SELECT p.id, p.workspace_id, p.name, p.summary, p.description, p.icon, p.color,
       p.status_id, p.priority, p.lead_id, p.creator_id, p.sort_order,
       p.start_date, p.start_date_granularity, p.target_date, p.target_date_granularity,
       p.archived_at, p.deleted_at, p.deleted_by, p.created_at, p.updated_at,
       p.update_schedule, p.update_reminder_interval_days, p.update_reminder_weekday, p.update_reminder_hour,
       p.project_template_id
FROM project p
JOIN project_team pt ON pt.project_id = p.id
JOIN project_status ps ON ps.id = p.status_id
WHERE pt.team_id = sqlc.arg(team_id)
  AND p.archived_at IS NULL AND p.deleted_at IS NULL
  AND ps.category IN ('completed', 'canceled')
  AND p.updated_at < sqlc.arg(cutoff)
ORDER BY p.updated_at, p.id;
