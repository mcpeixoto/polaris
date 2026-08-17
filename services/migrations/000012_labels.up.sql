-- Labels.
--
-- A group is a label with children rather than a separate table. That is not a shortcut:
-- it means one entity type on the change stream, one picker, one permission rule and one
-- place where scoping is decided. The alternative — label_group plus label — duplicates
-- every one of those and buys nothing, because a group has exactly the fields a label has.
--
-- Nesting is one level. "Priority > P0" is how people describe these; "Priority > Urgency
-- > P0" is not, and allowing it would make the one-per-group rule ambiguous.

CREATE TABLE label (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- NULL means the label belongs to the whole workspace. A team id narrows it to one
  -- team, which is what stops a hundred-team workspace from having one flat list of
  -- eight hundred labels.
  team_id       uuid REFERENCES team(id) ON DELETE CASCADE,

  -- A group. NULL for a root label or for a group itself.
  parent_id     uuid REFERENCES label(id) ON DELETE SET NULL,

  -- Whether this label is a group.
  --
  -- Declared rather than derived from "has children", which is the obvious shortcut and is
  -- wrong: a group you have just created has no children yet, so under that definition it
  -- would be an ordinary applicable label until somebody adds one — and every application
  -- made in the meantime becomes invalid the moment they do.
  is_group      boolean NOT NULL DEFAULT false,

  name          text NOT NULL,
  description   text,
  color         text NOT NULL DEFAULT '#6b7280',

  -- Fractional index, same scheme as workflow_state.position: manual order without
  -- renumbering neighbours. Compared only within one scope.
  position      text COLLATE "C" NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT label_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT label_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  -- Nesting is one level, enforced structurally rather than by walking a chain.
  CONSTRAINT label_groups_do_not_nest CHECK (NOT (is_group AND parent_id IS NOT NULL))
);

