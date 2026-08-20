-- Personal subscriptions to a saved view.

-- name: CreateViewSubscription :one
INSERT INTO view_subscription (
  id, workspace_id, view_id, user_id, notify_added, notify_completed
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, view_id, user_id, notify_added, notify_completed,
          created_at, updated_at;

-- name: GetViewSubscription :one
SELECT id, workspace_id, view_id, user_id, notify_added, notify_completed,
       created_at, updated_at
FROM view_subscription
WHERE id = $1;

-- name: GetViewSubscriptionForUser :one
SELECT id, workspace_id, view_id, user_id, notify_added, notify_completed,
       created_at, updated_at
FROM view_subscription
WHERE view_id = sqlc.arg(view_id) AND user_id = sqlc.arg(user_id);

-- name: UpdateViewSubscription :one
UPDATE view_subscription
SET notify_added     = sqlc.arg(notify_added),
    notify_completed = sqlc.arg(notify_completed)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, view_id, user_id, notify_added, notify_completed,
          created_at, updated_at;

-- name: DeleteViewSubscription :exec
DELETE FROM view_subscription WHERE id = $1;

-- name: ListViewSubscriptionsForView :many
SELECT id, workspace_id, view_id, user_id, notify_added, notify_completed,
       created_at, updated_at
FROM view_subscription
WHERE view_id = $1
ORDER BY id;

-- The fan-out's read: every subscription in the workspace, with the view's filter so a
-- pass can compile once per view rather than once per (view, subscriber) pair.
--
-- Archived views are omitted: DeleteView archives rather than removes, and a subscription
-- pointing at a view nobody can open must not produce inbox rows.
--
-- name: ListViewSubscriptionsForFanOut :many
SELECT s.id, s.workspace_id, s.view_id, s.user_id, s.notify_added, s.notify_completed,
       s.created_at, s.updated_at, v.filter AS view_filter, v.archived_at AS view_archived_at
FROM view_subscription s
JOIN view v ON v.id = s.view_id
WHERE s.workspace_id = $1
  AND v.archived_at IS NULL
ORDER BY s.view_id, s.id;

-- StreamViewSubscriptionsForBootstrap is one person's subscriptions. A view subscription
-- is personal the way an inbox row is: it travels under a user scope and never appears in
-- anybody else's replica.
--
-- name: StreamViewSubscriptionsForBootstrap :many
SELECT id, workspace_id, view_id, user_id, notify_added, notify_completed,
       created_at, updated_at
FROM view_subscription
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
