-- Initiative labels (workspace taxonomy, same group semantics as project labels) and
-- sub-initiative relations (a DAG: multiple parents, at most five levels).
--
-- Labels stay out of the initiative row itself — one application per row, so two people
-- labelling the same initiative differently both survive. Nesting is a join table rather
-- than parent_id because an initiative can ladder into more than one parent.

CREATE TABLE initiative_label (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  parent_id     uuid REFERENCES initiative_label(id) ON DELETE SET NULL,
  is_group      boolean NOT NULL DEFAULT false,

  name          text NOT NULL,
  description   text,
  color         text NOT NULL DEFAULT '#6b7280',

  position      text COLLATE "C" NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT initiative_label_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT initiative_label_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT initiative_label_groups_do_not_nest CHECK (NOT (is_group AND parent_id IS NOT NULL))
);

CREATE UNIQUE INDEX initiative_label_name_key
  ON initiative_label (workspace_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX initiative_label_workspace_idx ON initiative_label (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX initiative_label_parent_idx ON initiative_label (parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER initiative_label_set_updated_at
  BEFORE UPDATE ON initiative_label
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION initiative_label_parent_integrity() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent initiative_label%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_group AND NOT NEW.is_group
     AND EXISTS (SELECT 1 FROM initiative_label WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'initiative_label %: still holds labels — empty the group before demoting it', NEW.id;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO parent FROM initiative_label WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'initiative_label %: parent % does not exist', NEW.id, NEW.parent_id;
  END IF;

  IF NOT parent.is_group THEN
    RAISE EXCEPTION 'initiative_label %: % is not a group', NEW.id, parent.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_label_parent_integrity_check
  BEFORE INSERT OR UPDATE OF parent_id, is_group ON initiative_label
  FOR EACH ROW EXECUTE FUNCTION initiative_label_parent_integrity();

CREATE TABLE initiative_label_link (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  initiative_id uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,
  label_id      uuid NOT NULL REFERENCES initiative_label(id) ON DELETE CASCADE,

  group_id      uuid REFERENCES initiative_label(id) ON DELETE SET NULL,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX initiative_label_link_key ON initiative_label_link (initiative_id, label_id);

CREATE UNIQUE INDEX initiative_label_link_one_per_group
  ON initiative_label_link (initiative_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX initiative_label_link_label_idx ON initiative_label_link (label_id, initiative_id);
CREATE INDEX initiative_label_link_workspace_idx ON initiative_label_link (workspace_id);

CREATE OR REPLACE FUNCTION initiative_label_link_denormalise() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lbl initiative_label%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM initiative WHERE id = NEW.initiative_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'initiative_label_link: initiative % does not exist', NEW.initiative_id;
  END IF;

  SELECT * INTO lbl FROM initiative_label WHERE id = NEW.label_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'initiative_label_link: label % does not exist', NEW.label_id;
  END IF;

  IF lbl.is_group THEN
    RAISE EXCEPTION 'initiative_label_link: % is a group — apply one of its labels instead', lbl.id;
  END IF;

  NEW.group_id := lbl.parent_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_label_link_denormalise_write
  BEFORE INSERT OR UPDATE OF initiative_id, label_id ON initiative_label_link
  FOR EACH ROW EXECUTE FUNCTION initiative_label_link_denormalise();

CREATE OR REPLACE FUNCTION initiative_label_group_propagate() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE initiative_label_link SET group_id = NEW.parent_id WHERE label_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER initiative_label_group_propagate_update
  AFTER UPDATE OF parent_id ON initiative_label
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION initiative_label_group_propagate();

-- Parent → child. Multiple parents are allowed; cycles and a chain longer than five
-- initiatives are refused in the domain layer (a CHECK cannot walk the graph).
CREATE TABLE initiative_relation (
  id                     uuid PRIMARY KEY,
  workspace_id           uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  parent_initiative_id   uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,
  child_initiative_id    uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,
  sort_order             text COLLATE "C" NOT NULL,
  created_by             uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT initiative_relation_not_self CHECK (parent_initiative_id <> child_initiative_id),
  CONSTRAINT initiative_relation_unique UNIQUE (parent_initiative_id, child_initiative_id)
);

CREATE INDEX initiative_relation_parent_idx ON initiative_relation (parent_initiative_id, sort_order);
CREATE INDEX initiative_relation_child_idx ON initiative_relation (child_initiative_id);
CREATE INDEX initiative_relation_workspace_idx ON initiative_relation (workspace_id);
