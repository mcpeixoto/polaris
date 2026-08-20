-- Email-to-issue: a per-team (and per-template) intake address that turns inbound mail
-- into issues.
--
-- Linear's product is a unique forwarding address per team, plus an optional address per
-- team template. Polaris does not run an SMTP server: an HTTP webhook (JSON in development,
-- the same shape a mail provider would POST) is the intake. The token is the local-part
-- of that address; the host is derived from POLARIS_PUBLIC_URL at enable time so a
-- replica can show a copyable address without knowing the install's hostname.
--
-- Token and address are server-private columns. The replica only sees the enabled flag
-- and the address, because that is what the settings screen copies. Replies are ignored
-- (they must not mint a second issue); message-id is how a retried POST stays one issue.

ALTER TABLE team
  ADD COLUMN email_intake_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN email_intake_token text,
  ADD COLUMN email_intake_address text;

CREATE UNIQUE INDEX team_email_intake_token_key
  ON team (email_intake_token)
  WHERE email_intake_token IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE issue_template
  ADD COLUMN email_intake_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN email_intake_token text,
  ADD COLUMN email_intake_address text;

CREATE UNIQUE INDEX issue_template_email_intake_token_key
  ON issue_template (email_intake_token)
  WHERE email_intake_token IS NOT NULL AND archived_at IS NULL;

CREATE TABLE inbound_email (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id      uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  message_id    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inbound_email_message_key
  ON inbound_email (workspace_id, message_id);
