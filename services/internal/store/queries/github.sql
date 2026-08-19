-- Replicated columns only. access_token and commit_webhook_secret are never selected here.

-- name: CreateGitHubConnection :one
INSERT INTO github_connection (
  id, workspace_id, creator_id, enabled, org_login, installation_id,
  branch_name_format, link_commits, linkbacks, commit_webhook_secret, connected_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
RETURNING id, workspace_id, creator_id, enabled, org_login, installation_id,
          branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at;

-- name: GetGitHubConnection :one
SELECT id, workspace_id, creator_id, enabled, org_login, installation_id,
       branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at
FROM github_connection
WHERE workspace_id = $1;

-- name: GetGitHubConnectionSecret :one
SELECT commit_webhook_secret
FROM github_connection
WHERE workspace_id = $1;

-- name: GetGitHubConnectionAccessToken :one
SELECT COALESCE(access_token, '')::text AS access_token
FROM github_connection
WHERE workspace_id = $1;

-- name: GetGitHubConnectionByInstallation :one
SELECT id, workspace_id, creator_id, enabled, org_login, installation_id,
       branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at
FROM github_connection
WHERE installation_id = sqlc.arg(installation_id);

-- name: UpdateGitHubConnection :one
UPDATE github_connection
SET org_login = COALESCE(sqlc.narg(org_login), org_login),
    installation_id = COALESCE(sqlc.narg(installation_id), installation_id),
    branch_name_format = COALESCE(sqlc.narg(branch_name_format), branch_name_format),
    link_commits = COALESCE(sqlc.narg(link_commits), link_commits),
    linkbacks = COALESCE(sqlc.narg(linkbacks), linkbacks),
    enabled = COALESCE(sqlc.narg(enabled), enabled),
    connected_at = COALESCE(sqlc.narg(connected_at), connected_at)
WHERE workspace_id = sqlc.arg(workspace_id)
RETURNING id, workspace_id, creator_id, enabled, org_login, installation_id,
          branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at;

-- name: SetGitHubConnectionAccessToken :exec
UPDATE github_connection
SET access_token = sqlc.arg(access_token), connected_at = now()
WHERE workspace_id = sqlc.arg(workspace_id);

-- name: DeleteGitHubConnection :exec
DELETE FROM github_connection WHERE workspace_id = $1;

-- name: StreamGitHubConnectionsForBootstrap :many
SELECT id, workspace_id, creator_id, enabled, org_login, installation_id,
       branch_name_format, link_commits, linkbacks, connected_at, created_at, updated_at
FROM github_connection
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: CreateGitHubUserLink :one
INSERT INTO github_user_link (
  id, workspace_id, user_id, github_login, github_user_id
) VALUES (
  $1, $2, $3, $4, $5
)
RETURNING id, workspace_id, user_id, github_login, github_user_id, created_at, updated_at;

-- name: GetGitHubUserLink :one
SELECT id, workspace_id, user_id, github_login, github_user_id, created_at, updated_at
FROM github_user_link
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id);

-- name: GetGitHubUserLinkByLogin :one
SELECT id, workspace_id, user_id, github_login, github_user_id, created_at, updated_at
FROM github_user_link
WHERE workspace_id = sqlc.arg(workspace_id) AND lower(github_login) = lower(sqlc.arg(github_login));

-- name: UpdateGitHubUserLink :one
UPDATE github_user_link
SET github_login = sqlc.arg(github_login),
    github_user_id = sqlc.narg(github_user_id)
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
RETURNING id, workspace_id, user_id, github_login, github_user_id, created_at, updated_at;

-- name: DeleteGitHubUserLink :exec
DELETE FROM github_user_link
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id);

-- name: StreamGitHubUserLinksForBootstrap :many
SELECT id, workspace_id, user_id, github_login, github_user_id, created_at, updated_at
FROM github_user_link
WHERE workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);
