-- An initiative gets the same icon and colour a project has, so the one picker that sets
-- them on a project sets them here too. The picker writes both in one call, and the
-- default is the project's default, so an initiative nobody has decorated draws the same
-- neutral grey a project does.

ALTER TABLE initiative
  ADD COLUMN icon text,
  ADD COLUMN color text NOT NULL DEFAULT '#6b7280';
