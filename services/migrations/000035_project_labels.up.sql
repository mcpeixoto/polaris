-- Project labels — workspace taxonomy for projects, separate from issue labels.

CREATE TABLE project_label (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  parent_id     uuid REFERENCES project_label(id) ON DELETE SET NULL,
  is_group      boolean NOT NULL DEFAULT false,

  name          text NOT NULL,
  description   text,
  color         text NOT NULL DEFAULT '#6b7280',

  position      text COLLATE "C" NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT project_label_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT project_label_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT project_label_groups_do_not_nest CHECK (NOT (is_group AND parent_id IS NOT NULL))
);

CREATE UNIQUE INDEX project_label_name_key
  ON project_label (workspace_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX project_label_workspace_idx ON project_label (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX project_label_parent_idx ON project_label (parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER project_label_set_updated_at
  BEFORE UPDATE ON project_label
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION project_label_parent_integrity() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent project_label%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_group AND NOT NEW.is_group
     AND EXISTS (SELECT 1 FROM project_label WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'project_label %: still holds labels — empty the group before demoting it', NEW.id;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO parent FROM project_label WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_label %: parent % does not exist', NEW.id, NEW.parent_id;
  END IF;

  IF NOT parent.is_group THEN
    RAISE EXCEPTION 'project_label %: % is not a group', NEW.id, parent.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_label_parent_integrity_check
  BEFORE INSERT OR UPDATE OF parent_id, is_group ON project_label
  FOR EACH ROW EXECUTE FUNCTION project_label_parent_integrity();

-- Applying a project label to a project — one row per (project, label).

CREATE TABLE project_label_link (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  label_id      uuid NOT NULL REFERENCES project_label(id) ON DELETE CASCADE,

  group_id      uuid REFERENCES project_label(id) ON DELETE SET NULL,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_label_link_key ON project_label_link (project_id, label_id);

CREATE UNIQUE INDEX project_label_link_one_per_group
  ON project_label_link (project_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX project_label_link_label_idx ON project_label_link (label_id, project_id);
CREATE INDEX project_label_link_workspace_idx ON project_label_link (workspace_id);

CREATE OR REPLACE FUNCTION project_label_link_denormalise() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lbl project_label%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM project WHERE id = NEW.project_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'project_label_link: project % does not exist', NEW.project_id;
  END IF;

  SELECT * INTO lbl FROM project_label WHERE id = NEW.label_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_label_link: label % does not exist', NEW.label_id;
  END IF;

  IF lbl.is_group THEN
    RAISE EXCEPTION 'project_label_link: % is a group — apply one of its labels instead', lbl.id;
  END IF;

  NEW.group_id := lbl.parent_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_label_link_denormalise_write
  BEFORE INSERT OR UPDATE OF project_id, label_id ON project_label_link
  FOR EACH ROW EXECUTE FUNCTION project_label_link_denormalise();

CREATE OR REPLACE FUNCTION project_label_group_propagate() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE project_label_link SET group_id = NEW.parent_id WHERE label_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER project_label_group_propagate_update
  AFTER UPDATE OF parent_id ON project_label
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION project_label_group_propagate();
