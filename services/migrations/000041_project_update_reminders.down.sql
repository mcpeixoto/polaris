ALTER TABLE project
  DROP COLUMN IF EXISTS update_reminder_hour,
  DROP COLUMN IF EXISTS update_reminder_weekday,
  DROP COLUMN IF EXISTS update_reminder_interval_days,
  DROP COLUMN IF EXISTS update_schedule;

ALTER TABLE workspace
  DROP COLUMN IF EXISTS project_update_reminder_hour,
  DROP COLUMN IF EXISTS project_update_reminder_weekday,
  DROP COLUMN IF EXISTS project_update_reminder_interval_days;
