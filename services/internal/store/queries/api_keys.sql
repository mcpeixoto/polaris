-- token_hash appears in exactly one place below: the WHERE clause that authenticates a
-- request. It is in no RETURNING and no SELECT list, so it never reaches a Go struct that
-- could be logged, serialised into a payload, or returned by an API that grows a field
-- later. Nothing above the store has a use for it.

-- name: CreateAPIKey :one
INSERT INTO api_key (id, workspace_id, user_id, name, token_hash, prefix, scopes, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(name),
        sqlc.arg(token_hash), sqlc.arg(prefix), sqlc.arg(scopes), sqlc.narg(expires_at))
RETURNING id, workspace_id, user_id, name, prefix, scopes, last_used_at, expires_at,
          revoked_at, created_at, updated_at;

-- ListAPIKeysForUser is the listing, and it deliberately includes retired keys.
--
-- Revoked keys are not filtered out here, and that is the screen's promise rather than an
-- oversight: its caption says revoked and expired keys stay in the list so that a key which
-- stopped working can still be accounted for, and the client already sorts them to the
-- bottom and draws them with a Revoked badge. Hiding them made a key vanish the moment it
-- was retired, which is the opposite of what somebody auditing "when did this stop working"
-- needs — and left a person who had just revoked the wrong key with no evidence they had.
--
-- name: ListAPIKeysForUser :many
SELECT id, workspace_id, user_id, name, prefix, scopes, last_used_at, expires_at,
       revoked_at, created_at, updated_at
FROM api_key
WHERE user_id = $1
ORDER BY created_at DESC;

-- GetAPIKeyByTokenHash is the authentication path.
--
-- Revocation and expiry are filtered here rather than checked by the caller: a revoked key
-- has to be indistinguishable from a key that never existed, and a check that lives in Go
-- is a check some future second caller forgets. Both cases return no row, and both mean
-- 401 to the client, so nothing is lost by not being able to tell them apart.
--
-- name: GetAPIKeyByTokenHash :one
SELECT id, workspace_id, user_id, name, prefix, scopes, last_used_at, expires_at,
       revoked_at, created_at, updated_at
FROM api_key
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now());

-- TouchAPIKeyLastUsed rate-limits itself.
--
-- The point of last_used_at is answering "is this key still in use before I revoke it",
-- which a minute's resolution settles completely. Writing on every request would turn a
-- read-only API call into a row update, and put the busiest key's row in every checkpoint.
-- The predicate is here rather than in the auth middleware so the limit holds no matter
-- who calls it.
--
-- name: TouchAPIKeyLastUsed :exec
UPDATE api_key SET last_used_at = now()
WHERE id = $1
  AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

-- Scoped by user_id as well as id: a key acts as its owner, so only its owner may retire
-- it, and the rule is expressed where it cannot be skipped.
--
-- name: RevokeAPIKey :one
UPDATE api_key SET revoked_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND revoked_at IS NULL
RETURNING id, workspace_id, user_id, name, prefix, scopes, last_used_at, expires_at,
          revoked_at, created_at, updated_at;

-- Removing somebody from a workspace has to take their keys with them, or the account is
-- gone and the access path is not.
--
-- name: RevokeAPIKeysForUser :execrows
UPDATE api_key SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;
