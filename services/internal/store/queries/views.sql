-- Saved views, the display preferences of the views that have no row, and favourites.

-- name: CreateView :one
INSERT INTO view (id, workspace_id, team_id, owner_id, project_id, name, description, icon, color,
                  filter, display, position, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(team_id), sqlc.narg(owner_id),
        sqlc.narg(project_id), sqlc.arg(name), sqlc.narg(description), sqlc.narg(icon),
        sqlc.narg(color), sqlc.arg(filter), sqlc.arg(display), sqlc.arg(position),
        sqlc.narg(created_by))
RETURNING id, workspace_id, team_id, owner_id, project_id, name, description, icon, color,
          filter, display, position, created_by, archived_at, created_at, updated_at;

-- name: GetView :one
SELECT id, workspace_id, team_id, owner_id, project_id, name, description, icon, color,
       filter, display, position, created_by, archived_at, created_at, updated_at
FROM view
WHERE id = $1;

-- ListViewsForUser is the sidebar visibility rule, stated once: workspace views, team views,
-- and the caller's private views. Project-attached views are omitted — they live as tabs on
-- a project, not in the sidebar.
--
-- name: ListViewsForUser :many
SELECT id, workspace_id, team_id, owner_id, project_id, name, description, icon, color,
       filter, display, position, created_by, archived_at, created_at, updated_at
FROM view
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND project_id IS NULL
  AND (team_id IS NULL OR team_id = ANY(sqlc.arg(team_ids)::uuid[]))
  AND (owner_id IS NULL OR owner_id = sqlc.arg(user_id))
ORDER BY position;

-- StreamViewsForBootstrap is ListViewsForUser as the snapshot needs it: keyset-paginated,
-- and with the guest arm the listing above leaves to Go stated here instead.
--
-- The four-way rule is scopeForView's — an owner makes the view personal, a project makes
-- it the project's, a team makes it the team's, and none of those makes it the workspace's —
-- so this and the change scope agree about who may see a view.
--
-- The team clause applies to private views too, and that is not a mistake. A private view
-- anchored to a team travels under its owner's scope, so nothing revokes it when the owner
-- leaves that team — but the client drops a team's views along with the team when the
-- revoke for the team itself arrives (Store.forget in web/src/store/store.ts, the team arm,
-- which walks viewTeam without asking who owns the row). A snapshot that shipped it back
-- would hand a bootstrapped replica a sidebar entry that a replica which watched the
-- removal happen does not have.
--
-- name: StreamViewsForBootstrap :many
SELECT id, workspace_id, team_id, owner_id, project_id, name, description, icon, color,
       filter, display, position, created_by, archived_at, created_at, updated_at
FROM view
WHERE view.workspace_id = sqlc.arg(workspace_id)
  AND view.archived_at IS NULL
  AND (
    (view.project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM project_team visible
      WHERE visible.project_id = view.project_id
        AND visible.team_id = ANY(sqlc.arg(team_ids)::uuid[])
    ))
    OR (
      view.project_id IS NULL
      AND (view.team_id IS NULL OR view.team_id = ANY(sqlc.arg(team_ids)::uuid[]))
      AND (view.owner_id = sqlc.arg(user_id)
           OR (view.owner_id IS NULL
               AND (view.team_id IS NOT NULL OR sqlc.arg(include_workspace_scoped)::boolean)))
    )
  )
  AND view.id > sqlc.arg(after_id)
ORDER BY view.id
LIMIT sqlc.arg(page_size);

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
RETURNING id, workspace_id, team_id, owner_id, project_id, name, description, icon, color,
          filter, display, position, created_by, archived_at, created_at, updated_at;

-- Deleting a view archives it. Favourites and view_preference rows point at views by id
-- with no foreign key, so a hard delete would leave a sidebar entry nothing can resolve —
-- and the person who deleted a shared view is rarely the only person using it.
--
-- name: ArchiveView :one
UPDATE view SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, team_id, owner_id, project_id, name, description, icon, color,
          filter, display, position, created_by, archived_at, created_at, updated_at;

-- Positions are compared across every sidebar view in the workspace, which is the order the
-- sidebar renders them in after the visibility filter has been applied.
--
-- name: GetViewPositionAfter :one
SELECT position FROM view
WHERE workspace_id = sqlc.arg(workspace_id)
  AND project_id IS NULL
  AND position > sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position
LIMIT 1;

-- name: GetLastViewPosition :one
SELECT position FROM view
WHERE workspace_id = $1 AND project_id IS NULL AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- Positions on a project's tabs are compared only within that project.
--
-- name: GetViewPositionAfterForProject :one
SELECT position FROM view
WHERE project_id = sqlc.arg(project_id)
  AND position > sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position
LIMIT 1;

-- name: GetLastViewPositionForProject :one
SELECT position FROM view
WHERE project_id = $1 AND archived_at IS NULL
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

