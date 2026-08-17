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
          created_at, updated_at, emailed_at;

-- name: GetNotification :one
SELECT id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
       change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
       created_at, updated_at, emailed_at
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
       created_at, updated_at, emailed_at
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
          created_at, updated_at, emailed_at;

-- One statement for the whole inbox, and one version block for the sync stream. Marking a
-- thousand rows read one at a time would mint a thousand versions and hold the workspace's
-- row lock for the duration of all of them.
--
-- name: MarkAllNotificationsRead :many
UPDATE notification SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL
RETURNING id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
          change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
          created_at, updated_at, emailed_at;

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
          created_at, updated_at, emailed_at;

-- Soft, not a DELETE: the unique index on (user_id, group_key) is what makes the fan-out
-- idempotent, and removing the row would let a replayed version deliver the notification a
-- second time to somebody who had already dismissed it.
--
-- name: DeleteNotification :one
UPDATE notification SET deleted_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND deleted_at IS NULL
RETURNING id, workspace_id, user_id, type, issue_id, comment_id, actor_type, actor_id,
          change_version, group_key, count, payload, read_at, snoozed_until, deleted_at,
          created_at, updated_at, emailed_at;

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
-- Email delivery.
--
-- Three statements, in the order the job runs them: find who has something waiting, claim
-- it, and record that the message went out. The claim is the interesting one — see
-- migration 000019 for why at-most-once is the right choice here and repeat-rather-than-lose
-- is the right one for the fan-out.

-- ListDigestRecipients is one row per person with unread, unsent notifications waiting.
--
-- Grouped in SQL rather than in Go because the alternative is reading every pending
-- notification in the install to bucket them by recipient, which is the whole table on the
-- morning after a busy day. What the job needs per person is a count, an address and enough
-- to decide whether they are due; the notifications themselves are read by the claim, one
-- recipient at a time, and only for the ones that turn out to be due.
--
-- The preferences bag comes back whole and is read in Go, the same way the fan-out reads it:
-- cadence lives in jsonb precisely so that adding a delivery channel is not a migration, and
-- a jsonb predicate for every cadence here would put half of that decision in SQL and half in
-- Go.
--
-- With one exception, which is about the page rather than about the preference. Somebody who
-- has switched email off keeps their pending notifications forever — they are never claimed,
-- because nothing is ever sent — so without this clause they hold a slot in every page of
-- every pass, and an install where five hundred people have switched email off would never
-- reach the five hundred and first person, who has not. The Go side still checks the cadence
-- and is still the authority on it; this excludes only the one value that means "never", and
-- only when per-notification email has not been asked for instead.
--
-- Who is excluded, and why. An archived or suspended person no longer works here and their
-- inbox is not their problem; an app user is an integration's identity and has no mailbox at
-- all — the FK to account is NULL for them, so the inner join drops them anyway, and the
-- explicit predicate says so rather than leaving it as a side effect somebody could "fix".
-- A deleted account is somebody who asked to be forgotten, and continuing to mail them is
-- the single most visible way to fail that request.
--
-- Not excluded: an unverified address. Nothing in the product sets email_verified_at yet —
-- there was no mail to verify with until this feature — so gating on it would make the
-- digest a feature that silently never sends. Every address reached here was typed into an
-- invitation by a workspace admin. Verification is the correct gate to add the day the
-- verification mail itself exists, and this comment is where the next person should look.
--
-- last_sent_at coalesces to epoch rather than coming back NULL: "never" and "long ago" are
-- the same answer to the only question asked of it, and a pointer here would be a nil check
-- at every call site that means nothing.
--
-- name: ListDigestRecipients :many
SELECT u.id AS user_id, u.workspace_id, u.display_name, u.notification_prefs,
       a.email AS email,
       w.name AS workspace_name,
       coalesce(c.last_sent_at, 'epoch'::timestamptz)::timestamptz AS last_sent_at,
       count(n.id)::bigint AS pending
FROM notification n
JOIN "user" u ON u.id = n.user_id
JOIN account a ON a.id = u.account_id
JOIN workspace w ON w.id = u.workspace_id
LEFT JOIN notification_email_cursor c ON c.user_id = u.id
WHERE n.emailed_at IS NULL
  AND n.read_at IS NULL
  AND n.deleted_at IS NULL
  AND (n.snoozed_until IS NULL OR n.snoozed_until <= now())
  AND u.archived_at IS NULL
  AND u.status = 'active'
  AND u.kind = 'human'
  AND a.deleted_at IS NULL
  -- Both sides are coalesced because an absent key is NULL, and NULL in a NOT (...) makes
  -- the whole row disappear: without the coalesce, somebody who has never opened the
  -- preferences screen is silently excluded from every digest the product ever sends.
  AND NOT (coalesce(u.notification_prefs->>'emailDigest', '') = 'off'
           AND coalesce(u.notification_prefs->>'emailPerNotification', '') <> 'true')
