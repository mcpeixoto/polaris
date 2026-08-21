-- Personal subscriptions to a project, initiative, or customer.

-- name: CreateProjectSubscription :one
INSERT INTO project_subscription (
  id, workspace_id, project_id, user_id,
  notify_issues_added, notify_issues_completed, notify_updates
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, workspace_id, project_id, user_id,
          notify_issues_added, notify_issues_completed, notify_updates,
          created_at, updated_at;

-- name: GetProjectSubscriptionForUser :one
SELECT id, workspace_id, project_id, user_id,
       notify_issues_added, notify_issues_completed, notify_updates,
       created_at, updated_at
FROM project_subscription
WHERE project_id = sqlc.arg(project_id) AND user_id = sqlc.arg(user_id);

-- name: UpdateProjectSubscription :one
UPDATE project_subscription
SET notify_issues_added     = sqlc.arg(notify_issues_added),
    notify_issues_completed = sqlc.arg(notify_issues_completed),
    notify_updates          = sqlc.arg(notify_updates)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, project_id, user_id,
          notify_issues_added, notify_issues_completed, notify_updates,
          created_at, updated_at;

-- name: DeleteProjectSubscription :exec
DELETE FROM project_subscription WHERE id = $1;

-- name: ListProjectSubscriptionsForProject :many
SELECT id, workspace_id, project_id, user_id,
       notify_issues_added, notify_issues_completed, notify_updates,
       created_at, updated_at
FROM project_subscription
WHERE project_id = $1
ORDER BY id;

-- Archived and deleted projects are omitted: archive does not CASCADE, and a subscription
-- pointing at a project nobody can open must not produce inbox rows.
--
-- name: ListProjectSubscriptionsForFanOut :many
SELECT s.id, s.workspace_id, s.project_id, s.user_id,
       s.notify_issues_added, s.notify_issues_completed, s.notify_updates,
       s.created_at, s.updated_at
FROM project_subscription s
JOIN project p ON p.id = s.project_id
WHERE s.workspace_id = $1
  AND p.archived_at IS NULL
  AND p.deleted_at IS NULL
ORDER BY s.project_id, s.id;

-- name: StreamProjectSubscriptionsForBootstrap :many
SELECT id, workspace_id, project_id, user_id,
       notify_issues_added, notify_issues_completed, notify_updates,
       created_at, updated_at
FROM project_subscription
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: CreateInitiativeSubscription :one
INSERT INTO initiative_subscription (
  id, workspace_id, initiative_id, user_id,
  notify_issues_added, notify_issues_completed, notify_updates
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, workspace_id, initiative_id, user_id,
          notify_issues_added, notify_issues_completed, notify_updates,
          created_at, updated_at;

-- name: GetInitiativeSubscriptionForUser :one
SELECT id, workspace_id, initiative_id, user_id,
       notify_issues_added, notify_issues_completed, notify_updates,
       created_at, updated_at
FROM initiative_subscription
WHERE initiative_id = sqlc.arg(initiative_id) AND user_id = sqlc.arg(user_id);

-- name: UpdateInitiativeSubscription :one
UPDATE initiative_subscription
SET notify_issues_added     = sqlc.arg(notify_issues_added),
    notify_issues_completed = sqlc.arg(notify_issues_completed),
    notify_updates          = sqlc.arg(notify_updates)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, initiative_id, user_id,
          notify_issues_added, notify_issues_completed, notify_updates,
          created_at, updated_at;

-- name: DeleteInitiativeSubscription :exec
DELETE FROM initiative_subscription WHERE id = $1;

-- name: ListInitiativeSubscriptionsForInitiative :many
SELECT id, workspace_id, initiative_id, user_id,
       notify_issues_added, notify_issues_completed, notify_updates,
       created_at, updated_at
FROM initiative_subscription
WHERE initiative_id = $1
ORDER BY id;

-- One row per (subscription, linked project). An initiative with no projects still returns
-- one row with a null project_id so update watches fire.
--
-- name: ListInitiativeSubscriptionsForFanOut :many
SELECT s.id, s.workspace_id, s.initiative_id, s.user_id,
       s.notify_issues_added, s.notify_issues_completed, s.notify_updates,
       s.created_at, s.updated_at, ip.project_id AS project_id
FROM initiative_subscription s
JOIN initiative i ON i.id = s.initiative_id
LEFT JOIN initiative_project ip ON ip.initiative_id = s.initiative_id
WHERE s.workspace_id = $1
  AND i.archived_at IS NULL
  AND i.deleted_at IS NULL
ORDER BY s.initiative_id, s.id;

-- name: StreamInitiativeSubscriptionsForBootstrap :many
SELECT id, workspace_id, initiative_id, user_id,
       notify_issues_added, notify_issues_completed, notify_updates,
       created_at, updated_at
FROM initiative_subscription
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: CreateCustomerSubscription :one
INSERT INTO customer_subscription (
  id, workspace_id, customer_id, user_id,
  notify_request_added, notify_request_important, notify_request_completed
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, workspace_id, customer_id, user_id,
          notify_request_added, notify_request_important, notify_request_completed,
          created_at, updated_at;

-- name: GetCustomerSubscriptionForUser :one
SELECT id, workspace_id, customer_id, user_id,
       notify_request_added, notify_request_important, notify_request_completed,
       created_at, updated_at
FROM customer_subscription
WHERE customer_id = sqlc.arg(customer_id) AND user_id = sqlc.arg(user_id);

-- name: UpdateCustomerSubscription :one
UPDATE customer_subscription
SET notify_request_added     = sqlc.arg(notify_request_added),
    notify_request_important = sqlc.arg(notify_request_important),
    notify_request_completed = sqlc.arg(notify_request_completed)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, customer_id, user_id,
          notify_request_added, notify_request_important, notify_request_completed,
          created_at, updated_at;

-- name: DeleteCustomerSubscription :exec
DELETE FROM customer_subscription WHERE id = $1;

-- name: ListCustomerSubscriptionsForCustomer :many
SELECT id, workspace_id, customer_id, user_id,
       notify_request_added, notify_request_important, notify_request_completed,
       created_at, updated_at
FROM customer_subscription
WHERE customer_id = $1
ORDER BY id;

-- name: ListCustomerSubscriptionsForFanOut :many
SELECT s.id, s.workspace_id, s.customer_id, s.user_id,
       s.notify_request_added, s.notify_request_important, s.notify_request_completed,
       s.created_at, s.updated_at
FROM customer_subscription s
JOIN customer c ON c.id = s.customer_id
WHERE s.workspace_id = $1
  AND c.archived_at IS NULL
  AND c.deleted_at IS NULL
ORDER BY s.customer_id, s.id;

-- name: StreamCustomerSubscriptionsForBootstrap :many
SELECT id, workspace_id, customer_id, user_id,
       notify_request_added, notify_request_important, notify_request_completed,
       created_at, updated_at
FROM customer_subscription
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: ListCustomerRequestsForIssue :many
SELECT id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id,
       created_at, updated_at
FROM customer_request
WHERE issue_id = $1;