-- The scope key, materialised so it can be indexed and compared without writing
-- `COALESCE(team_id, ...)` at ten call sites. The all-zero uuid stands for "the whole
-- workspace"; it is never a real team id because team ids are UUIDv7.
ALTER TABLE label ADD COLUMN scope_key uuid NOT NULL
  GENERATED ALWAYS AS (COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

-- Names are unique within a scope, case-insensitively. Two labels called "bug" and "Bug"
-- in one team is not a taxonomy, it is a mistake nobody notices until they filter.
CREATE UNIQUE INDEX label_scope_name_key
  ON label (workspace_id, scope_key, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX label_workspace_idx ON label (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX label_parent_idx ON label (parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER label_set_updated_at
  BEFORE UPDATE ON label
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Two rules that cannot be written as CHECK constraints because they read another row.
--
-- Both fail loudly on write rather than being cleaned up later, because the alternative is
-- a label tree that renders wrong and a one-per-group rule that silently stops applying.
--
-- Note that this compares team_id, not the generated scope_key: a generated column is
-- computed AFTER before-row triggers, so NEW.scope_key is still NULL in here. The index
-- above sees the real value; this function must not.
CREATE OR REPLACE FUNCTION label_parent_integrity() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent label%ROWTYPE;
BEGIN
  -- Demoting a group that still holds labels would leave them parented to something that
  -- is not a group, which is the same invalid state this trigger exists to prevent — just
  -- reached from the other direction.
  IF TG_OP = 'UPDATE' AND OLD.is_group AND NOT NEW.is_group
     AND EXISTS (SELECT 1 FROM label WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'label %: still holds labels — empty the group before demoting it', NEW.id;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO parent FROM label WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'label %: parent % does not exist', NEW.id, NEW.parent_id;
  END IF;

  IF NOT parent.is_group THEN
    RAISE EXCEPTION 'label %: % is not a group', NEW.id, parent.id;
  END IF;

  -- A workspace group must not contain a team label. If it did, "at most one label from
  -- this group" would mean something different depending on which team you were looking
  -- from, and a filter on the group would return different sets to different people.
  IF parent.team_id IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION 'label %: team % does not match its group''s team %',
      NEW.id, NEW.team_id, parent.team_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER label_parent_integrity_check
  BEFORE INSERT OR UPDATE OF parent_id, team_id, is_group ON label
  FOR EACH ROW EXECUTE FUNCTION label_parent_integrity();

-- ---------------------------------------------------------------------------------------
-- Applying a label to an issue.
--
-- This is a row per (issue, label) with its own id, and that is the whole point. Labels
-- are the first *set* the sync engine carries, and a set written as a whole loses writes:
-- two people adding different labels a second apart both send the full new set, and the
-- second overwrites the first. As individual rows, an add is an upsert of one row and a
-- remove is a delete of one row, so both survive with no merge logic anywhere.

CREATE TABLE issue_label (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id      uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  label_id      uuid NOT NULL REFERENCES label(id) ON DELETE CASCADE,

  -- Denormalised from the issue. The sync hub judges visibility from the change row alone,
  -- and by the time it reads one the issue may be gone.
  team_id       uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,

  -- Denormalised from label.parent_id, maintained by trigger, so the one-per-group rule
  -- can be a unique index instead of application code that a bulk import bypasses.
  group_id      uuid REFERENCES label(id) ON DELETE SET NULL,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX issue_label_key ON issue_label (issue_id, label_id);

-- The rule that makes groups worth having: at most one label from a group per issue.
-- In the database, because it is a data invariant — a UI that enforces it and an importer
-- that does not gives you issues that are both "P0" and "P3".
CREATE UNIQUE INDEX issue_label_one_per_group
  ON issue_label (issue_id, group_id)
  WHERE group_id IS NOT NULL;

-- "Which issues carry this label" — the filter path.
CREATE INDEX issue_label_label_idx ON issue_label (label_id, issue_id);
CREATE INDEX issue_label_workspace_idx ON issue_label (workspace_id);

-- Fills the denormalised columns and rejects a label that the issue's team cannot use.
CREATE OR REPLACE FUNCTION issue_label_denormalise() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  issue_team  uuid;
  lbl         label%ROWTYPE;
BEGIN
  SELECT team_id INTO issue_team FROM issue WHERE id = NEW.issue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_label: issue % does not exist', NEW.issue_id;
  END IF;

  SELECT * INTO lbl FROM label WHERE id = NEW.label_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_label: label % does not exist', NEW.label_id;
  END IF;

  -- A team label belongs to that team's issues only. Without this a label picker bug, or
  -- an API caller, can attach Design's "needs-mockup" to a Platform issue, and it then
  -- appears in Design's filters on an issue Design cannot open.
  IF lbl.team_id IS NOT NULL AND lbl.team_id <> issue_team THEN
    RAISE EXCEPTION 'issue_label: label % belongs to team %, issue % is in team %',
      lbl.id, lbl.team_id, NEW.issue_id, issue_team;
  END IF;

  -- A group is a container, not something you apply.
  IF lbl.is_group THEN
    RAISE EXCEPTION 'issue_label: % is a group — apply one of its labels instead', lbl.id;
  END IF;

  NEW.team_id  := issue_team;
  NEW.group_id := lbl.parent_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_label_denormalise_write
  BEFORE INSERT OR UPDATE OF issue_id, label_id ON issue_label
  FOR EACH ROW EXECUTE FUNCTION issue_label_denormalise();

-- Moving a label into, out of, or between groups has to carry its applications with it.
--
-- The unique index above will reject the move if it would leave an issue holding two
-- labels from the same group. That is the right outcome: silently dropping one of them
-- would lose data the user entered, and the administrator doing the reorganisation is the
-- only person who can decide which survives.
CREATE OR REPLACE FUNCTION label_group_propagate() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE issue_label SET group_id = NEW.parent_id WHERE label_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER label_group_propagate_update
  AFTER UPDATE OF parent_id ON label
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION label_group_propagate();
