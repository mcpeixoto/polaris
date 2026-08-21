-- Asks Slack: the existing workspace Slack install can file triage issues from
-- `/asks` and from a message that starts with 🎫. Off by default so a notify-only
-- Slack connection does not start creating intake issues.

ALTER TABLE slack_connection
  ADD COLUMN asks_enabled boolean NOT NULL DEFAULT false;
