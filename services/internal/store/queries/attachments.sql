-- name: CreateAttachment :one
INSERT INTO attachment (id, workspace_id, issue_id, team_id, url, title, subtitle, icon_url, metadata, creator_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, workspace_id, issue_id, team_id, url, title, subtitle, icon_url, metadata,
          creator_id, created_at, updated_at;

-- name: GetAttachment :one
SELECT id, workspace_id, issue_id, team_id, url, title, subtitle, icon_url, metadata,
       creator_id, created_at, updated_at
FROM attachment
WHERE id = $1;

-- name: GetAttachmentByIssueURL :one
SELECT id, workspace_id, issue_id, team_id, url, title, subtitle, icon_url, metadata,
       creator_id, created_at, updated_at
FROM attachment
WHERE issue_id = sqlc.arg(issue_id) AND url = sqlc.arg(url);

-- name: ListAttachmentsForIssue :many
SELECT id, workspace_id, issue_id, team_id, url, title, subtitle, icon_url, metadata,
       creator_id, created_at, updated_at
FROM attachment
WHERE issue_id = $1
ORDER BY created_at;

-- name: ListAttachmentsForURL :many
SELECT a.id, a.workspace_id, a.issue_id, a.team_id, a.url, a.title, a.subtitle, a.icon_url,
       a.metadata, a.creator_id, a.created_at, a.updated_at
FROM attachment a
JOIN issue i ON i.id = a.issue_id
WHERE a.workspace_id = sqlc.arg(workspace_id)
  AND a.url = sqlc.arg(url)
  AND i.archived_at IS NULL AND i.deleted_at IS NULL
ORDER BY a.created_at;

-- name: UpdateAttachment :one
UPDATE attachment
SET title = sqlc.arg(title),
    subtitle = sqlc.narg(subtitle),
    icon_url = sqlc.narg(icon_url),
    metadata = sqlc.arg(metadata)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, issue_id, team_id, url, title, subtitle, icon_url, metadata,
          creator_id, created_at, updated_at;

-- name: RelocateAttachment :one
UPDATE attachment
SET issue_id = sqlc.arg(issue_id), team_id = sqlc.arg(team_id)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, issue_id, team_id, url, title, subtitle, icon_url, metadata,
          creator_id, created_at, updated_at;

-- name: DeleteAttachment :exec
DELETE FROM attachment WHERE id = $1;

-- name: StreamAttachmentsForBootstrap :many
SELECT a.id, a.workspace_id, a.issue_id, a.team_id, a.url, a.title, a.subtitle, a.icon_url,
       a.metadata, a.creator_id, a.created_at, a.updated_at
FROM attachment a
JOIN issue i ON i.id = a.issue_id
WHERE a.workspace_id = sqlc.arg(workspace_id)
  AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND i.archived_at IS NULL AND i.deleted_at IS NULL
  AND a.id > sqlc.arg(after_id)
ORDER BY a.id
LIMIT sqlc.arg(page_size);
