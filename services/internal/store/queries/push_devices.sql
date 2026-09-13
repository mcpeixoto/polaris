-- Push device tokens. Not on the change stream — see migration 000089.

-- name: UpsertPushDevice :one
INSERT INTO push_device (id, user_id, workspace_id, token, platform, app_bundle, environment)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(workspace_id), sqlc.arg(token),
        sqlc.arg(platform), sqlc.arg(app_bundle), sqlc.arg(environment))
ON CONFLICT (token) DO UPDATE
SET user_id      = EXCLUDED.user_id,
    workspace_id = EXCLUDED.workspace_id,
    platform     = EXCLUDED.platform,
    app_bundle   = EXCLUDED.app_bundle,
    environment  = EXCLUDED.environment,
    last_seen_at = now()
RETURNING id, user_id, workspace_id, token, platform, app_bundle, environment,
          created_at, last_seen_at;

-- name: DeletePushDeviceByToken :execrows
DELETE FROM push_device
WHERE token = sqlc.arg(token) AND user_id = sqlc.arg(user_id);

-- name: DeletePushDeviceByID :execrows
DELETE FROM push_device WHERE id = sqlc.arg(id);

-- name: ListPushDevicesForUser :many
SELECT id, user_id, workspace_id, token, platform, app_bundle, environment,
       created_at, last_seen_at
FROM push_device
WHERE user_id = sqlc.arg(user_id)
ORDER BY last_seen_at DESC;

-- ListPushRecipients is one row per person who has both a registered device and at least
-- one unread, unpushed notification. Grouped in SQL for the same reason the email digest
-- list is: the alternative is walking every pending notification to discover who to talk
-- to.
--
-- name: ListPushRecipients :many
SELECT u.id AS user_id, u.workspace_id, u.display_name,
       count(n.id)::bigint AS pending
FROM notification n
JOIN "user" u ON u.id = n.user_id
WHERE n.pushed_at IS NULL
  AND n.read_at IS NULL
  AND n.deleted_at IS NULL
  AND (n.snoozed_until IS NULL OR n.snoozed_until <= now())
  AND u.archived_at IS NULL
  AND u.status = 'active'
  AND u.kind = 'human'
  AND EXISTS (SELECT 1 FROM push_device d WHERE d.user_id = u.id)
GROUP BY u.id
ORDER BY u.id
LIMIT sqlc.arg(page_size);

-- ClaimNotificationsForPush takes ownership of one person's pending notifications.
-- Same shape as ClaimNotificationsForEmail: one statement, at-most-once.
--
-- name: ClaimNotificationsForPush :many
WITH due AS (
  SELECT p.id FROM notification p
  WHERE p.user_id = sqlc.arg(user_id)
    AND p.pushed_at IS NULL
    AND p.read_at IS NULL
    AND p.deleted_at IS NULL
    AND (p.snoozed_until IS NULL OR p.snoozed_until <= now())
  ORDER BY p.created_at
  LIMIT sqlc.arg(page_size)
  FOR UPDATE
), claimed AS (
  UPDATE notification n SET pushed_at = now()
  FROM due
  WHERE n.id = due.id AND n.pushed_at IS NULL
  RETURNING n.id, n.type, n.issue_id, n.count, n.created_at, n.pushed_at, n.payload
)
SELECT c.id, c.type, c.issue_id, c.count, c.created_at, c.pushed_at, c.payload,
       coalesce(i.title, '')::text AS issue_title,
       coalesce(
         CASE WHEN i.number IS NOT NULL AND t.key IS NOT NULL
              THEN t.key || '-' || i.number::text
              ELSE NULL END,
         'an issue'
       )::text AS issue_identifier
FROM claimed c
LEFT JOIN issue i ON i.id = c.issue_id
LEFT JOIN team t ON t.id = i.team_id
ORDER BY c.created_at;

-- ReleasePushClaim puts rows back when every device refused the send.
--
-- name: ReleasePushClaim :execrows
UPDATE notification SET pushed_at = NULL
WHERE id = ANY(sqlc.arg(ids)::uuid[]) AND pushed_at = sqlc.arg(claimed_at);
