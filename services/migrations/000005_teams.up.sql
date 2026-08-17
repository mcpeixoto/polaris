CREATE TABLE team (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- The identifier prefix: ENG in ENG-123. Uppercase, short, and changeable — which is
  -- why issue.identifier is NOT stored. See 000007.
  key            text NOT NULL,
  name           text NOT NULL,
  description    text,
  icon           text,
  color          text,
  timezone       text NOT NULL DEFAULT 'UTC',

  -- Hierarchy ships in M3 (max 5 levels). The column exists now so that adding sub-teams
  -- does not require rewriting every visibility query that already reads it.
  parent_team_id uuid REFERENCES team(id) ON DELETE RESTRICT,

  -- M0 has no private teams, but the sync engine's visibility predicate and revoke
  -- machinery are built against this column from day one — see the M0 acceptance tests.
  private        boolean NOT NULL DEFAULT false,

  -- Per-team issue counter, allocated under a row lock. Deliberately not a sequence:
  -- sequences are non-transactional, so a rolled-back create would burn a number and
  -- leave a visible hole in a value that users read aloud in standup.
  issue_counter  bigint NOT NULL DEFAULT 0,

  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Retired = read-only, hidden from the sidebar, history preserved.
  retired_at     timestamptz,
  archived_at    timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{0,7}$'),
  CONSTRAINT team_not_own_parent CHECK (parent_team_id IS NULL OR parent_team_id <> id)
);

CREATE UNIQUE INDEX team_workspace_key_key ON team (workspace_id, key) WHERE deleted_at IS NULL;
CREATE INDEX team_workspace_idx ON team (workspace_id) WHERE archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX team_parent_idx ON team (parent_team_id) WHERE parent_team_id IS NOT NULL;

CREATE TRIGGER team_set_updated_at
  BEFORE UPDATE ON team
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE team_membership (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_membership_role_check CHECK (role IN ('owner', 'member'))
);

CREATE UNIQUE INDEX team_membership_team_user_key ON team_membership (team_id, user_id);
-- Resolving a session's visibility set is "which teams is this user in?", run on every
-- connect and on every permission change. It must be an index-only scan.
CREATE INDEX team_membership_user_idx ON team_membership (user_id, team_id);
CREATE INDEX team_membership_workspace_idx ON team_membership (workspace_id);

CREATE TRIGGER team_membership_set_updated_at
  BEFORE UPDATE ON team_membership
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
