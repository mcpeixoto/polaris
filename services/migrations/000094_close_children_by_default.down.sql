-- The default only. What each team held before the up migration was not recorded.

ALTER TABLE team
  ALTER COLUMN auto_close_children SET DEFAULT false;
