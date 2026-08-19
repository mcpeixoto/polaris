-- Cycles: a team's repeating cadence, and the issues that sit in one of them.
--
-- A cycle is a dated window on one team. Automation is the point: they are created ahead
-- of time, unfinished work rolls forward, and a cooldown is a gap you cannot file into
-- because it is not a cycle. That last clause is why cooldown is not a row — an issue
-- assigned to a cooldown is a state no filter can explain.
--
-- An issue belongs to at most one cycle, as a column. Two cycles on one issue is
-- unrepresentable, which is the only way the product rule stays true when the writer is
-- an importer. The cycle must be on the same team as the issue; a trigger says so.

-- ---------------------------------------------------------------------------------------
-- Cadence lives on the team, like the estimate scale: one decision, CHECKed, defaulted
-- off. jsonb settings would accept a duration of 9 and a start day of "fortnight" until
-- the application noticed, and the application is not the only writer.

ALTER TABLE team
  ADD COLUMN cycles_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN cycle_duration_weeks smallint NOT NULL DEFAULT 1,
  ADD COLUMN cycle_cooldown_weeks smallint NOT NULL DEFAULT 0,
  ADD COLUMN cycle_start_day text NOT NULL DEFAULT 'monday',
  ADD COLUMN cycle_upcoming_count smallint NOT NULL DEFAULT 2,
  ADD COLUMN cycle_auto_add_started boolean NOT NULL DEFAULT false,
  ADD COLUMN cycle_auto_add_completed boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT team_cycle_duration_check
    CHECK (cycle_duration_weeks BETWEEN 1 AND 8),
  ADD CONSTRAINT team_cycle_cooldown_check
    CHECK (cycle_cooldown_weeks BETWEEN 0 AND 8),
  ADD CONSTRAINT team_cycle_upcoming_check
    CHECK (cycle_upcoming_count BETWEEN 1 AND 15),
  ADD CONSTRAINT team_cycle_start_day_check
    CHECK (cycle_start_day IN (
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    ));

-- ---------------------------------------------------------------------------------------

CREATE TABLE cycle (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,

  -- Sequential per team. The name is usually "Cycle N"; if a renamed cycle ends in a
  -- number, later auto-created cycles continue from that number (domain, not here).
  number        integer NOT NULL,
  name          text NOT NULL,
  description   text,

  -- Instants in UTC, minted from 00:01 in the team's timezone on the start day.
  -- ends_at is exclusive: the next cycle (or the cooldown) begins at this instant.
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,

  completed_at  timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cycle_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT cycle_ends_after_starts CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX cycle_team_number_key ON cycle (team_id, number);
CREATE INDEX cycle_team_starts_idx ON cycle (team_id, starts_at) WHERE archived_at IS NULL;
CREATE INDEX cycle_workspace_idx ON cycle (workspace_id, starts_at);

CREATE TRIGGER cycle_set_updated_at
  BEFORE UPDATE ON cycle
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------

ALTER TABLE issue
  ADD COLUMN cycle_id uuid REFERENCES cycle(id) ON DELETE SET NULL;

CREATE INDEX issue_cycle_idx ON issue (cycle_id, sort_order)
  WHERE cycle_id IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL;

-- A cycle belongs to a team; an issue in another team's cycle is a filter that lies.
CREATE OR REPLACE FUNCTION issue_cycle_matches_team() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_team uuid;
BEGIN
  IF NEW.cycle_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT team_id INTO cycle_team FROM cycle WHERE id = NEW.cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue %: cycle % does not exist', NEW.id, NEW.cycle_id;
  END IF;
  IF cycle_team IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION 'issue %: cycle % does not belong to team %',
      NEW.id, NEW.cycle_id, NEW.team_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_cycle_matches_team_check
  BEFORE INSERT OR UPDATE OF cycle_id, team_id ON issue
  FOR EACH ROW EXECUTE FUNCTION issue_cycle_matches_team();
