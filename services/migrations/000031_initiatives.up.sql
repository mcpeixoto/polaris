-- Initiatives group a manually curated set of projects around one objective.
--
-- Sub-initiatives, initiative labels and updates stay out of this slice — those are 5.14+
-- and 5.15. Status is a fixed product enum, not workspace-defined like project statuses.

CREATE TABLE initiative (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  -- proposed / planned / active / completed / canceled
  status        text NOT NULL DEFAULT 'planned',
  -- 0 none, 1 urgent, 2 high, 3 medium, 4 low — same scale as issues and projects.
  priority      smallint NOT NULL DEFAULT 0,
  owner_id      uuid REFERENCES "user"(id) ON DELETE SET NULL,
  -- When set to a private team, only that team's members can see the initiative.
  lead_team_id  uuid REFERENCES team(id) ON DELETE SET NULL,
  creator_id    uuid REFERENCES "user"(id) ON DELETE SET NULL,

  sort_order    text COLLATE "C" NOT NULL,

  target_date              date,
  target_date_granularity  text,

  archived_at   timestamptz,
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT initiative_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT initiative_priority_check CHECK (priority BETWEEN 0 AND 4),
  CONSTRAINT initiative_status_check
    CHECK (status IN ('proposed', 'planned', 'active', 'completed', 'canceled')),
  CONSTRAINT initiative_target_granularity_check
    CHECK (
      (target_date IS NULL AND target_date_granularity IS NULL)
      OR (target_date IS NOT NULL AND target_date_granularity IS NOT NULL)
    )
);

CREATE INDEX initiative_workspace_live_idx
  ON initiative (workspace_id, sort_order)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE TRIGGER initiative_set_updated_at
  BEFORE UPDATE ON initiative
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Curated project membership. Individual rows, not a set column — same rationale as
-- project_team and issue_label.
CREATE TABLE initiative_project (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  initiative_id uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT initiative_project_unique UNIQUE (initiative_id, project_id)
);

CREATE INDEX initiative_project_initiative_idx ON initiative_project (initiative_id);
CREATE INDEX initiative_project_project_idx ON initiative_project (project_id);
