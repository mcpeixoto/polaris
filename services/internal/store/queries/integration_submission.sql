-- name: CreateIntegrationSubmission :one
INSERT INTO integration_submission (
  id, workspace_id, submitted_by, name, website, summary
) VALUES (
  $1, $2, $3, $4, $5, $6
)
RETURNING id, workspace_id, submitted_by, name, website, summary, created_at, updated_at;

-- name: ListIntegrationSubmissions :many
SELECT id, workspace_id, submitted_by, name, website, summary, created_at, updated_at
FROM integration_submission
WHERE workspace_id = $1
ORDER BY created_at DESC;
