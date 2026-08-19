-- name: CreateProjectTemplate :one
INSERT INTO project_template (id, workspace_id, team_id, name, description, summary, body,
                              properties, position, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(team_id), sqlc.arg(name),
        sqlc.narg(description), sqlc.arg(summary), sqlc.arg(body), sqlc.arg(properties),
        sqlc.arg(position), sqlc.narg(created_by))
RETURNING id, workspace_id, team_id, name, description, summary, body, properties, position,
          created_by, archived_at, created_at, updated_at;

-- name: GetProjectTemplate :one
SELECT id, workspace_id, team_id, name, description, summary, body, properties, position,
       created_by, archived_at, created_at, updated_at
FROM project_template
WHERE id = $1;

-- name: ListProjectTemplatesInWorkspace :many
SELECT id, workspace_id, team_id, name, description, summary, body, properties, position,
       created_by, archived_at, created_at, updated_at
FROM project_template
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: ListProjectTemplatesForTeam :many
SELECT id, workspace_id, team_id, name, description, summary, body, properties, position,
       created_by, archived_at, created_at, updated_at
FROM project_template
WHERE workspace_id = sqlc.arg(workspace_id)
  AND (team_id IS NULL OR team_id = sqlc.arg(team_id))
  AND archived_at IS NULL
ORDER BY position;

-- name: StreamProjectTemplatesForBootstrap :many
SELECT id, workspace_id, team_id, name, description, summary, body, properties, position,
       created_by, archived_at, created_at, updated_at
FROM project_template
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND (team_id = ANY(sqlc.arg(team_ids)::uuid[])
       OR (team_id IS NULL AND sqlc.arg(include_workspace_scoped)::boolean))
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: UpdateProjectTemplate :one
UPDATE project_template
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    summary     = COALESCE(sqlc.narg(summary), summary),
    body        = COALESCE(sqlc.narg(body), body),
    properties  = COALESCE(sqlc.narg(properties), properties),
    position    = COALESCE(sqlc.narg(position), position)
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, team_id, name, description, summary, body, properties, position,
          created_by, archived_at, created_at, updated_at;

-- name: ArchiveProjectTemplate :one
UPDATE project_template SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, team_id, name, description, summary, body, properties, position,
          created_by, archived_at, created_at, updated_at;

-- name: GetLastProjectTemplatePosition :one
SELECT position FROM project_template
WHERE workspace_id = $1
ORDER BY position DESC
LIMIT 1;

-- name: CountProjectsFromTemplate :one
SELECT count(*) FROM project
WHERE project_template_id = $1 AND deleted_at IS NULL;

-- name: CreateProjectTemplateMilestone :one
INSERT INTO project_template_milestone (id, workspace_id, project_template_id, name, description,
                                        target_date, sort_order)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_template_id), sqlc.arg(name),
        sqlc.narg(description), sqlc.narg(target_date), sqlc.arg(sort_order))
RETURNING id, workspace_id, project_template_id, name, description, target_date, sort_order,
          created_at, updated_at;

-- name: GetProjectTemplateMilestone :one
SELECT id, workspace_id, project_template_id, name, description, target_date, sort_order,
       created_at, updated_at
FROM project_template_milestone
WHERE id = $1;

-- name: ListProjectTemplateMilestones :many
SELECT id, workspace_id, project_template_id, name, description, target_date, sort_order,
       created_at, updated_at
FROM project_template_milestone
WHERE project_template_id = $1
ORDER BY sort_order;

-- name: StreamProjectTemplateMilestonesForBootstrap :many
SELECT m.id, m.workspace_id, m.project_template_id, m.name, m.description, m.target_date,
       m.sort_order, m.created_at, m.updated_at
FROM project_template_milestone m
JOIN project_template t ON t.id = m.project_template_id
WHERE m.workspace_id = sqlc.arg(workspace_id)
  AND t.archived_at IS NULL
  AND (t.team_id = ANY(sqlc.arg(team_ids)::uuid[])
       OR (t.team_id IS NULL AND sqlc.arg(include_workspace_scoped)::boolean))
  AND m.id > sqlc.arg(after_id)
ORDER BY m.id
LIMIT sqlc.arg(page_size);

-- name: UpdateProjectTemplateMilestone :one
UPDATE project_template_milestone
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    target_date = COALESCE(sqlc.narg(target_date), target_date),
    sort_order  = COALESCE(sqlc.narg(sort_order), sort_order)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, project_template_id, name, description, target_date, sort_order,
          created_at, updated_at;

-- name: DeleteProjectTemplateMilestone :exec
DELETE FROM project_template_milestone WHERE id = $1;

-- name: DeleteProjectTemplateMilestonesForTemplate :exec
DELETE FROM project_template_milestone WHERE project_template_id = $1;

-- name: GetLastProjectTemplateMilestoneSort :one
SELECT sort_order FROM project_template_milestone
WHERE project_template_id = $1
ORDER BY sort_order DESC
LIMIT 1;

-- name: CreateProjectTemplateIssue :one
INSERT INTO project_template_issue (id, workspace_id, project_template_id, parent_id, title,
                                    description, properties, sort_order)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_template_id), sqlc.narg(parent_id),
        sqlc.arg(title), sqlc.arg(description), sqlc.arg(properties), sqlc.arg(sort_order))
RETURNING id, workspace_id, project_template_id, parent_id, title, description, properties,
          sort_order, created_at, updated_at;

-- name: GetProjectTemplateIssue :one
SELECT id, workspace_id, project_template_id, parent_id, title, description, properties,
       sort_order, created_at, updated_at
FROM project_template_issue
WHERE id = $1;

-- name: ListProjectTemplateIssues :many
SELECT id, workspace_id, project_template_id, parent_id, title, description, properties,
       sort_order, created_at, updated_at
FROM project_template_issue
WHERE project_template_id = $1
ORDER BY sort_order;

-- name: StreamProjectTemplateIssuesForBootstrap :many
SELECT i.id, i.workspace_id, i.project_template_id, i.parent_id, i.title, i.description,
       i.properties, i.sort_order, i.created_at, i.updated_at
FROM project_template_issue i
JOIN project_template t ON t.id = i.project_template_id
WHERE i.workspace_id = sqlc.arg(workspace_id)
  AND t.archived_at IS NULL
  AND (t.team_id = ANY(sqlc.arg(team_ids)::uuid[])
       OR (t.team_id IS NULL AND sqlc.arg(include_workspace_scoped)::boolean))
  AND i.id > sqlc.arg(after_id)
ORDER BY i.id
LIMIT sqlc.arg(page_size);

-- name: UpdateProjectTemplateIssue :one
UPDATE project_template_issue
SET title       = COALESCE(sqlc.narg(title), title),
    description = COALESCE(sqlc.narg(description), description),
    properties  = COALESCE(sqlc.narg(properties), properties),
    sort_order  = COALESCE(sqlc.narg(sort_order), sort_order),
    parent_id   = COALESCE(sqlc.narg(parent_id), parent_id)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, project_template_id, parent_id, title, description, properties,
          sort_order, created_at, updated_at;

-- name: DeleteProjectTemplateIssue :exec
DELETE FROM project_template_issue WHERE id = $1;

-- name: DeleteProjectTemplateIssuesForTemplate :exec
DELETE FROM project_template_issue WHERE project_template_id = $1;

-- name: GetLastProjectTemplateIssueSort :one
SELECT sort_order FROM project_template_issue
WHERE project_template_id = $1 AND parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
ORDER BY sort_order DESC
LIMIT 1;
