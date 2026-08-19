-- Triage: a status category that is also a team's intake queue.
--
-- Unreviewed work is a category, not a saved view. A view that forgot to exclude it would
-- mix incoming mail into the backlog, and a fake "Triage" filter would let a team rename
-- the status out from under every automation that keys off category. The singleton indexes
-- already exist (one triage and one duplicate status per team); this migration turns the
-- feature on, per team, and gives a snoozed issue a time rather than a second table.

ALTER TABLE team
  ADD COLUMN triage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN triage_require_priority boolean NOT NULL DEFAULT false;

ALTER TABLE issue
  ADD COLUMN snoozed_until timestamptz;

-- The inbox is "in the triage category, and not hidden for the future". A partial index on
-- the timestamp is enough: most issues are never snoozed, and the category join is cheap
-- against the team's one triage status.
CREATE INDEX issue_snoozed_until_idx ON issue (team_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL;
