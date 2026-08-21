-- OAuth applications and tokens.
--
-- Secret and token hashes appear only in WHERE clauses and INSERT values, never in a
-- SELECT list or RETURNING, for the same reason api_keys.sql keeps token_hash off the
-- row structs: a leaked listing, a log line, or a GraphQL field added later must not
-- become a working credential.

-- name: CreateOauthApplication :one
INSERT INTO oauth_application (
  id, workspace_id, creator_id, name, description, developer, developer_url, image_url,
  client_id, client_secret_hash, client_secret_prefix, redirect_uris, allowed_scopes,
  public_enabled, client_credentials_enabled, webhook_url
) VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(creator_id), sqlc.arg(name),
  sqlc.narg(description), sqlc.narg(developer), sqlc.narg(developer_url), sqlc.narg(image_url),
  sqlc.arg(client_id), sqlc.arg(client_secret_hash), sqlc.arg(client_secret_prefix),
  sqlc.arg(redirect_uris), sqlc.arg(allowed_scopes),
  sqlc.arg(public_enabled), sqlc.arg(client_credentials_enabled), sqlc.narg(webhook_url)
)
RETURNING id, workspace_id, creator_id, name, description, developer, developer_url, image_url,
          client_id, client_secret_prefix, redirect_uris, allowed_scopes,
          public_enabled, client_credentials_enabled, webhook_url,
          archived_at, created_at, updated_at;

-- name: ListOauthApplicationsForWorkspace :many
SELECT id, workspace_id, creator_id, name, description, developer, developer_url, image_url,
       client_id, client_secret_prefix, redirect_uris, allowed_scopes,
       public_enabled, client_credentials_enabled, webhook_url,
       archived_at, created_at, updated_at
FROM oauth_application
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY created_at DESC;

-- name: GetOauthApplication :one
SELECT id, workspace_id, creator_id, name, description, developer, developer_url, image_url,
       client_id, client_secret_prefix, redirect_uris, allowed_scopes,
       public_enabled, client_credentials_enabled, webhook_url,
       archived_at, created_at, updated_at
FROM oauth_application
WHERE id = $1 AND archived_at IS NULL;

-- name: GetOauthApplicationByClientID :one
SELECT id, workspace_id, creator_id, name, description, developer, developer_url, image_url,
       client_id, client_secret_prefix, redirect_uris, allowed_scopes,
       public_enabled, client_credentials_enabled, webhook_url,
       archived_at, created_at, updated_at
FROM oauth_application
WHERE client_id = $1 AND archived_at IS NULL;

-- name: GetOauthApplicationSecretHashByClientID :one
SELECT id, workspace_id, client_secret_hash, client_credentials_enabled, archived_at
FROM oauth_application
WHERE client_id = $1 AND archived_at IS NULL;

-- The domain loads the current row, applies the patch, and writes the whole mutable
-- set. Partial COALESCE on arrays and booleans cannot tell "leave it" from "set empty"
-- or "set false", and those are real updates on this screen.
--
-- name: UpdateOauthApplication :one
UPDATE oauth_application
SET name = sqlc.arg(name),
    description = sqlc.narg(description),
    developer = sqlc.narg(developer),
    developer_url = sqlc.narg(developer_url),
    image_url = sqlc.narg(image_url),
    redirect_uris = sqlc.arg(redirect_uris),
    allowed_scopes = sqlc.arg(allowed_scopes),
    public_enabled = sqlc.arg(public_enabled),
    client_credentials_enabled = sqlc.arg(client_credentials_enabled),
    webhook_url = sqlc.narg(webhook_url)
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id) AND archived_at IS NULL
RETURNING id, workspace_id, creator_id, name, description, developer, developer_url, image_url,
          client_id, client_secret_prefix, redirect_uris, allowed_scopes,
          public_enabled, client_credentials_enabled, webhook_url,
          archived_at, created_at, updated_at;