GROUP BY u.id, a.id, w.id, c.last_sent_at
ORDER BY u.id
LIMIT sqlc.arg(page_size);

-- ClaimNotificationsForEmail takes ownership of one person's pending notifications and
-- returns them with what the message has to say about each.
--
-- One statement, and that is the point: the rows it describes are the rows it has just
-- claimed. Reading first and marking afterwards would leave a window in which a second
-- worker, or the same worker after a restart, reads the same rows and sends the same digest
-- again — and an email, unlike an inbox row, cannot be folded into the one already there.
-- The inner SELECT ... FOR UPDATE takes the locks in created_at order and the UPDATE
-- re-checks emailed_at IS NULL under them, so a concurrent claim either waits and then
-- matches nothing or is the one that matched: there is no interleaving in which both
-- believe they own a row.
--
-- The limit is a page and not a nicety. Somebody returning from three weeks off has an inbox
-- of hundreds, and a digest that lists all of them is not read by anybody; the rest stay
-- unclaimed and are the next pass's digest, which is also the honest thing to do with news
-- that old.
--
-- The joins are LEFT and coalesced. A notification whose issue has been deleted still has to
-- be describable — the row is in somebody's inbox — and coalescing in SQL rather than
-- leaving it to sqlc's nullability inference is deliberate: it does not infer nullability
-- through an outer join, so an uncoalesced i.title would generate as a plain string and fail
-- at scan time, at runtime, on the one row nobody has in their test fixture.
--
-- name: ClaimNotificationsForEmail :many
WITH due AS (
  SELECT p.id FROM notification p
  WHERE p.user_id = sqlc.arg(user_id)
    AND p.emailed_at IS NULL
    AND p.read_at IS NULL
    AND p.deleted_at IS NULL
    AND (p.snoozed_until IS NULL OR p.snoozed_until <= now())
  ORDER BY p.created_at
  LIMIT sqlc.arg(page_size)
  FOR UPDATE
), claimed AS (
  UPDATE notification n SET emailed_at = now()
  FROM due
  WHERE n.id = due.id AND n.emailed_at IS NULL
  RETURNING n.id, n.type, n.issue_id, n.count, n.created_at, n.emailed_at
)
SELECT c.id, c.type, c.issue_id, c.count, c.created_at, c.emailed_at,
       coalesce(i.title, '')::text  AS issue_title,
       coalesce(i.number, 0)::bigint AS issue_number,
       coalesce(t.key, '')::text    AS team_key
FROM claimed c
LEFT JOIN issue i ON i.id = c.issue_id
LEFT JOIN team t ON t.id = i.team_id
ORDER BY c.created_at;

-- ReleaseNotificationEmailClaim puts rows back when the relay refused the message.
--
-- Claiming before sending is what makes a duplicate impossible; releasing on a refusal is
-- what keeps that from also making an outage permanent. Without it, a relay that is down for
-- an hour would silently swallow every digest due in that hour — the rows would be marked
-- sent and never appear in another one.
--
-- Guarded on the exact claim timestamp rather than on IS NOT NULL, so it can only ever undo
-- the claim this pass made. A blanket clear would be a statement capable of resurrecting
-- somebody else's delivery, sitting in the error path where it is least likely to be tested.
--
-- name: ReleaseNotificationEmailClaim :execrows
UPDATE notification SET emailed_at = NULL
WHERE id = ANY(sqlc.arg(ids)::uuid[]) AND emailed_at = sqlc.arg(claimed_at);

-- AdvanceNotificationEmailCursor records that a digest reached the relay.
--
-- Written after the send and not before, so the cost of a crash is a pass that finds nothing
-- to do rather than a person who hears nothing for a day. The guard makes it monotonic for
-- the same reason AdvanceNotificationCursor's does: two workers racing must not be able to
-- move a watermark backwards.
--
-- name: AdvanceNotificationEmailCursor :exec
INSERT INTO notification_email_cursor (user_id, last_sent_at)
VALUES (sqlc.arg(user_id), sqlc.arg(sent_at))
ON CONFLICT (user_id) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
WHERE EXCLUDED.last_sent_at > notification_email_cursor.last_sent_at;

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
