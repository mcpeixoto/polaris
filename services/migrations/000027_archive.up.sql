-- Auto-close and auto-archive: per-team periods, and a stamp on issues the engine closed.
--
-- The periods are columns, not json, for the same reason cycles and triage are: a CHECK
-- can name the allowed values, a worker can index them, and a partial write cannot leave
-- a team "enabled" with no period. Zero is off. The parent/child flags are the automations
-- that close a parent when its last sub-issue is done, and the reverse — they fire on a
-- status change, not only on the worker, because waiting a day to close a finished parent
-- is a day the board lies.
--
-- auto_closed_at is how a later reopen is distinguished from a human close, and how the
-- archives page can say why something left. It is cleared when the issue leaves a closed
-- category.

ALTER TABLE team
  ADD COLUMN auto_close_days smallint NOT NULL DEFAULT 0,
  ADD COLUMN auto_archive_days smallint NOT NULL DEFAULT 0,
  ADD COLUMN auto_close_parent boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_close_children boolean NOT NULL DEFAULT false;

ALTER TABLE team
  ADD CONSTRAINT team_auto_close_days_check
    CHECK (auto_close_days IN (0, 30, 60, 90, 180)),
  ADD CONSTRAINT team_auto_archive_days_check
    CHECK (auto_archive_days IN (0, 30, 60, 90, 180, 365));

ALTER TABLE issue
  ADD COLUMN auto_closed_at timestamptz;

-- Worker scans: stale open issues for auto-close, stale closed issues for auto-archive.
-- Most issues are neither, so the predicates keep the indexes small.
CREATE INDEX issue_auto_close_idx ON issue (team_id, updated_at)
  WHERE archived_at IS NULL AND deleted_at IS NULL AND auto_closed_at IS NULL;

CREATE INDEX issue_auto_archive_idx ON issue (team_id, updated_at)
  WHERE archived_at IS NULL AND deleted_at IS NULL;
