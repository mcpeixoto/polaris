-- Default templates (members vs non-members) and recurring issues.
--
-- A team's default template is applied when an issue is filed without one: separately for
-- people in the team and for everybody else. Form templates (a later milestone) may only
-- be defaults for non-members; until then both pointers are ordinary issue templates.
-- ON DELETE SET NULL so retiring a template does not take the team with it, and so a
-- default that pointed at a now-archived row is simply "no default" rather than a
-- dangling id the create path has to special-case.

ALTER TABLE team
  ADD COLUMN default_template_for_members_id uuid REFERENCES issue_template(id) ON DELETE SET NULL,
  ADD COLUMN default_template_for_non_members_id uuid REFERENCES issue_template(id) ON DELETE SET NULL;

-- Recurring issues are a snapshot, not a live link to a template. Editing the source
-- template later must not change what this schedule mints — that is the product rule,
-- and it is why title/body/properties live here rather than being read back from
-- issue_template at mint time.
--
-- next_due_date is the due date of the current occurrence (the one already filed). The
-- worker mints the next issue after that day has passed, at 00:01 in the team's
-- timezone, then advances this column by the cadence. Storing the *next* due date
-- instead would make "create after the current due date passes" a subtraction, and a
-- subtraction from a calendar day is how timezones sneak in.

CREATE TABLE recurring_issue (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,

  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance only. Null when the schedule was written by hand or converted from an
  -- issue rather than from a template. Never consulted at mint time.
  template_id   uuid REFERENCES issue_template(id) ON DELETE SET NULL,

  cadence       text NOT NULL,
  next_due_date date NOT NULL,

  last_created_at timestamptz,

  created_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT recurring_issue_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT recurring_issue_cadence_check CHECK (cadence IN (
    'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'
  ))
);

CREATE INDEX recurring_issue_team_idx ON recurring_issue (team_id) WHERE archived_at IS NULL;
CREATE INDEX recurring_issue_due_idx ON recurring_issue (next_due_date) WHERE archived_at IS NULL;

CREATE TRIGGER recurring_issue_set_updated_at
  BEFORE UPDATE ON recurring_issue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Issues remember the schedule that minted them. Filterable as "recurring", and what
-- lets a converted issue and every later occurrence share one schedule without a
-- last_issue_id pointer that would fight this column over which row is current.
ALTER TABLE issue
  ADD COLUMN recurring_issue_id uuid REFERENCES recurring_issue(id) ON DELETE SET NULL;

CREATE INDEX issue_recurring_idx ON issue (recurring_issue_id)
  WHERE recurring_issue_id IS NOT NULL AND deleted_at IS NULL;
