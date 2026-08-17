-- The inbox, and the subscriptions that decide who gets one.
--
-- Every query that touches a notification is scoped by user_id as well as by id. The id
-- alone would be enough to find the row; requiring the recipient too means a mistaken or
-- forged id can only ever act on the caller's own inbox, and the check cannot be forgotten
-- at a call site because it is not at a call site.

-- UpsertNotification is the fan-out's only write.
--
-- The conflict target is (user_id, group_key), which is what collapses a bulk edit of two
-- hundred issues into one inbox row carrying a count rather than two hundred rows. count
-- is bumped, and read_at is cleared so that new activity re-surfaces a notification the
-- user had already dismissed — that is the whole point of coalescing rather than
-- appending. updated_at is not set here; notification_set_updated_at does it, and setting
-- it twice would only invite the two to disagree.
--
-- snoozed_until is deliberately left alone. A snooze is the user saying "not now", and
-- more activity within the window is precisely the thing they asked not to be shown.
--
-- The WHERE on the DO UPDATE is what keeps the engine re-runnable. A worker that crashes
-- mid-batch restarts from the last committed cursor and re-processes versions it already
-- fanned out; without the guard, every replay would inflate count and un-read rows the
-- user had read. With it, a replay updates nothing and returns no row, so a caller that
-- gets pgx.ErrNoRows has learnt "already delivered" and emits no change.
--
-- name: UpsertNotification :one
INSERT INTO notification (id, workspace_id, user_id, type, issue_id, comment_id,
                          actor_type, actor_id, change_version, group_key, payload)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(type),
        sqlc.narg(issue_id), sqlc.narg(comment_id), sqlc.arg(actor_type),
        sqlc.narg(actor_id), sqlc.arg(change_version), sqlc.arg(group_key),
        sqlc.narg(payload))
ON CONFLICT (user_id, group_key) DO UPDATE
SET count          = notification.count + 1,
    change_version = EXCLUDED.change_version,
    payload        = COALESCE(EXCLUDED.payload, notification.payload),
    read_at        = NULL
WHERE EXCLUDED.change_version > notification.change_version
RETURNING id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
          change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
          created_at, updated_at;

-- name: GetNotification :one
SELECT id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
       change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
       created_at, updated_at
FROM notification
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND deleted_at IS NULL;

-- ListNotifications is the inbox. The two flags are passed rather than compiled into
-- separate queries so that "unread only" and "everything" cannot drift apart in what they
-- consider deleted or snoozed.
--
-- A snoozed row reappears on its own once snoozed_until passes, without anything having to
-- sweep the table: the predicate is a comparison against now(), not a stored flag.
--
-- name: ListNotifications :many
SELECT id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
       change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
       created_at, updated_at
FROM notification
WHERE user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND (sqlc.arg(include_read)::boolean OR read_at IS NULL)
  AND (sqlc.arg(include_snoozed)::boolean OR snoozed_until IS NULL OR snoozed_until <= now())
ORDER BY created_at DESC
LIMIT sqlc.arg(page_size);

-- CountUnreadNotifications is the badge, read on every page load. It must stay on
-- notification_unread_idx, which is why its predicate is that index's predicate verbatim.
--
-- name: CountUnreadNotifications :one
SELECT count(*) FROM notification
WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL AND snoozed_until IS NULL;

-- name: MarkNotificationRead :one
UPDATE notification
SET read_at = CASE WHEN sqlc.arg(read)::boolean THEN now() ELSE NULL END
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND deleted_at IS NULL
RETURNING id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
          change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
          created_at, updated_at;

-- One statement for the whole inbox, and one version block for the sync stream. Marking a
-- thousand rows read one at a time would mint a thousand versions and hold the workspace's
-- row lock for the duration of all of them.
--
-- name: MarkAllNotificationsRead :many
UPDATE notification SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL
RETURNING id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
          change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
          created_at, updated_at;

