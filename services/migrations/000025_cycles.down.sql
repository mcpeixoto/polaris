DROP TRIGGER IF EXISTS issue_cycle_matches_team_check ON issue;
DROP FUNCTION IF EXISTS issue_cycle_matches_team();

ALTER TABLE issue DROP COLUMN IF EXISTS cycle_id;

DROP TABLE IF EXISTS cycle;

ALTER TABLE team
  DROP CONSTRAINT IF EXISTS team_cycle_start_day_check,
  DROP CONSTRAINT IF EXISTS team_cycle_upcoming_check,
  DROP CONSTRAINT IF EXISTS team_cycle_cooldown_check,
  DROP CONSTRAINT IF EXISTS team_cycle_duration_check,
  DROP COLUMN IF EXISTS cycle_auto_add_completed,
  DROP COLUMN IF EXISTS cycle_auto_add_started,
  DROP COLUMN IF EXISTS cycle_upcoming_count,
  DROP COLUMN IF EXISTS cycle_start_day,
  DROP COLUMN IF EXISTS cycle_cooldown_weeks,
  DROP COLUMN IF EXISTS cycle_duration_weeks,
  DROP COLUMN IF EXISTS cycles_enabled;
