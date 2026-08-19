-- Projects, workspace project statuses, teams, members and milestones.
--
-- A project is a unit of work with a clear outcome. It spans teams; its issues cannot
-- (each issue still belongs to exactly one team, and to at most one project). That last
-- clause is a column on issue, not a join table: two projects on one issue is a state
-- the schema cannot represent, which is the only way the product rule stays true when
-- the writer is an importer rather than the API.
--
-- Teams and members are rows with their own ids, for the same reason issue_label is.
-- A set written as a whole loses writes: two people adding different teams a second
-- apart both send the full new set and the second overwrites the first. As individual
-- rows an add is an upsert of one row and a remove is a delete of one, so both survive
-- with no merge logic anywhere.
--
-- Status is workspace-defined and always manual. Completing every issue in a project
-- does not move it — there is no trigger that would, and the schema test asserts that.

-- ---------------------------------------------------------------------------------------
-- Workspace-level project statuses.
--
-- Categories are fixed by the product (backlog / planned / started / completed /
-- canceled). `started` is what the UI calls In Progress; the identifier is the same
-- word the issue workflow already uses, so progress rollups and filters branch on one
-- vocabulary rather than two.

CREATE TABLE project_status (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text,
  color         text NOT NULL DEFAULT '#6b7280',
  category      text NOT NULL,
  position      text COLLATE "C" NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,

  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_status_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT project_status_category_check
    CHECK (category IN ('backlog', 'planned', 'started', 'completed', 'canceled')),
  -- A new project must not land in completed or canceled. Backlog or planned is the
  -- only honest default, matching workflow_state_default_category_check.
  CONSTRAINT project_status_default_category_check
    CHECK (NOT is_default OR category IN ('backlog', 'planned'))
);

