-- Workspace default cadence and per-project schedule overrides for project updates.

ALTER TABLE workspace
  ADD COLUMN project_update_reminder_interval_days smallint NOT NULL DEFAULT 7,
  ADD COLUMN project_update_reminder_weekday smallint NOT NULL DEFAULT 3,
  ADD COLUMN project_update_reminder_hour smallint NOT NULL DEFAULT 9,
  ADD CONSTRAINT workspace_project_update_reminder_interval_check
    CHECK (project_update_reminder_interval_days BETWEEN 1 AND 365),
  ADD CONSTRAINT workspace_project_update_reminder_weekday_check
    CHECK (project_update_reminder_weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT workspace_project_update_reminder_hour_check
    CHECK (project_update_reminder_hour BETWEEN 0 AND 23);

ALTER TABLE project
  ADD COLUMN update_schedule text NOT NULL DEFAULT 'default',
  ADD COLUMN update_reminder_interval_days smallint,
  ADD COLUMN update_reminder_weekday smallint,
  ADD COLUMN update_reminder_hour smallint,
  ADD CONSTRAINT project_update_schedule_check
    CHECK (update_schedule IN ('default', 'never', 'custom')),
  ADD CONSTRAINT project_update_reminder_interval_check
    CHECK (update_reminder_interval_days IS NULL OR update_reminder_interval_days BETWEEN 1 AND 365),
  ADD CONSTRAINT project_update_reminder_weekday_check
    CHECK (update_reminder_weekday IS NULL OR update_reminder_weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT project_update_reminder_hour_check
    CHECK (update_reminder_hour IS NULL OR update_reminder_hour BETWEEN 0 AND 23);
