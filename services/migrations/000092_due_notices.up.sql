-- Memory of "this person has already been told about this deadline".
-- The unique key includes the due date, so moving the deadline is a new notice.

CREATE TABLE notification_due (
  user_id    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  issue_id   uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  due_date   date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, issue_id, kind, due_date),
  CONSTRAINT notification_due_kind_check CHECK (kind IN ('today', 'overdue'))
);

CREATE INDEX notification_due_issue_idx ON notification_due (issue_id, due_date);
