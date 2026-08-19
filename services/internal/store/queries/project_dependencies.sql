-- name: CreateProjectDependency :one
INSERT INTO project_dependency (id, workspace_id, blocking_project_id, blocked_project_id)
VALUES ($1, $2, $3, $4)
RETURNING id, workspace_id, blocking_project_id, blocked_project_id, created_at;

-- name: GetProjectDependency :one
SELECT id, workspace_id, blocking_project_id, blocked_project_id, created_at
FROM project_dependency
WHERE id = $1;

-- name: DeleteProjectDependency :one
DELETE FROM project_dependency
WHERE id = $1
RETURNING id, workspace_id, blocking_project_id, blocked_project_id, created_at;

-- name: ListProjectDependenciesBlocking :many
SELECT id, workspace_id, blocking_project_id, blocked_project_id, created_at
FROM project_dependency
WHERE blocking_project_id = $1
ORDER BY created_at;

-- name: ListProjectDependenciesBlockedBy :many
SELECT id, workspace_id, blocking_project_id, blocked_project_id, created_at
FROM project_dependency
WHERE blocked_project_id = $1
ORDER BY created_at;

-- StreamProjectDependenciesForBootstrap: visible when the caller can see either project.
--
-- name: StreamProjectDependenciesForBootstrap :many
SELECT pd.id, pd.workspace_id, pd.blocking_project_id, pd.blocked_project_id, pd.created_at
FROM project_dependency pd
JOIN project bp ON bp.id = pd.blocking_project_id
JOIN project rp ON rp.id = pd.blocked_project_id
WHERE pd.workspace_id = sqlc.arg(workspace_id)
  AND bp.deleted_at IS NULL AND bp.archived_at IS NULL
  AND rp.deleted_at IS NULL AND rp.archived_at IS NULL
  AND (
        EXISTS (
          SELECT 1 FROM project_team pt
          WHERE pt.project_id = pd.blocking_project_id
            AND pt.team_id = ANY(sqlc.arg(team_ids)::uuid[])
        )
        OR EXISTS (
          SELECT 1 FROM project_team pt
          WHERE pt.project_id = pd.blocked_project_id
            AND pt.team_id = ANY(sqlc.arg(team_ids)::uuid[])
        )
      )
  AND pd.id > sqlc.arg(after_id)
ORDER BY pd.id
LIMIT sqlc.arg(page_size);
