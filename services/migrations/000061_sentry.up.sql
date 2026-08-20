-- Sentry v1: one cloud organization per workspace. Alert and issue webhooks create a
-- Polaris issue on the default public team and attach the Sentry URL (idempotent by URL).
--
-- The webhook secret stays in a column that listing and bootstrap queries never select.
-- The replicated payload is the settings a client needs to render "Sentry is connected"
-- and which team new issues land on — not a credential.

CREATE TABLE sentry_connection (
  id                   uuid PRIMARY KEY,
  workspace_id         uuid NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
  creator_id           uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  enabled              boolean NOT NULL DEFAULT true,
  default_team_id      uuid NOT NULL REFERENCES team(id) ON DELETE RESTRICT,
  organization_slug    text,

  -- Pasted into Sentry as a custom header (X-Sentry-Token) or used to verify
  -- Sentry-Hook-Signature HMAC. Never on the replica.
  webhook_secret       text NOT NULL,

  connected_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sentry_connection_slug_length CHECK (
    organization_slug IS NULL OR char_length(organization_slug) BETWEEN 1 AND 64
  ),
  CONSTRAINT sentry_connection_secret_not_blank CHECK (length(btrim(webhook_secret)) > 0)
);

CREATE TRIGGER sentry_connection_set_updated_at
  BEFORE UPDATE ON sentry_connection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
