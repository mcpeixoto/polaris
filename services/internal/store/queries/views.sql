-- Saved views, the display preferences of the views that have no row, and favourites.

-- name: CreateView :one
INSERT INTO view (id, workspace_id, team_id, owner_id, name, description, icon, color,
                  filter, display, position, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(team_id), sqlc.narg(owner_id),
        sqlc.arg(name), sqlc.narg(description), sqlc.narg(icon), sqlc.narg(color),
        sqlc.arg(filter), sqlc.arg(display), sqlc.arg(position), sqlc.narg(created_by))
RETURNING id, workspace_id, team_id, owner_id, name, description, icon, color,
          filter, display, position, created_by, archived_at, created_at, updated_at;

-- name: GetView :one
SELECT id, workspace_id, team_id, owner_id, name, description, icon, color,
       filter, display, position, created_by, archived_at, created_at, updated_at
FROM view
WHERE id = $1;

-- ListViewsForUser is the visibility rule, stated once: a view with no team spans the
-- workspace, a view with a team belongs to that team's sidebar, and a view with an owner
-- is private to them. Writing it here rather than filtering in Go is what keeps the
-- bootstrap snapshot and the live change scope agreeing about who may see a view.
--
-- name: ListViewsForUser :many
SELECT id, workspace_id, team_id, owner_id, name, description, icon, color,
       filter, display, position, created_by, archived_at, created_at, updated_at
FROM view
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND (team_id IS NULL OR team_id = ANY(sqlc.arg(team_ids)::uuid[]))
  AND (owner_id IS NULL OR owner_id = sqlc.arg(user_id))
ORDER BY position;

-- name: UpdateView :one
UPDATE view
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    icon        = COALESCE(sqlc.narg(icon), icon),
    color       = COALESCE(sqlc.narg(color), color),
    filter      = COALESCE(sqlc.narg(filter), filter),
    display     = COALESCE(sqlc.narg(display), display),
    position    = COALESCE(sqlc.narg(position), position)
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, team_id, owner_id, name, description, icon, color,
          filter, display, position, created_by, archived_at, created_at, updated_at;

-- Deleting a view archives it. Favourites and view_preference rows point at views by id
-- with no foreign key, so a hard delete would leave a sidebar entry nothing can resolve —
-- and the person who deleted a shared view is rarely the only person using it.
--
-- name: ArchiveView :one
UPDATE view SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, team_id, owner_id, name, description, icon, color,
          filter, display, position, created_by, archived_at, created_at, updated_at;

-- Positions are compared across every view in the workspace, which is the order the
-- sidebar renders them in after the visibility filter has been applied.
--
-- name: GetViewPositionAfter :one
SELECT position FROM view
WHERE workspace_id = sqlc.arg(workspace_id)
  AND position > sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position
LIMIT 1;

-- name: GetLastViewPosition :one
SELECT position FROM view
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- ---------------------------------------------------------------------------------------
-- Display preferences for the built-in views.

-- The id is only ever used when the row is created; the natural key is (user_id, view_key)
-- and the upsert conflicts on it. A caller therefore mints an id every time and usually
-- throws it away, which is the price of every entity on the sync stream being addressed by
-- a uuid.
--
-- name: UpsertViewPreference :one
INSERT INTO view_preference (id, workspace_id, user_id, view_key, display)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(view_key),
        sqlc.arg(display))
ON CONFLICT (user_id, view_key) DO UPDATE SET display = EXCLUDED.display
RETURNING id, workspace_id, user_id, view_key, display, created_at, updated_at;

-- name: ListViewPreferences :many
SELECT id, workspace_id, user_id, view_key, display, created_at, updated_at
FROM view_preference
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
ORDER BY view_key;

-- ---------------------------------------------------------------------------------------
-- Favourites.

-- Re-favouriting something already favourited moves it rather than failing: the only way a
-- user reaches this twice is by dragging an entry they had already added, and an error
-- there would read as the drag not having worked.
--
-- name: AddFavorite :one
INSERT INTO favorite (id, workspace_id, user_id, kind, target_id, position)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(kind),
        sqlc.arg(target_id), sqlc.arg(position))
ON CONFLICT (user_id, kind, target_id) DO UPDATE SET position = EXCLUDED.position
RETURNING id, workspace_id, user_id, kind, target_id, position, created_at, updated_at;

-- Returns the removed row because the caller knows the target, not the id the change
-- stream needs.
--
-- name: RemoveFavorite :one
DELETE FROM favorite
WHERE user_id = sqlc.arg(user_id) AND kind = sqlc.arg(kind) AND target_id = sqlc.arg(target_id)
RETURNING id, workspace_id, user_id, kind, target_id, position, created_at, updated_at;

-- name: ListFavorites :many
SELECT id, workspace_id, user_id, kind, target_id, position, created_at, updated_at
FROM favorite
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
ORDER BY position;

-- name: GetFavoritePositionAfter :one
SELECT position FROM favorite
WHERE user_id = sqlc.arg(user_id) AND position > sqlc.arg(position)
ORDER BY position
LIMIT 1;

-- name: GetLastFavoritePosition :one
SELECT position FROM favorite
WHERE user_id = $1
ORDER BY position DESC
LIMIT 1;
