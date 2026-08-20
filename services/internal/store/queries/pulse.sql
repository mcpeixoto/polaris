-- Pulse digest worker. The feed itself is replica-derived; this file is the
-- scheduled inbox summary and the cursor that keeps a restart from sending twice.

-- name: ListPulseDigestWorkspaces :many
SELECT id, pulse_digest_cadence
FROM workspace
WHERE deleted_at IS NULL
  AND archived_at IS NULL
  AND pulse_enabled
  AND pulse_digest_cadence <> 'off';

-- name: ListPulseDigestUsers :many
SELECT id, timezone, notification_prefs
FROM "user"
WHERE workspace_id = $1
  AND archived_at IS NULL
  AND status = 'active'
  AND kind = 'human'
  AND role <> 'guest';

-- name: GetPulseDigestCursor :one
SELECT last_sent_at
FROM pulse_digest_cursor
WHERE workspace_id = $1 AND user_id = $2;

-- name: UpsertPulseDigestCursor :exec
INSERT INTO pulse_digest_cursor (workspace_id, user_id, last_sent_at)
VALUES ($1, $2, $3)
ON CONFLICT (workspace_id, user_id) DO UPDATE
SET last_sent_at = EXCLUDED.last_sent_at;

-- CountPulseForMeUpdatesSince is the Pulse "For me" predicate: lead, creator, or member.
--
-- name: CountPulseForMeUpdatesSince :one
SELECT count(*)::bigint
FROM project_update pu
JOIN project p ON p.id = pu.project_id
WHERE pu.workspace_id = sqlc.arg(workspace_id)
  AND pu.deleted_at IS NULL
  AND p.deleted_at IS NULL
  AND p.archived_at IS NULL
  AND pu.created_at > sqlc.arg(since)
  AND (
    p.lead_id = sqlc.arg(user_id)
    OR p.creator_id = sqlc.arg(user_id)
    OR EXISTS (
      SELECT 1 FROM project_member pm
      WHERE pm.project_id = p.id AND pm.user_id = sqlc.arg(user_id)
    )
  );
