DROP INDEX IF EXISTS issue_auto_archive_idx;
DROP INDEX IF EXISTS issue_auto_close_idx;

ALTER TABLE issue DROP COLUMN IF EXISTS auto_closed_at;

ALTER TABLE team
  DROP CONSTRAINT IF EXISTS team_auto_close_days_check,
  DROP CONSTRAINT IF EXISTS team_auto_archive_days_check,
  DROP COLUMN IF EXISTS auto_close_days,
  DROP COLUMN IF EXISTS auto_archive_days,
  DROP COLUMN IF EXISTS auto_close_parent,
  DROP COLUMN IF EXISTS auto_close_children;