-- name: RotateOauthApplicationSecret :one
UPDATE oauth_application
SET client_secret_hash = sqlc.arg(client_secret_hash),
    client_secret_prefix = sqlc.arg(client_secret_prefix)
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id) AND archived_at IS NULL
RETURNING id, workspace_id, creator_id, name, description, developer, developer_url, image_url,
          client_id, client_secret_prefix, redirect_uris, allowed_scopes,
          public_enabled, client_credentials_enabled, webhook_url,
          archived_at, created_at, updated_at;

-- name: ArchiveOauthApplication :one
UPDATE oauth_application SET archived_at = now()
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id) AND archived_at IS NULL
RETURNING id;

-- name: CreateOauthAuthorizationCode :one
INSERT INTO oauth_authorization_code (
  id, application_id, workspace_id, user_id, actor_kind, code_hash, redirect_uri,
  scopes, code_challenge, code_challenge_method, team_ids, expires_at
) VALUES (
  sqlc.arg(id), sqlc.arg(application_id), sqlc.arg(workspace_id), sqlc.arg(user_id),
  sqlc.arg(actor_kind), sqlc.arg(code_hash), sqlc.arg(redirect_uri), sqlc.arg(scopes),
  sqlc.narg(code_challenge), sqlc.narg(code_challenge_method), sqlc.arg(team_ids),
  sqlc.arg(expires_at)
)
RETURNING id, application_id, workspace_id, user_id, actor_kind, redirect_uri, scopes,
          code_challenge, code_challenge_method, team_ids, expires_at, consumed_at, created_at;

-- name: GetOauthAuthorizationCodeByHash :one
SELECT id, application_id, workspace_id, user_id, actor_kind, redirect_uri, scopes,
       code_challenge, code_challenge_method, team_ids, expires_at, consumed_at, created_at
FROM oauth_authorization_code
WHERE code_hash = $1;

-- name: ConsumeOauthAuthorizationCode :one
UPDATE oauth_authorization_code SET consumed_at = now()
WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
RETURNING id, application_id, workspace_id, user_id, actor_kind, redirect_uri, scopes,
          code_challenge, code_challenge_method, team_ids, expires_at, consumed_at, created_at;

-- name: CreateOauthToken :one
INSERT INTO oauth_token (
  id, application_id, workspace_id, user_id, authorizing_user_id, grant_type,
  access_token_hash, refresh_token_hash, scopes, team_ids,
  access_expires_at, refresh_expires_at
) VALUES (
  sqlc.arg(id), sqlc.arg(application_id), sqlc.arg(workspace_id), sqlc.arg(user_id),
  sqlc.narg(authorizing_user_id), sqlc.arg(grant_type),
  sqlc.arg(access_token_hash), sqlc.narg(refresh_token_hash), sqlc.arg(scopes), sqlc.arg(team_ids),
  sqlc.arg(access_expires_at), sqlc.narg(refresh_expires_at)
)
RETURNING id, application_id, workspace_id, user_id, authorizing_user_id, grant_type,
          scopes, team_ids, access_expires_at, refresh_expires_at, revoked_at,
          last_used_at, created_at, updated_at;

-- name: GetOauthTokenByAccessHash :one
SELECT id, application_id, workspace_id, user_id, authorizing_user_id, grant_type,
       scopes, team_ids, access_expires_at, refresh_expires_at, revoked_at,
       last_used_at, created_at, updated_at
FROM oauth_token
WHERE access_token_hash = $1
  AND revoked_at IS NULL
  AND access_expires_at > now();

-- name: GetOauthTokenByRefreshHash :one
SELECT id, application_id, workspace_id, user_id, authorizing_user_id, grant_type,
       scopes, team_ids, access_expires_at, refresh_expires_at, revoked_at,
       last_used_at, replaced_by, refresh_replayable_until,
       successor_access_token, successor_refresh_token, created_at, updated_at
FROM oauth_token
WHERE refresh_token_hash = $1;

-- name: GetOauthToken :one
SELECT id, application_id, workspace_id, user_id, authorizing_user_id, grant_type,
       scopes, team_ids, access_expires_at, refresh_expires_at, revoked_at,
       last_used_at, replaced_by, refresh_replayable_until,
       successor_access_token, successor_refresh_token, created_at, updated_at
FROM oauth_token
WHERE id = $1;

