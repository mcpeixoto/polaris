-- Workspace URL keys are no longer write-once. Settings can change the slug; the previous
-- value is kept as an alias so GetWorkspaceByURLKey (and anything that later puts the key
-- in a path) still finds the same workspace, and so nobody else can claim the old address.
--
-- 000003 called the column immutable in practice. That was true until there was a screen
-- to change it. The unique index on workspace.url_key still refuses two live keys; this
-- table extends the same uniqueness to retired keys.

CREATE TABLE workspace_url_alias (
  url_key      text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_url_alias_pkey PRIMARY KEY (url_key),
  CONSTRAINT workspace_url_alias_format
    CHECK (url_key ~ '^[a-z0-9][a-z0-9-]{1,47}$')
);

CREATE INDEX workspace_url_alias_workspace_idx ON workspace_url_alias (workspace_id);

-- A live url_key must not collide with somebody else's retired one, and an alias must not
-- collide with somebody else's live one. Two tables cannot share one unique index, so a
-- pair of BEFORE triggers raise the same named unique_violation the domain layer already
-- maps to "the address is already taken".

CREATE FUNCTION workspace_url_key_not_reserved() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workspace_url_alias a
    WHERE a.url_key = NEW.url_key
      AND a.workspace_id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'workspace_url_key_reserved'
      USING ERRCODE = '23505', CONSTRAINT = 'workspace_url_key_reserved';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_url_key_not_reserved_check
  BEFORE INSERT OR UPDATE OF url_key ON workspace
  FOR EACH ROW EXECUTE FUNCTION workspace_url_key_not_reserved();

CREATE FUNCTION workspace_url_alias_not_live() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workspace w
    WHERE w.url_key = NEW.url_key
      AND w.id IS DISTINCT FROM NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'workspace_url_key_reserved'
      USING ERRCODE = '23505', CONSTRAINT = 'workspace_url_key_reserved';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_url_alias_not_live_check
  BEFORE INSERT OR UPDATE OF url_key ON workspace_url_alias
  FOR EACH ROW EXECUTE FUNCTION workspace_url_alias_not_live();
