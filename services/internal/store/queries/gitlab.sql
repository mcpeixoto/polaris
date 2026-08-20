-- Replicated columns only. access_token and webhook_secret are never selected here.

-- name: CreateGitLabConnection :one
INSERT INTO gitlab_connection (
  id, workspace_id, creator_id, enabled, instance_url,
  branch_name_format, link_commits, linkbacks, webhook_secret, access_token, connected_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
RETURNING id, workspace_id, creator_id, enabled, instance_url,
          branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at;

-- name: GetGitLabConnection :one
SELECT id, workspace_id, creator_id, enabled, instance_url,
       branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at
FROM gitlab_connection
WHERE workspace_id = $1;

-- name: GetGitLabConnectionSecret :one
SELECT webhook_secret
FROM gitlab_connection
WHERE workspace_id = $1;

-- name: GetGitLabConnectionAccessToken :one
SELECT COALESCE(access_token, '')::text AS access_token
FROM gitlab_connection
WHERE workspace_id = $1;

-- name: UpdateGitLabConnection :one
UPDATE gitlab_connection
SET instance_url = COALESCE(sqlc.narg(instance_url), instance_url),
    branch_name_format = COALESCE(sqlc.narg(branch_name_format), branch_name_format),
    link_commits = COALESCE(sqlc.narg(link_commits), link_commits),
    linkbacks = COALESCE(sqlc.narg(linkbacks), linkbacks),
    enabled = COALESCE(sqlc.narg(enabled), enabled),
    connected_at = COALESCE(sqlc.narg(connected_at), connected_at)
WHERE workspace_id = sqlc.arg(workspace_id)
RETURNING id, workspace_id, creator_id, enabled, instance_url,
          branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at;

-- name: SetGitLabConnectionAccessToken :exec
UPDATE gitlab_connection
SET access_token = sqlc.arg(access_token), connected_at = now()
WHERE workspace_id = sqlc.arg(workspace_id);

-- name: DeleteGitLabConnection :exec
DELETE FROM gitlab_connection WHERE workspace_id = $1;

-- name: StreamGitLabConnectionsForBootstrap :many
SELECT id, workspace_id, creator_id, enabled, instance_url,
       branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at
FROM gitlab_connection
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: CreateGitLabUserLink :one
INSERT INTO gitlab_user_link (
  id, workspace_id, user_id, gitlab_username, gitlab_user_id
) VALUES (
  $1, $2, $3, $4, $5
)
RETURNING id, workspace_id, user_id, gitlab_username, gitlab_user_id, created_at, updated_at;

-- name: GetGitLabUserLink :one
SELECT id, workspace_id, user_id, gitlab_username, gitlab_user_id, created_at, updated_at
FROM gitlab_user_link
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id);

-- name: UpdateGitLabUserLink :one
UPDATE gitlab_user_link
SET gitlab_username = sqlc.arg(gitlab_username),
    gitlab_user_id = sqlc.narg(gitlab_user_id)
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
RETURNING id, workspace_id, user_id, gitlab_username, gitlab_user_id, created_at, updated_at;

-- name: DeleteGitLabUserLink :exec
DELETE FROM gitlab_user_link
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id);

-- name: StreamGitLabUserLinksForBootstrap :many
SELECT id, workspace_id, user_id, gitlab_username, gitlab_user_id, created_at, updated_at
FROM gitlab_user_link
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