-- StreamViewPreferencesForBootstrap feeds the initial snapshot. A preference travels under
-- its owner's user scope and under nothing else, so the whole visibility rule is "yours".
--
-- Ordered by id rather than by view_key, which is what ListViewPreferences sorts on: the
-- snapshot pages by id and a key order would need an offset to resume.
--
-- name: StreamViewPreferencesForBootstrap :many
SELECT id, workspace_id, user_id, view_key, display, created_at, updated_at
FROM view_preference
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

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

-- StreamFavoritesForBootstrap ships the caller's own sidebar, minus the entries pointing at
-- something this same snapshot does not carry.
--
-- A favourite travels under its owner's user scope, so "yours" is the whole of the
-- visibility rule — but it is not the whole of the predicate, because a favourite is a
-- pointer with no foreign key and the client deletes one whose target it forgets
-- (Store.forget in web/src/store/store.ts, the trailing favoriteTarget walk). Losing a team
-- emits one revoke, for the team; the replica that watched it drops the team's issues, its
-- labels, its views and every favourite pointing at any of them. A snapshot that shipped
-- those favourites back would leave a bootstrapped replica holding sidebar rows that cannot
-- be opened, renamed or removed, and that a replica which stayed online does not have.
--
-- So each arm below is the membership test of the stream that ships that kind, and the four
-- have to keep agreeing with StreamViewsForBootstrap, StreamLabelsForBootstrap,
-- StreamIssuesForBootstrap and the team filter in StreamBootstrap itself. The team arm is
-- the one that is not obviously the same: the snapshot ships archived teams (they are still
-- yours to look at), so this does too, and only a deleted one is dropped.
--
-- name: StreamFavoritesForBootstrap :many
SELECT f.id, f.workspace_id, f.user_id, f.kind, f.target_id, f.position,
       f.created_at, f.updated_at
FROM favorite f
WHERE f.workspace_id = sqlc.arg(workspace_id)
  AND f.user_id = sqlc.arg(user_id)
  AND f.id > sqlc.arg(after_id)
  AND (
    (f.kind = 'view' AND EXISTS (
      SELECT 1 FROM view v
      WHERE v.id = f.target_id
        AND v.workspace_id = sqlc.arg(workspace_id)
        AND v.archived_at IS NULL
        AND (
          (v.project_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM project_team visible
            WHERE visible.project_id = v.project_id
              AND visible.team_id = ANY(sqlc.arg(team_ids)::uuid[])
          ))
          OR (
            v.project_id IS NULL
            AND (v.team_id IS NULL OR v.team_id = ANY(sqlc.arg(team_ids)::uuid[]))
            AND (v.owner_id = sqlc.arg(user_id)
                 OR (v.owner_id IS NULL
                     AND (v.team_id IS NOT NULL OR sqlc.arg(include_workspace_scoped)::boolean)))
          )
        )))
    OR (f.kind = 'team' AND EXISTS (
      SELECT 1 FROM team t
      WHERE t.id = f.target_id
        AND t.workspace_id = sqlc.arg(workspace_id)
        AND t.deleted_at IS NULL
        AND t.id = ANY(sqlc.arg(team_ids)::uuid[])))
    OR (f.kind = 'issue' AND EXISTS (
      SELECT 1 FROM issue i
      WHERE i.id = f.target_id
        AND i.workspace_id = sqlc.arg(workspace_id)
        AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
        AND i.archived_at IS NULL
        AND i.deleted_at IS NULL))
    OR (f.kind = 'label' AND EXISTS (
      SELECT 1 FROM label l
      WHERE l.id = f.target_id
        AND l.workspace_id = sqlc.arg(workspace_id)
        AND l.archived_at IS NULL
        AND (l.team_id = ANY(sqlc.arg(team_ids)::uuid[])
             OR (l.team_id IS NULL AND sqlc.arg(include_workspace_scoped)::boolean))))
  )
ORDER BY f.id
LIMIT sqlc.arg(page_size);

-- ListFavoritesForTarget is everybody's favourites pointing at one thing.
--
-- It exists for the restore, and it is the counterpart to StreamFavoritesForBootstrap: the
-- client drops a favourite whose target it forgets, so a deleted issue takes every star on
-- it off every sidebar, and only a republication puts them back. Without it the replica that
-- watched the undo is missing sidebar rows that a bootstrap taken a second later has.
--
-- Not scoped to a user, unlike every other statement in this section, because the caller is
-- not the owner — it is republishing on behalf of all of them, and each row goes out under
-- its own owner's scope.
--
-- name: ListFavoritesForTarget :many
SELECT id, workspace_id, user_id, kind, target_id, position, created_at, updated_at
FROM favorite
WHERE workspace_id = sqlc.arg(workspace_id)
  AND kind = sqlc.arg(kind)
  AND target_id = sqlc.arg(target_id)
ORDER BY id;

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
