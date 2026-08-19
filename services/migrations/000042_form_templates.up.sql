-- Structured intake templates (form templates) and their fields.

CREATE TABLE form_template (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id       uuid REFERENCES team(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text,

  -- Default issue properties not captured by a field (assignee, labels, status, etc.).
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,

  position      text COLLATE "C" NOT NULL,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT form_template_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX form_template_workspace_idx ON form_template (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX form_template_team_idx ON form_template (team_id)
  WHERE team_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER form_template_set_updated_at
  BEFORE UPDATE ON form_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE form_template_field (
  id               uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  form_template_id uuid NOT NULL REFERENCES form_template(id) ON DELETE CASCADE,

  field_type       text NOT NULL,
  label            text NOT NULL,
  description      text,
  required         boolean NOT NULL DEFAULT false,
  sort_order       text COLLATE "C" NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT form_template_field_label_not_blank CHECK (length(btrim(label)) > 0),
  CONSTRAINT form_template_field_type_check CHECK (field_type IN (
    'text', 'long_text', 'dropdown', 'checkboxes', 'date', 'file_upload', 'instructions',
    'label_group', 'priority', 'title', 'due_date'
  ))
);

CREATE INDEX form_template_field_template_idx ON form_template_field (form_template_id);

CREATE TRIGGER form_template_field_set_updated_at
  BEFORE UPDATE ON form_template_field
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Provenance for reporting — parallel to issue.template_id for standard templates.
ALTER TABLE issue
  ADD COLUMN form_template_id uuid REFERENCES form_template(id) ON DELETE SET NULL;

CREATE INDEX issue_form_template_idx ON issue (form_template_id)
  WHERE form_template_id IS NOT NULL AND deleted_at IS NULL;
