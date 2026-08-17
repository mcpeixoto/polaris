-- Saved views, favourites, per-view display preferences and issue templates.

-- ---------------------------------------------------------------------------------------
-- A saved view is a named filter plus how to display it.
--
-- `filter` holds the filter AST exactly as the one compiler consumes it — the same bytes
-- the client evaluates against its replica and the server compiles to SQL for search. It
-- is jsonb rather than a normalised tree of clause rows because it is always read whole,
-- never queried into, and a normalised version would need a join per clause to answer a
-- question nobody asks.

CREATE TABLE view (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- NULL means the view spans the workspace. A team id anchors it to one team's sidebar.
  team_id       uuid REFERENCES team(id) ON DELETE CASCADE,

  -- NULL means shared: everyone who can see the scope can see the view. Set means it is
  -- that person's private view and its change rows carry ScopeUser.
  owner_id      uuid REFERENCES "user"(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text,
  icon          text,
  color         text,

  filter        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Grouping, ordering, layout and which properties are shown.
  display       jsonb NOT NULL DEFAULT '{}'::jsonb,

  position      text COLLATE "C" NOT NULL,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT view_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX view_workspace_idx ON view (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX view_team_idx ON view (team_id) WHERE team_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX view_owner_idx ON view (owner_id) WHERE owner_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER view_set_updated_at
  BEFORE UPDATE ON view
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Favourites: the user's own sidebar, in their own order.

CREATE TABLE favorite (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Deliberately not a foreign key to one table: a favourite can point at a view, a team,
  -- an issue or a label, and four nullable columns with a check that exactly one is set is
  -- the same thing with more ceremony. The domain layer resolves the target; a dangling
  -- favourite renders as nothing and is cleaned up on read.
  kind          text NOT NULL,
  target_id     uuid NOT NULL,

  position      text COLLATE "C" NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT favorite_kind_check CHECK (kind IN ('view', 'team', 'issue', 'label'))
);

CREATE UNIQUE INDEX favorite_key ON favorite (user_id, kind, target_id);
CREATE INDEX favorite_user_idx ON favorite (user_id, position);

CREATE TRIGGER favorite_set_updated_at
  BEFORE UPDATE ON favorite
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Display preferences for the views that are not saved views.
--
-- "Team issues", "My issues" and the rest are built in and have no row of their own, but
-- the grouping and ordering you chose for them still has to follow you to your laptop.
-- localStorage would not; this does.

CREATE TABLE view_preference (
  -- The natural key is (user_id, view_key), but every entity on the sync stream is
  -- addressed by a uuid, so this carries one too. A composite key here would mean the
  -- change stream needs a second way to name an entity — which is a change to the
  -- protocol in order to avoid one column.
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- A stable key for the built-in view, e.g. 'team:<uuid>' or 'my-issues'.
  view_key      text NOT NULL,
  display       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX view_preference_key ON view_preference (user_id, view_key);

CREATE TRIGGER view_preference_set_updated_at
  BEFORE UPDATE ON view_preference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Issue templates.

CREATE TABLE issue_template (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- NULL means the template is offered in every team.
  team_id       uuid REFERENCES team(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text,

  -- The issue this template makes. Title and body are separate columns because they are
  -- the two fields a human edits in the template editor; everything else is a property
  -- bag whose keys are the same names the create mutation takes.
  title         text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,

  position      text COLLATE "C" NOT NULL,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT issue_template_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX issue_template_workspace_idx ON issue_template (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX issue_template_team_idx ON issue_template (team_id)
  WHERE team_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER issue_template_set_updated_at
  BEFORE UPDATE ON issue_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Issues remember the template that made them. Not for display: for the question "is this
-- template still worth having", which nobody can answer without it.
ALTER TABLE issue
  ADD COLUMN template_id uuid REFERENCES issue_template(id) ON DELETE SET NULL;
