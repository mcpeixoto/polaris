-- Project templates — prefilled projects with milestones and starter issues.

CREATE TABLE project_template (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id       uuid REFERENCES team(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text,

  -- What the project this template makes starts with.
  summary       text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,

  position      text COLLATE "C" NOT NULL,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT project_template_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX project_template_workspace_idx ON project_template (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX project_template_team_idx ON project_template (team_id)
  WHERE team_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER project_template_set_updated_at
  BEFORE UPDATE ON project_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE project_template_milestone (
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_template_id uuid NOT NULL REFERENCES project_template(id) ON DELETE CASCADE,

  name                text NOT NULL,
  description         text,
  target_date         date,
  sort_order          text COLLATE "C" NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_template_milestone_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX project_template_milestone_template_idx ON project_template_milestone (project_template_id);

CREATE TRIGGER project_template_milestone_set_updated_at
  BEFORE UPDATE ON project_template_milestone
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE project_template_issue (
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_template_id uuid NOT NULL REFERENCES project_template(id) ON DELETE CASCADE,
  parent_id           uuid REFERENCES project_template_issue(id) ON DELETE CASCADE,

  title               text NOT NULL DEFAULT '',
  description         text NOT NULL DEFAULT '',
  properties          jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order          text COLLATE "C" NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_template_issue_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE INDEX project_template_issue_template_idx ON project_template_issue (project_template_id);
CREATE INDEX project_template_issue_parent_idx ON project_template_issue (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE TRIGGER project_template_issue_set_updated_at
  BEFORE UPDATE ON project_template_issue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE project
  ADD COLUMN project_template_id uuid REFERENCES project_template(id) ON DELETE SET NULL;

CREATE INDEX project_project_template_idx ON project (project_template_id)
  WHERE project_template_id IS NOT NULL AND deleted_at IS NULL;
