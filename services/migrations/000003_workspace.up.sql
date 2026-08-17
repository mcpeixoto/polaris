CREATE TABLE workspace (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  -- The URL segment: /<url_key>/issue/ENG-1. Lowercase, immutable in practice because
  -- changing it breaks every bookmark and every integration's stored links.
  url_key     text NOT NULL,
  logo_url    text,
  -- Feature toggles and workspace preferences. jsonb because these are read as a blob by
  -- the client and never filtered on in SQL.
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Plan is a cloud concern; self-host reads 'self_hosted' and the entitlement service
  -- resolves everything from the licence file instead. Kept here so one code path serves both.
  plan        text NOT NULL DEFAULT 'free',
  archived_at timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_url_key_format
    CHECK (url_key ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  CONSTRAINT workspace_plan_check
    CHECK (plan IN ('free', 'pro', 'enterprise', 'self_hosted'))
);

CREATE UNIQUE INDEX workspace_url_key_key ON workspace (url_key);

CREATE TRIGGER workspace_set_updated_at
  BEFORE UPDATE ON workspace
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The sync clock. One row per workspace, bumped inside every mutation transaction:
--
--   UPDATE workspace_version SET version = version + 1 WHERE workspace_id = $1 RETURNING version;
--
-- The row lock serialises writes per workspace. That is the point: it buys a gapless,
-- totally ordered version, so a client never has to reason about in-flight transactions
-- or ask "did I miss a row?". See docs/05-infrastructure/03-sync-engine.md.
CREATE TABLE workspace_version (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  version      bigint NOT NULL DEFAULT 0
);
