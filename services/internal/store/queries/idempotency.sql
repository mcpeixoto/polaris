-- ClaimIdempotencyKey is the first statement of every mutation.
--
-- ON CONFLICT DO NOTHING means a concurrent duplicate loses the race and returns no row;
-- the caller then reads the winner's stored result. This is what makes a client retry
-- after a dropped response safe: the write happens once, and both callers see the same
-- answer.
--
-- name: ClaimIdempotencyKey :execrows
INSERT INTO idempotency_key (client_id, op_id, workspace_id, request_hash, result, version, expires_at)
VALUES ($1, $2, $3, $4, '{}'::jsonb, NULL, $5)
ON CONFLICT (client_id, op_id) DO NOTHING;

-- name: GetIdempotencyKey :one
SELECT client_id, op_id, workspace_id, request_hash, result, version, expires_at, created_at
FROM idempotency_key
WHERE client_id = sqlc.arg(client_id) AND op_id = sqlc.arg(op_id) AND expires_at > now();

-- name: CompleteIdempotencyKey :exec
UPDATE idempotency_key
SET result = sqlc.arg(result), version = sqlc.narg(version)
WHERE client_id = sqlc.arg(client_id) AND op_id = sqlc.arg(op_id);

-- A mutation that fails must not leave a claimed key behind: the client's retry would
-- then read an empty result and believe the write succeeded.
--
-- name: ReleaseIdempotencyKey :exec
DELETE FROM idempotency_key
WHERE client_id = sqlc.arg(client_id) AND op_id = sqlc.arg(op_id);

-- name: DeleteExpiredIdempotencyKeys :execrows
DELETE FROM idempotency_key WHERE expires_at < now();
