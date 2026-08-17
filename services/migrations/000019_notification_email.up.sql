-- Email delivery of notifications.
--
-- The inbox is where a notification lives; email is how it reaches somebody who is not
-- looking at the inbox. Everything the delivery job needs that the code cannot be trusted
-- to remember across a restart is here, because the whole difficulty of sending email is
-- that the send is not transactional: the relay has taken the message long before this
-- database hears about it, and there is no way to unsend one.
--
-- That asymmetry is the reason this file exists at all. The fan-out could choose to repeat
-- rather than to lose — a replayed inbox row folds into the one already there, by
-- (user_id, group_key), and costs nobody anything. Email has no such fold. A second copy
-- of this morning's digest is in the recipient's mailbox forever, and two of them is how a
-- product teaches people to filter it. So the choice here is the other one: at most once,
-- accepting that a process killed in the seconds between claiming a row and handing the
-- message to the relay loses that digest. What it does not lose is the news — every
-- notification in it is still in the inbox, still unread, which is the durable record.

-- ---------------------------------------------------------------------------------------
-- emailed_at: the claim.
--
-- This is the whole of the idempotency, and it is enforced by the database rather than by
-- the job. The delivery pass does not read rows and then mark them; it claims them in one
-- statement — UPDATE ... WHERE emailed_at IS NULL ... RETURNING — so the set it is about to
-- describe in an email is exactly the set it has just taken ownership of. A second pass, a
-- second worker, or the same worker restarted after a crash runs the identical statement
-- and matches nothing, because the predicate is on the row itself and the UPDATE took a row
-- lock to change it. There is no window in which two passes can both believe they own a
-- notification, and no counter anywhere that a restart could forget.
--
-- Nullable rather than a boolean plus a timestamp: "when" answers "whether", and the two as
-- separate columns is a state where they can disagree. It is also NULLable rather than
-- NOT NULL with a sentinel because the delivery job releases a claim when the relay refuses
-- the message — see the comment on notification_email_cursor — and NULL is the only value
-- that means "not yet", unambiguously, to a partial index.
--
-- No change_log row is emitted when this column moves, deliberately. emailed_at is a fact
-- about a delivery channel, not about the issue tracker: a client that received a delta for
-- it would be told about every row of every digest at 09:00 every morning, which is the
-- user's entire inbox re-broadcast to every device to communicate nothing they can see.
ALTER TABLE notification
  ADD COLUMN emailed_at timestamptz;

-- Everything already in an inbox predates email delivery, and is marked as delivered.
--
-- Left NULL, the first pass after this migration would mail every user their entire unread
-- backlog. On an install that has been running for a year that is one enormous message, and
-- it is the first thing anybody ever sees from this feature — the impression it makes is
-- "this thing spams you", earned in one send. Marking them delivered is also the honest
-- reading rather than a convenient one: they *were* delivered, to the inbox, at a time when
-- this column did not exist and no email was promised for them.
UPDATE notification SET emailed_at = now() WHERE emailed_at IS NULL;

-- The delivery job's only search: who has something waiting.
--
-- The predicate is the claim's predicate verbatim, so the index covers the query rather
-- than nearly covering it. Read notifications are excluded because a notification somebody
-- has already seen in the app is not news by email — the inbox is the faster channel and it
-- won; snoozed rows are excluded by the query rather than by the index, because "not now"
-- expires on its own and a partial index cannot be partial on now().
--
-- Once a row is emailed it leaves this index forever, which is what keeps the index small
-- on a table that only grows.
CREATE INDEX notification_pending_email_idx
  ON notification (user_id, created_at)
  WHERE emailed_at IS NULL AND read_at IS NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------
-- The per-user watermark.
--
-- emailed_at answers "has this row been sent". This answers the other question a cadence
-- needs: "when did this person last hear from us", which is what makes a daily digest daily
-- rather than one email per pass of the job.
--
-- It cannot be derived from max(emailed_at) over the notification table, or rather it can,
-- and doing so would mean an aggregate over every notification a person has ever received,
-- every hour, forever — to produce one timestamp that is written once per digest.
--
-- It is advanced *after* the message is accepted by the relay, in its own transaction, and
-- that ordering is chosen the same way the notification cursor's is. A process that dies
-- after sending and before advancing leaves this stale, so the next pass considers the user
-- due again — and finds nothing to send, because the rows are already claimed. The failure
-- corrects itself and costs one no-op. Advancing first would instead delay the next digest
-- by a whole cadence every time a send failed, which is the failure nobody notices.
--
-- No updated_at, unlike every other table here: last_sent_at is the only fact this row
-- records, and a second timestamp that must always equal it is a column that can only ever
-- disagree with it.
CREATE TABLE notification_email_cursor (
  user_id      uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL
);
