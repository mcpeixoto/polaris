-- name: CreateDashboard :one
INSERT INTO dashboard (
  id, workspace_id, team_id, owner_id, name, description, filter, creator_id, sort_order
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, workspace_id, team_id, owner_id, name, description, filter, creator_id,
          sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: GetDashboard :one
SELECT id, workspace_id, team_id, owner_id, name, description, filter, creator_id,
       sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at
FROM dashboard
WHERE id = $1;

-- name: GetDashboardForUpdate :one
SELECT id, workspace_id, team_id, owner_id, name, description, filter, creator_id,
       sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at
FROM dashboard
WHERE id = $1
FOR UPDATE;

-- name: UpdateDashboard :one
UPDATE dashboard
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    filter      = COALESCE(sqlc.narg(filter), filter)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, team_id, owner_id, name, description, filter, creator_id,
          sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: ArchiveDashboard :exec
UPDATE dashboard SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveDashboard :one
UPDATE dashboard SET archived_at = NULL WHERE id = $1
RETURNING id, workspace_id, team_id, owner_id, name, description, filter, creator_id,
          sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: SoftDeleteDashboard :one
UPDATE dashboard
SET deleted_at = now(), deleted_by = sqlc.arg(deleted_by)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, team_id, owner_id, name, description, filter, creator_id,
          sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: LastDashboardSortOrder :one
SELECT sort_order FROM dashboard
WHERE workspace_id = $1 AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- StreamDashboardsForBootstrap: workspace rows for members, team rows for membership,
-- personal rows for the owner. Guests never call this.
--
-- name: StreamDashboardsForBootstrap :many
SELECT id, workspace_id, team_id, owner_id, name, description, filter, creator_id,
       sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at
FROM dashboard
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NULL
  AND archived_at IS NULL
  AND (
        (owner_id IS NULL AND team_id IS NULL)
        OR owner_id = sqlc.arg(user_id)
        OR (owner_id IS NULL AND team_id = ANY(sqlc.arg(team_ids)::uuid[]))
      )
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: CreateDashboardTile :one
INSERT INTO dashboard_tile (
  id, workspace_id, dashboard_id, title, measure, slice, display, filter, sort_order
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, workspace_id, dashboard_id, title, measure, slice, display, filter,
          sort_order, created_at, updated_at;

-- name: GetDashboardTile :one
SELECT id, workspace_id, dashboard_id, title, measure, slice, display, filter,
       sort_order, created_at, updated_at
FROM dashboard_tile
WHERE id = $1;

-- name: GetDashboardTileForUpdate :one
SELECT id, workspace_id, dashboard_id, title, measure, slice, display, filter,
       sort_order, created_at, updated_at
FROM dashboard_tile
WHERE id = $1
FOR UPDATE;

-- name: UpdateDashboardTile :one
UPDATE dashboard_tile
SET title   = COALESCE(sqlc.narg(title), title),
    measure = COALESCE(sqlc.narg(measure), measure),
    slice   = COALESCE(sqlc.narg(slice), slice),
    display = COALESCE(sqlc.narg(display), display),
    filter  = COALESCE(sqlc.narg(filter), filter)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, dashboard_id, title, measure, slice, display, filter,
          sort_order, created_at, updated_at;

-- name: DeleteDashboardTile :one
DELETE FROM dashboard_tile
WHERE id = $1
RETURNING id, workspace_id, dashboard_id, title, measure, slice, display, filter,
          sort_order, created_at, updated_at;

-- name: ListDashboardTiles :many
SELECT id, workspace_id, dashboard_id, title, measure, slice, display, filter,
       sort_order, created_at, updated_at
FROM dashboard_tile
WHERE dashboard_id = $1
ORDER BY sort_order;

-- name: LastDashboardTileSortOrder :one
SELECT sort_order FROM dashboard_tile
WHERE dashboard_id = $1
ORDER BY sort_order DESC
LIMIT 1;

-- StreamDashboardTilesForBootstrap: a tile follows its dashboard's visibility.
--
-- name: StreamDashboardTilesForBootstrap :many
SELECT t.id, t.workspace_id, t.dashboard_id, t.title, t.measure, t.slice, t.display,
       t.filter, t.sort_order, t.created_at, t.updated_at
FROM dashboard_tile t
JOIN dashboard d ON d.id = t.dashboard_id
WHERE t.workspace_id = sqlc.arg(workspace_id)
  AND d.deleted_at IS NULL
  AND d.archived_at IS NULL
  AND (
        (d.owner_id IS NULL AND d.team_id IS NULL)
        OR d.owner_id = sqlc.arg(user_id)
        OR (d.owner_id IS NULL AND d.team_id = ANY(sqlc.arg(team_ids)::uuid[]))
      )
  AND t.id > sqlc.arg(after_id)
ORDER BY t.id
LIMIT sqlc.arg(page_size);
