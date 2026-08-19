-- Outbound webhooks.
--
-- A webhook is a customer URL we POST signed change events to. It is not replicated: it is
-- a credential (the signing secret must be stored so we can sign) plus a push subscription,
-- read on one admin settings screen. Putting either in every device's replica would be an
-- exfiltration path dressed as sync.
--
-- Scope is XOR: all public teams, or one team. The residual risk Linear documents is real
-- here too — a team-scoped webhook on a private team will receive that team's issues — so
-- creating one is an admin action, and allPublicTeams never sees a private team's rows.

CREATE TABLE webhook (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  creator_id         uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  url                text NOT NULL,
  -- Shown once at create. Stored so deliveries can be signed; never selected by a listing.
  secret             text NOT NULL,

  enabled            boolean NOT NULL DEFAULT true,
  all_public_teams   boolean NOT NULL DEFAULT false,
  team_id            uuid REFERENCES team(id) ON DELETE CASCADE,
  resource_types     text[] NOT NULL,

  consecutive_failures integer NOT NULL DEFAULT 0,
  disabled_at        timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT webhook_url_not_blank CHECK (length(btrim(url)) > 0),
  CONSTRAINT webhook_url_http CHECK (url ~* '^https://'),
  CONSTRAINT webhook_secret_not_blank CHECK (length(secret) > 0),
  CONSTRAINT webhook_resource_types_not_empty CHECK (cardinality(resource_types) > 0),
  CONSTRAINT webhook_scope_xor CHECK (
    (all_public_teams AND team_id IS NULL) OR
    (NOT all_public_teams AND team_id IS NOT NULL)
  )
);

CREATE INDEX webhook_workspace_idx ON webhook (workspace_id) WHERE enabled = true;

CREATE TRIGGER webhook_set_updated_at
  BEFORE UPDATE ON webhook
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Where the fan-out has got to. Advanced only after a batch of delivery rows commits, so a
-- crash re-processes rather than skips. The unique index on webhook_delivery makes replay
-- free.
CREATE TABLE webhook_cursor (
  workspace_id  uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  version       bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER webhook_cursor_set_updated_at
  BEFORE UPDATE ON webhook_cursor
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per (webhook, change). The payload is the exact JSON that will be POSTed, stored
-- so a retry signs the same bytes. Retained 14 days so an admin can self-diagnose.
CREATE TABLE webhook_delivery (
  id               uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  webhook_id       uuid NOT NULL REFERENCES webhook(id) ON DELETE CASCADE,
  change_version   bigint NOT NULL,
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  op               text NOT NULL,
  payload          jsonb NOT NULL,
  attempt          integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_status      integer,
  last_error       text,
  last_duration_ms integer,
  last_snippet     text,
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT webhook_delivery_attempt_nonneg CHECK (attempt >= 0)
);

CREATE UNIQUE INDEX webhook_delivery_webhook_version_key
  ON webhook_delivery (webhook_id, change_version);

CREATE INDEX webhook_delivery_due_idx
  ON webhook_delivery (next_attempt_at)
  WHERE delivered_at IS NULL;

CREATE INDEX webhook_delivery_webhook_idx
  ON webhook_delivery (webhook_id, created_at DESC);