-- Snoozing also marks the row read. A notification you have chosen to defer is one you
-- have seen, and leaving it in the unread count would make the badge argue with the inbox.
--
-- name: SnoozeNotification :one
UPDATE notification
SET snoozed_until = sqlc.narg(snoozed_until),
    read_at       = COALESCE(read_at, now())
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND deleted_at IS NULL
RETURNING id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
          change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
          created_at, updated_at;

-- Soft, not a DELETE: the unique index on (user_id, group_key) is what makes the fan-out
-- idempotent, and removing the row would let a replayed version deliver the notification a
-- second time to somebody who had already dismissed it.
--
-- name: DeleteNotification :one
UPDATE notification SET deleted_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND deleted_at IS NULL
RETURNING id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
          change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
          created_at, updated_at;

-- ---------------------------------------------------------------------------------------
-- The engine's watermark.

-- Returns 0 for a workspace that has never been fanned out, which is the correct starting
-- version and saves every caller a not-found branch that would otherwise be the difference
-- between "start at the beginning" and "crash on first run".
--
-- name: GetNotificationCursor :one
SELECT coalesce((SELECT version FROM notification_cursor WHERE workspace_id = $1), 0)::bigint;

-- Advanced only after the batch's rows commit, so a crash re-processes rather than skips.
-- The guard makes the advance monotonic: two workers racing on one workspace can otherwise
-- rewind the watermark, and everything between the two positions is delivered twice.
--
-- name: AdvanceNotificationCursor :exec
INSERT INTO notification_cursor (workspace_id, version)
VALUES (sqlc.arg(workspace_id), sqlc.arg(version))
ON CONFLICT (workspace_id) DO UPDATE SET version = EXCLUDED.version
WHERE EXCLUDED.version > notification_cursor.version;

-- ---------------------------------------------------------------------------------------
-- Subscriptions.

-- EnsureIssueSubscription is the automatic path: commenting on or being assigned an issue
-- subscribes you to it.
--
-- It must never touch `unsubscribed`. Resetting it here is the single most commonly
-- rediscovered bug in notification systems: the user unsubscribes, the next comment
-- re-subscribes them, and the button appears to work for about four minutes. The no-op
-- update exists only so the existing row comes back, since the caller needs its id for the
-- change stream.
--
-- name: EnsureIssueSubscription :one
INSERT INTO issue_subscription (id, workspace_id, issue_id, user_id, reason)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(issue_id), sqlc.arg(user_id),
        sqlc.arg(reason))
ON CONFLICT (issue_id, user_id) DO UPDATE SET reason = issue_subscription.reason
RETURNING id, workspace_id, issue_id, user_id, reason, unsubscribed, created_at, updated_at;

-- SetIssueSubscription is the button. This is the one place `unsubscribed` may change,
-- because this is the one place the user said so.
--
-- name: SetIssueSubscription :one
INSERT INTO issue_subscription (id, workspace_id, issue_id, user_id, reason, unsubscribed)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(issue_id), sqlc.arg(user_id),
        'subscribed', sqlc.arg(unsubscribed))
ON CONFLICT (issue_id, user_id) DO UPDATE SET unsubscribed = EXCLUDED.unsubscribed
RETURNING id, workspace_id, issue_id, user_id, reason, unsubscribed, created_at, updated_at;

-- name: GetIssueSubscription :one
SELECT id, workspace_id, issue_id, user_id, reason, unsubscribed, created_at, updated_at
FROM issue_subscription
WHERE issue_id = sqlc.arg(issue_id) AND user_id = sqlc.arg(user_id);

-- ListIssueSubscribers is the fan-out's only read: who is watching this issue and still
-- wants to hear. Matches issue_subscription_issue_idx, which is partial on the same
-- predicate.
--
-- name: ListIssueSubscribers :many
SELECT id, workspace_id, issue_id, user_id, reason, unsubscribed, created_at, updated_at
FROM issue_subscription
WHERE issue_id = $1 AND unsubscribed = false
ORDER BY created_at;

-- name: ListIssueSubscriptionsForUser :many
SELECT id, workspace_id, issue_id, user_id, reason, unsubscribed, created_at, updated_at
FROM issue_subscription
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
ORDER BY id;
