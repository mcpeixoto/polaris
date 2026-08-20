-- Slack v1: one workspace connection. Outbound issue/comment notifications go to a
-- Slack incoming-webhook URL. Slash commands and link unfurls hit HTTP endpoints
-- verified with POLARIS_SLACK_SIGNING_SECRET; chat.unfurl uses POLARIS_SLACK_BOT_TOKEN.
--
-- The webhook URL is a credential. Listing and bootstrap queries never select it.
-- notify_cursor is worker state, not replica state.

CREATE TABLE slack_connection (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
  creator_id        uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  enabled           boolean NOT NULL DEFAULT true,
  default_team_id   uuid NOT NULL REFERENCES team(id) ON DELETE RESTRICT,
  channel_name      text,

  notify_issues     boolean NOT NULL DEFAULT true,
  notify_comments   boolean NOT NULL DEFAULT true,

  -- Slack incoming webhook (hooks.slack.com/services/…). Never on the replica.
  webhook_url       text,

  -- Last change_log version posted to Slack. Worker-only.
  notify_cursor     bigint NOT NULL DEFAULT 0,

  connected_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT slack_connection_channel_length CHECK (
    channel_name IS NULL OR char_length(channel_name) BETWEEN 1 AND 80
  ),
  CONSTRAINT slack_connection_webhook_not_blank CHECK (
    webhook_url IS NULL OR length(btrim(webhook_url)) > 0
  )
);

CREATE TRIGGER slack_connection_set_updated_at
  BEFORE UPDATE ON slack_connection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
