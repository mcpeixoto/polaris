-- Due-date notices and Web Push subscriptions.
--
-- A due date arriving is not a change anybody made, so it never reaches the fan-out.
-- notification_due is the memory of "this person has already been told about this deadline",
-- which is what makes the sweep say it once. The unique key includes the due date, so moving
-- the deadline is a new deadline and they hear about that one too.
--
-- push_subscription is a credential for one browser, not an entity the workspace shares.
-- It is deliberately absent from the change stream: a replica that carried it would copy a
-- device's push keys onto every other device that person signs in on, and those keys are
-- enough to send a notification as them.

CREATE TABLE notification_due (
  user_id    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  issue_id   uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  due_date   date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, issue_id, kind, due_date),

  CONSTRAINT notification_due_kind_check CHECK (kind IN ('today', 'overdue'))
);

-- The sweep's "have we already said this" lookup is by issue, not by the recipient the
-- primary key leads with.
CREATE INDEX notification_due_issue_idx ON notification_due (issue_id, due_date);

CREATE TABLE push_subscription (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT push_subscription_endpoint_key UNIQUE (endpoint)
);

CREATE INDEX push_subscription_user_idx ON push_subscription (user_id);

-- Which inbox rows have already been handed to a push service.
--
-- A side table rather than a column on notification, because email's emailed_at had to be
-- on the row the claim updates and this does not: most people never register a phone, and a
-- nullable column plus a partial index of "not yet pushed" would grow with every
-- notification in the install forever. A row here exists only after a send was attempted.
CREATE TABLE notification_push (
  notification_id uuid PRIMARY KEY REFERENCES notification(id) ON DELETE CASCADE,
  pushed_at       timestamptz NOT NULL
);
