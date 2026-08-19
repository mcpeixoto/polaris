DROP INDEX IF EXISTS issue_snoozed_until_idx;

ALTER TABLE issue DROP COLUMN IF EXISTS snoozed_until;

ALTER TABLE team
  DROP COLUMN IF EXISTS triage_enabled,
  DROP COLUMN IF EXISTS triage_require_priority;
