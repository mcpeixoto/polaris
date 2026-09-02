-- name: CreateInitiative :one
INSERT INTO initiative (
  id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
  creator_id, sort_order, target_date, target_date_granularity
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
          creator_id, sort_order, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: GetInitiative :one
SELECT id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
       creator_id, sort_order, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at
FROM initiative
WHERE id = $1;

-- name: GetInitiativeForUpdate :one
SELECT id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
       creator_id, sort_order, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at
FROM initiative
WHERE id = $1
FOR UPDATE;

-- name: UpdateInitiative :one
UPDATE initiative
SET name                     = COALESCE(sqlc.narg(name), name),
    description              = COALESCE(sqlc.narg(description), description),
    status                   = COALESCE(sqlc.narg(status), status),
    priority                 = COALESCE(sqlc.narg(priority), priority),
    sort_order               = COALESCE(sqlc.narg(sort_order), sort_order),
    target_date              = CASE WHEN sqlc.arg(clear_target)::boolean THEN NULL
                                    ELSE COALESCE(sqlc.narg(target_date), target_date) END,
    target_date_granularity  = CASE WHEN sqlc.arg(clear_target)::boolean THEN NULL
                                    ELSE COALESCE(sqlc.narg(target_date_granularity), target_date_granularity) END,
    owner_id = CASE WHEN sqlc.arg(clear_owner)::boolean THEN NULL
                    ELSE COALESCE(sqlc.narg(owner_id), owner_id) END,
    lead_team_id = CASE WHEN sqlc.arg(clear_lead_team)::boolean THEN NULL
                        ELSE COALESCE(sqlc.narg(lead_team_id), lead_team_id) END
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
          creator_id, sort_order, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: ArchiveInitiative :exec
UPDATE initiative SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveInitiative :one
UPDATE initiative SET archived_at = NULL WHERE id = $1
RETURNING id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
          creator_id, sort_order, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: SoftDeleteInitiative :one
UPDATE initiative
SET deleted_at = now(), deleted_by = sqlc.arg(deleted_by)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
          creator_id, sort_order, target_date, target_date_granularity,
          archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: LastInitiativeSortOrder :one
SELECT sort_order FROM initiative
WHERE workspace_id = $1 AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: ListInitiativesInWorkspace :many
SELECT id, workspace_id, name, description, status, priority, owner_id, lead_team_id,
       creator_id, sort_order, target_date, target_date_granularity,
       archived_at, deleted_at, deleted_by, created_at, updated_at
FROM initiative
WHERE workspace_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
ORDER BY sort_order;

-- name: ListInitiativeProjects :many
SELECT id, workspace_id, initiative_id, project_id, created_at
FROM initiative_project
WHERE initiative_id = $1
ORDER BY created_at;

-- StreamInitiativesForBootstrap: workspace-visible unless the lead team is private and
-- the principal is not in it — the same rule initiativeScope uses.
--
-- name: StreamInitiativesForBootstrap :many
SELECT i.id, i.workspace_id, i.name, i.description, i.status, i.priority, i.owner_id,
       i.lead_team_id, i.creator_id, i.sort_order, i.target_date, i.target_date_granularity,
       i.archived_at, i.deleted_at, i.deleted_by, i.created_at, i.updated_at
FROM initiative i
LEFT JOIN team lt ON lt.id = i.lead_team_id
WHERE i.workspace_id = sqlc.arg(workspace_id)
  AND i.deleted_at IS NULL
  AND i.archived_at IS NULL
  AND (
        i.lead_team_id IS NULL
        OR lt.private = false
        OR i.lead_team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND i.id > sqlc.arg(after_id)
ORDER BY i.id
LIMIT sqlc.arg(page_size);

-- name: CreateInitiativeProject :one
INSERT INTO initiative_project (id, workspace_id, initiative_id, project_id)
VALUES ($1, $2, $3, $4)
RETURNING id, workspace_id, initiative_id, project_id, created_at;

-- name: GetInitiativeProject :one
SELECT id, workspace_id, initiative_id, project_id, created_at
FROM initiative_project
WHERE id = $1;

-- name: GetInitiativeProjectByPair :one
SELECT id, workspace_id, initiative_id, project_id, created_at
FROM initiative_project
WHERE initiative_id = $1 AND project_id = $2;

-- name: DeleteInitiativeProject :one
DELETE FROM initiative_project
WHERE id = $1
RETURNING id, workspace_id, initiative_id, project_id, created_at;

-- name: ListInitiativeProjectIDs :many
SELECT id FROM initiative_project WHERE initiative_id = $1;

-- StreamInitiativeProjectsForBootstrap: both the initiative and the project must be visible.
--
-- name: StreamInitiativeProjectsForBootstrap :many
SELECT ip.id, ip.workspace_id, ip.initiative_id, ip.project_id, ip.created_at
FROM initiative_project ip
JOIN initiative i ON i.id = ip.initiative_id
LEFT JOIN team lt ON lt.id = i.lead_team_id
WHERE ip.workspace_id = sqlc.arg(workspace_id)
  AND i.deleted_at IS NULL
  AND i.archived_at IS NULL
  AND (
        i.lead_team_id IS NULL
        OR lt.private = false
        OR i.lead_team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND EXISTS (
        SELECT 1 FROM project_team pt
        WHERE pt.project_id = ip.project_id
          AND pt.team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND ip.id > sqlc.arg(after_id)
ORDER BY ip.id
LIMIT sqlc.arg(page_size);

-- ListInitiativeProjectsForInitiatives is the listing above for a whole page of initiatives
-- at once, for the reason ListIssueLabelsForIssues is: `initiatives { projects { … } }`
-- hydrates a list in one pass, and a per-initiative query there is a query per row.
--
-- Visibility comes from the initiative, which the caller has already resolved: this reads
-- only the join rows, and the projects behind them are hydrated through the same
-- permission-filtered path every other project read uses.
--
-- name: ListInitiativeProjectsForInitiatives :many
SELECT id, workspace_id, initiative_id, project_id, created_at
FROM initiative_project
WHERE initiative_id = ANY(sqlc.arg(initiative_ids)::uuid[])
  AND workspace_id = sqlc.arg(workspace_id)
ORDER BY initiative_id, created_at;
