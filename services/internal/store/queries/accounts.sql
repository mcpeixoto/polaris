-- name: CreateAccount :one
INSERT INTO account (id, email, password_hash, email_verified_at)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, email_verified_at, deleted_at, last_login_at, created_at, updated_at;

-- name: GetAccountByEmail :one
SELECT id, email, password_hash, email_verified_at, deleted_at, last_login_at, created_at, updated_at
FROM account
WHERE lower(email) = lower(sqlc.arg(email)::text) AND deleted_at IS NULL;

-- name: GetAccount :one
SELECT id, email, password_hash, email_verified_at, deleted_at, last_login_at, created_at, updated_at
FROM account
WHERE id = $1 AND deleted_at IS NULL;

-- name: SetAccountPassword :exec
UPDATE account SET password_hash = sqlc.arg(password_hash)
WHERE id = sqlc.arg(id);

-- name: MarkAccountLogin :exec
UPDATE account SET last_login_at = now() WHERE id = $1;

-- name: VerifyAccountEmail :exec
UPDATE account SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL;

-- name: CreateSession :one
INSERT INTO account_session (id, account_id, token_hash, user_agent, ip, country, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, account_id, token_hash, user_agent, ip, country, expires_at, revoked_at, last_seen_at, created_at, updated_at;

-- name: GetSessionByTokenHash :one
SELECT id, account_id, token_hash, user_agent, ip, country, expires_at, revoked_at, last_seen_at, created_at, updated_at
FROM account_session
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: TouchSession :exec
UPDATE account_session SET last_seen_at = now() WHERE id = $1;

-- RotateSessionToken swaps a session's refresh token without changing which session it is.
--
-- Rotation used to be a revoke and an insert, which made a session a different row every
-- fifteen minutes. That is what broke the Sessions screen: the id it drew a Revoke button
-- for stopped existing the moment the device it named refreshed, so pressing Revoke on any
-- live device answered "session not found" and left it signed in — the one flow the screen
-- exists for. Updating in place keeps the id stable for the life of the login, which is what
-- lets somebody point at a device and kill it.
--
-- The security property is unchanged: the old token's digest is overwritten, so replaying it
-- finds no row and is 401, exactly as revoking it was. created_at survives, so the "Signed
-- in" column finally shows when the person actually signed in rather than when their browser
-- last refreshed; user_agent, ip and country survive for the same reason.
--
-- name: RotateSessionToken :one
UPDATE account_session
SET token_hash = sqlc.arg(token_hash),
    expires_at = sqlc.arg(expires_at),
    last_seen_at = now()
WHERE id = sqlc.arg(id) AND revoked_at IS NULL
RETURNING id, account_id, token_hash, user_agent, ip, country, expires_at, revoked_at, last_seen_at, created_at, updated_at;

-- name: RevokeSession :exec
UPDATE account_session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllSessionsForAccount :exec
UPDATE account_session SET revoked_at = now()
WHERE account_id = $1 AND revoked_at IS NULL;

-- Scoped to the owner so a foreign id answers like an invented one: not-found, never
-- forbidden. Distinguishing those would let somebody confirm a colleague's session exists.
--
-- name: RevokeSessionForAccount :execrows
UPDATE account_session SET revoked_at = now()
WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL;

-- name: RevokeOtherSessionsForAccount :execrows
UPDATE account_session SET revoked_at = now()
WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL;

-- name: ListSessionsForAccount :many
SELECT id, account_id, token_hash, user_agent, ip, country, expires_at, revoked_at, last_seen_at, created_at, updated_at
FROM account_session
WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()
ORDER BY last_seen_at DESC;

-- name: DeleteExpiredSessions :execrows
DELETE FROM account_session
WHERE expires_at < now() - interval '30 days';
