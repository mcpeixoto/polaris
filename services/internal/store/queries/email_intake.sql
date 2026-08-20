-- Inbound email idempotency: a retried webhook with the same Message-ID must not mint
-- a second issue. Replies are refused before they reach this table.

-- name: InsertInboundEmail :one
INSERT INTO inbound_email (id, workspace_id, issue_id, message_id)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(issue_id), sqlc.arg(message_id))
RETURNING id, workspace_id, issue_id, message_id, created_at;

-- name: GetInboundEmailByMessageID :one
SELECT id, workspace_id, issue_id, message_id, created_at
FROM inbound_email
WHERE workspace_id = sqlc.arg(workspace_id) AND message_id = sqlc.arg(message_id);