CREATE UNIQUE INDEX project_status_workspace_name_key
  ON project_status (workspace_id, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX project_status_workspace_default_key
  ON project_status (workspace_id) WHERE is_default;
CREATE INDEX project_status_workspace_idx
  ON project_status (workspace_id, category, position);

CREATE TRIGGER project_status_set_updated_at
  BEFORE UPDATE ON project_status
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------

CREATE TABLE project (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  name          text NOT NULL,
  summary       text,
  description   text NOT NULL DEFAULT '',
  icon          text,
  color         text NOT NULL DEFAULT '#6b7280',

  status_id     uuid NOT NULL REFERENCES project_status(id) ON DELETE RESTRICT,
  -- 0 none, 1 urgent, 2 high, 3 medium, 4 low. The same scale as issues.
  priority      smallint NOT NULL DEFAULT 0,
  -- Exactly one lead. "More people involved" is members, not a second lead.
  lead_id       uuid REFERENCES "user"(id) ON DELETE SET NULL,
  creator_id    uuid REFERENCES "user"(id) ON DELETE SET NULL,

  sort_order    text COLLATE "C" NOT NULL,

  -- Timeframes are a calendar day plus how coarsely that day is meant. Stored as a
  -- date, never a timestamptz: "Q3 2026" is not an instant, and as one it would render
  -- as the previous quarter for everybody west of whoever set it.
  start_date               date,
  start_date_granularity   text,
  target_date              date,
  target_date_granularity  text,

  archived_at   timestamptz,
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT project_priority_check CHECK (priority BETWEEN 0 AND 4),
  CONSTRAINT project_start_granularity_check
    CHECK (
      (start_date IS NULL AND start_date_granularity IS NULL)
      OR (start_date IS NOT NULL AND start_date_granularity IN ('day', 'month', 'quarter', 'half', 'year'))
    ),
  CONSTRAINT project_target_granularity_check
    CHECK (
      (target_date IS NULL AND target_date_granularity IS NULL)
      OR (target_date IS NOT NULL AND target_date_granularity IN ('day', 'month', 'quarter', 'half', 'year'))
    )
);

CREATE INDEX project_workspace_idx ON project (workspace_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX project_status_idx ON project (status_id)
  WHERE deleted_at IS NULL;
CREATE INDEX project_lead_idx ON project (lead_id)
  WHERE lead_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX project_trash_idx ON project (workspace_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TRIGGER project_set_updated_at
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Teams on a project. One row per (project, team), with its own id, so concurrent adds
-- of different teams both survive.

CREATE TABLE project_team (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_team_key ON project_team (project_id, team_id);
CREATE INDEX project_team_team_idx ON project_team (team_id, project_id);
CREATE INDEX project_team_workspace_idx ON project_team (workspace_id);

-- ---------------------------------------------------------------------------------------
-- Members. Same shape, same reason.

CREATE TABLE project_member (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_member_key ON project_member (project_id, user_id);
CREATE INDEX project_member_user_idx ON project_member (user_id, project_id);
CREATE INDEX project_member_workspace_idx ON project_member (workspace_id);

-- ---------------------------------------------------------------------------------------
-- Milestones. Ordered checkpoints inside one project; they cannot be shared.

CREATE TABLE project_milestone (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text,
  -- A calendar day. Milestones do not carry timeframe granularity: "the beta" is a
  -- day or it is undated, not "sometime in Q3".
  target_date   date,
  sort_order    text COLLATE "C" NOT NULL,

  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_milestone_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX project_milestone_project_idx
  ON project_milestone (project_id, sort_order) WHERE archived_at IS NULL;

CREATE TRIGGER project_milestone_set_updated_at
  BEFORE UPDATE ON project_milestone
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- An issue belongs to at most one project, and a milestone only in that project.

ALTER TABLE issue
  ADD COLUMN project_id uuid REFERENCES project(id) ON DELETE SET NULL,
  ADD COLUMN project_milestone_id uuid REFERENCES project_milestone(id) ON DELETE SET NULL;

CREATE INDEX issue_project_idx ON issue (project_id, sort_order)
  WHERE project_id IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX issue_milestone_idx ON issue (project_milestone_id)
  WHERE project_milestone_id IS NOT NULL AND deleted_at IS NULL;

-- A milestone implies its project. Enforced here because a UI that checks and an
-- importer that does not would leave issues in a milestone of a project they are not
-- in, which is a state no filter can explain.
CREATE OR REPLACE FUNCTION issue_milestone_matches_project() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ms_project uuid;
BEGIN
  IF NEW.project_milestone_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'issue %: a milestone requires a project', NEW.id;
  END IF;

  SELECT project_id INTO ms_project FROM project_milestone WHERE id = NEW.project_milestone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue %: milestone % does not exist', NEW.id, NEW.project_milestone_id;
  END IF;
  IF ms_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'issue %: milestone % does not belong to project %',
      NEW.id, NEW.project_milestone_id, NEW.project_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_milestone_matches_project_check
  BEFORE INSERT OR UPDATE OF project_id, project_milestone_id ON issue
  FOR EACH ROW EXECUTE FUNCTION issue_milestone_matches_project();

-- ---------------------------------------------------------------------------------------
-- Existing workspaces need the same five statuses CreateWorkspace will seed for new ones.
-- Without this, a migrated install can create a project only after someone invents a
-- status by hand — which is a status nobody else has, in a category they guessed.

INSERT INTO project_status (id, workspace_id, name, color, category, position, is_default)
SELECT uuid_generate_v7(), w.id, d.name, d.color, d.category, d.position, d.is_default
FROM workspace w
CROSS JOIN (VALUES
  ('Backlog',      '#bec2c8', 'backlog',   'a0', true),
  ('Planned',      '#e2e2e2', 'planned',   'a1', false),
  ('In Progress',  '#f2c94c', 'started',   'a2', false),
  ('Completed',    '#5e6ad2', 'completed', 'a3', false),
  ('Canceled',     '#95a2b3', 'canceled',  'a4', false)
) AS d(name, color, category, position, is_default);