-- name: MarkOauthRefreshRotated :exec
UPDATE oauth_token
SET replaced_by = sqlc.arg(replaced_by),
    refresh_replayable_until = sqlc.arg(refresh_replayable_until),
    successor_access_token = sqlc.arg(successor_access_token),
    successor_refresh_token = sqlc.arg(successor_refresh_token),
    revoked_at = now()
WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: RevokeOauthToken :one
UPDATE oauth_token SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL
RETURNING id;

-- name: RevokeOauthTokenByAccessHash :one
UPDATE oauth_token SET revoked_at = now()
WHERE access_token_hash = $1 AND revoked_at IS NULL
RETURNING id;

-- name: RevokeOauthTokenByRefreshHash :one
UPDATE oauth_token SET revoked_at = now()
WHERE refresh_token_hash = $1 AND revoked_at IS NULL
RETURNING id;

-- name: RevokeOauthTokensForApplication :execrows
UPDATE oauth_token SET revoked_at = now()
WHERE application_id = $1 AND revoked_at IS NULL;

-- Client-credentials tokens for this app that are still live. Used to enforce the
-- "same scopes, up to 1000; different scopes revoke the rest" rule.
-- name: ListLiveClientCredentialsTokens :many
SELECT id, scopes
FROM oauth_token
WHERE application_id = $1
  AND grant_type = 'client_credentials'
  AND revoked_at IS NULL
  AND access_expires_at > now();

-- name: RevokeClientCredentialsTokensForApplication :execrows
UPDATE oauth_token SET revoked_at = now()
WHERE application_id = $1
  AND grant_type = 'client_credentials'
  AND revoked_at IS NULL;

-- name: TouchOauthTokenLastUsed :exec
UPDATE oauth_token SET last_used_at = now()
WHERE id = $1
  AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

-- Live tokens this person granted in this workspace, excluding client-credentials
-- (those authenticate as the app, not as a member who authorised it). Hashes stay
-- off the SELECT list the same way they stay off every other listing: a settings
-- screen that could show a token would be a settings screen that could steal one.
--
-- name: ListLiveOauthTokensForUser :many
SELECT
  a.id AS application_id,
  a.name,
  a.client_id,
  a.image_url,
  a.developer,
  t.scopes,
  t.last_used_at,
  t.created_at
FROM oauth_token t
INNER JOIN oauth_application a ON a.id = t.application_id
WHERE t.workspace_id = sqlc.arg(workspace_id)
  AND t.revoked_at IS NULL
  AND t.grant_type <> 'client_credentials'
  AND (
    t.authorizing_user_id = sqlc.arg(user_id)
    OR (t.authorizing_user_id IS NULL AND t.user_id = sqlc.arg(user_id))
  )
  AND (
    t.access_expires_at > now()
    OR (t.refresh_expires_at IS NOT NULL AND t.refresh_expires_at > now())
  )
ORDER BY a.name, t.created_at DESC;

-- name: RevokeOauthTokensForUserApplication :execrows
UPDATE oauth_token SET revoked_at = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND application_id = sqlc.arg(application_id)
  AND revoked_at IS NULL
  AND grant_type <> 'client_credentials'
  AND (
    authorizing_user_id = sqlc.arg(user_id)
    OR (authorizing_user_id IS NULL AND user_id = sqlc.arg(user_id))
  );

-- name: GetOauthAppUser :one
SELECT application_id, workspace_id, user_id, created_at
FROM oauth_app_user
WHERE application_id = sqlc.arg(application_id) AND workspace_id = sqlc.arg(workspace_id);

-- name: CreateOauthAppUser :one
INSERT INTO oauth_app_user (application_id, workspace_id, user_id)
VALUES (sqlc.arg(application_id), sqlc.arg(workspace_id), sqlc.arg(user_id))
RETURNING application_id, workspace_id, user_id, created_at;

-- name: CountUsersWithDisplayName :one
SELECT count(*)::int AS n
FROM "user"
WHERE workspace_id = sqlc.arg(workspace_id)
  AND display_name = sqlc.arg(display_name)
  AND archived_at IS NULL;
