DROP TABLE IF EXISTS pulse_digest_cursor;

ALTER TABLE workspace
  DROP CONSTRAINT IF EXISTS workspace_pulse_digest_cadence_check,
  DROP COLUMN IF EXISTS pulse_digest_cadence,
  DROP COLUMN IF EXISTS pulse_enabled;
