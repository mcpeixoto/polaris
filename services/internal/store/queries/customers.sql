-- name: CreateCustomer :one
INSERT INTO customer (
  id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
  creator_id, sort_order
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
          creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: GetCustomer :one
SELECT id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
       creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at
FROM customer
WHERE id = $1;

-- name: GetCustomerForUpdate :one
SELECT id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
       creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at
FROM customer
WHERE id = $1
FOR UPDATE;

-- name: UpdateCustomer :one
UPDATE customer
SET name     = COALESCE(sqlc.narg(name), name),
    domains  = CASE WHEN sqlc.arg(set_domains)::boolean THEN sqlc.arg(domains)
                    ELSE domains END,
    status   = COALESCE(sqlc.narg(status), status),
    logo_url = COALESCE(sqlc.narg(logo_url), logo_url),
    revenue  = CASE WHEN sqlc.arg(clear_revenue)::boolean THEN NULL
                    ELSE COALESCE(sqlc.narg(revenue), revenue) END,
    size     = CASE WHEN sqlc.arg(clear_size)::boolean THEN NULL
                    ELSE COALESCE(sqlc.narg(size), size) END,
    tier     = CASE WHEN sqlc.arg(clear_tier)::boolean THEN NULL
                    ELSE COALESCE(sqlc.narg(tier), tier) END,
    owner_id = CASE WHEN sqlc.arg(clear_owner)::boolean THEN NULL
                    ELSE COALESCE(sqlc.narg(owner_id), owner_id) END
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
          creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: ArchiveCustomer :exec
UPDATE customer SET archived_at = now() WHERE id = $1 AND archived_at IS NULL;

-- name: UnarchiveCustomer :one
UPDATE customer SET archived_at = NULL WHERE id = $1
RETURNING id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
          creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: SoftDeleteCustomer :one
UPDATE customer
SET deleted_at = now(), deleted_by = sqlc.arg(deleted_by)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
          creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at;

-- name: LastCustomerSortOrder :one
SELECT sort_order FROM customer
WHERE workspace_id = $1 AND deleted_at IS NULL
ORDER BY sort_order DESC
LIMIT 1;

-- name: ListCustomersInWorkspace :many
SELECT id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
       creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at
FROM customer
WHERE workspace_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
ORDER BY sort_order;

-- StreamCustomersForBootstrap: workspace-scoped; guests never call this.
--
-- name: StreamCustomersForBootstrap :many
SELECT id, workspace_id, name, domains, revenue, size, tier, status, owner_id, logo_url,
       creator_id, sort_order, archived_at, deleted_at, deleted_by, created_at, updated_at
FROM customer
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NULL
  AND archived_at IS NULL
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: DeleteCustomerDomains :exec
DELETE FROM customer_domain WHERE customer_id = $1;

-- name: InsertCustomerDomain :exec
INSERT INTO customer_domain (workspace_id, domain, customer_id)
VALUES ($1, $2, $3);

-- name: CreateCustomerRequest :one
INSERT INTO customer_request (
  id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id,
          created_at, updated_at;

-- name: GetCustomerRequest :one
SELECT id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id,
       created_at, updated_at
FROM customer_request
WHERE id = $1;

-- name: GetCustomerRequestForUpdate :one
SELECT id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id,
       created_at, updated_at
FROM customer_request
WHERE id = $1
FOR UPDATE;

-- name: UpdateCustomerRequest :one
UPDATE customer_request
SET body       = COALESCE(sqlc.narg(body), body),
    important  = COALESCE(sqlc.narg(important), important),
    issue_id   = COALESCE(sqlc.narg(issue_id), issue_id),
    project_id = COALESCE(sqlc.narg(project_id), project_id),
    customer_id = CASE WHEN sqlc.arg(clear_customer)::boolean THEN NULL
                       ELSE COALESCE(sqlc.narg(customer_id), customer_id) END
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id,
          created_at, updated_at;

-- name: DeleteCustomerRequest :one
DELETE FROM customer_request
WHERE id = $1
RETURNING id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id,
          created_at, updated_at;

-- name: ListCustomerRequestIDsForCustomer :many
SELECT id FROM customer_request WHERE customer_id = $1;

-- name: RetargetCustomerRequests :many
UPDATE customer_request
SET customer_id = sqlc.arg(into_id)
WHERE customer_id = sqlc.arg(source_id)
RETURNING id, workspace_id, customer_id, issue_id, project_id, body, important, creator_id,
          created_at, updated_at;

-- StreamCustomerRequestsForBootstrap: an issue-attached row follows the issue's team;
-- a project-only row follows the project's teams. Guests never call this.
--
-- name: StreamCustomerRequestsForBootstrap :many
SELECT cr.id, cr.workspace_id, cr.customer_id, cr.issue_id, cr.project_id, cr.body,
       cr.important, cr.creator_id, cr.created_at, cr.updated_at
FROM customer_request cr
WHERE cr.workspace_id = sqlc.arg(workspace_id)
  AND (
        (
          cr.issue_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM issue i
            WHERE i.id = cr.issue_id
              AND i.deleted_at IS NULL
              AND i.archived_at IS NULL
              AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
          )
        )
        OR (
          cr.issue_id IS NULL
          AND cr.project_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM project_team pt
            JOIN project p ON p.id = pt.project_id
            WHERE pt.project_id = cr.project_id
              AND p.deleted_at IS NULL
              AND p.archived_at IS NULL
              AND pt.team_id = ANY(sqlc.arg(team_ids)::uuid[])
          )
        )
      )
  AND cr.id > sqlc.arg(after_id)
ORDER BY cr.id
LIMIT sqlc.arg(page_size);
