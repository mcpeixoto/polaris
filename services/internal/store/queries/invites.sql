-- name: CreateInvite :one
INSERT INTO invite (id, workspace_id, email, role, token_hash, invited_by, team_ids, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, workspace_id, email, role, token_hash, invited_by, team_ids,
          accepted_at, accepted_by, revoked_at, expires_at, created_at, updated_at;

-- name: GetInviteByTokenHash :one
SELECT id, workspace_id, email, role, token_hash, invited_by, team_ids,
       accepted_at, accepted_by, revoked_at, expires_at, created_at, updated_at
FROM invite
WHERE token_hash = $1
  AND accepted_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > now();

-- name: ListPendingInvites :many
SELECT id, workspace_id, email, role, token_hash, invited_by, team_ids,
       accepted_at, accepted_by, revoked_at, expires_at, created_at, updated_at
FROM invite
WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
ORDER BY created_at DESC;

-- name: AcceptInvite :exec
UPDATE invite SET accepted_at = now(), accepted_by = sqlc.arg(accepted_by)
WHERE id = sqlc.arg(id) AND accepted_at IS NULL;

-- RevokeInvite is scoped to the workspace, and reports whether anything was revoked.
--
-- Without the workspace_id an admin could cancel an invitation belonging to a workspace they
-- have nothing to do with, by id alone. Without the RETURNING the caller cannot tell a
-- revoked invitation from one that never existed and would answer success either way. An id
-- from another workspace and an invented id both return no row, so neither confirms that an
-- invitation exists somewhere the caller cannot see.
--
-- An already-accepted invitation is deliberately not revocable: that person is a member now,
-- and revoking it would suggest their access had been taken away when it has not.
--
-- name: RevokeInvite :one
UPDATE invite SET revoked_at = now()
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)
  AND revoked_at IS NULL AND accepted_at IS NULL
RETURNING id;

-- Re-inviting an address replaces the outstanding invite rather than accumulating rows,
-- which is also what invite_workspace_email_pending_key enforces.
--
-- name: RevokePendingInvitesForEmail :exec
UPDATE invite SET revoked_at = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND lower(email) = lower(sqlc.arg(email)::text)
  AND accepted_at IS NULL AND revoked_at IS NULL;
