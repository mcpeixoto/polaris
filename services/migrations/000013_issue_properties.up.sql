-- Estimates, due dates and sub-issues.

-- ---------------------------------------------------------------------------------------
-- Estimates are a per-team decision.
--
-- Store the number, render the scale. A team on t-shirt sizes and a team on Fibonacci both
-- store 3; one shows "M" and the other shows "3". Storing "M" instead would mean insights,
-- rollups and sorting all have to know the scale, and changing a team's scale would have
-- to rewrite every issue in it.

ALTER TABLE team
  ADD COLUMN estimate_scale text NOT NULL DEFAULT 'none',
  -- Whether 0 is offered as a value. Some teams use it for "no work"; for others a zero
  -- estimate is always a mistake, and offering it invites one.
  ADD COLUMN estimate_allow_zero boolean NOT NULL DEFAULT false,
  -- Extends the scale's top end (Fibonacci to 21, exponential to 16, and so on).
  ADD COLUMN estimate_extended boolean NOT NULL DEFAULT false;

ALTER TABLE team ADD CONSTRAINT team_estimate_scale_check
  CHECK (estimate_scale IN ('none', 'exponential', 'fibonacci', 'linear', 'tshirt'));

-- ---------------------------------------------------------------------------------------

ALTER TABLE issue
  -- The raw point value. NULL means unestimated, which is different from zero.
  ADD COLUMN estimate smallint,

  -- A date, not a timestamptz. "Due Friday" is a calendar day in the team's timezone, not
  -- an instant: stored as a timestamp it becomes due on Thursday for half the company.
  ADD COLUMN due_date date,

  -- Where the due date came from. SLAs arrive in a later milestone and will also want to
  -- set one, and the two are mutually exclusive — an issue has one due date, and which
  -- subsystem owns it decides whether a human may edit it. Modelling that now costs one
  -- column; retrofitting it means guessing the provenance of every date already stored.
  ADD COLUMN due_date_source text NOT NULL DEFAULT 'manual',

  -- Sub-issues. Cross-team is allowed on purpose: a platform task blocking a product
  -- feature is the normal case, and forcing them into one team to express it is worse.
  ADD COLUMN parent_id uuid REFERENCES issue(id) ON DELETE SET NULL,

  -- Manual order among siblings, independent of the workspace-global sort_order, because
  -- a parent's checklist has an order that has nothing to do with the team backlog's.
  ADD COLUMN sub_issue_sort_order text COLLATE "C";

ALTER TABLE issue ADD CONSTRAINT issue_estimate_check
  CHECK (estimate IS NULL OR estimate BETWEEN 0 AND 1000);
ALTER TABLE issue ADD CONSTRAINT issue_due_date_source_check
  CHECK (due_date_source IN ('manual', 'sla'));
ALTER TABLE issue ADD CONSTRAINT issue_not_own_parent
  CHECK (parent_id IS DISTINCT FROM id);

-- "The children of this issue", for the progress rollup and the sub-issue list.
CREATE INDEX issue_parent_idx ON issue (parent_id, sub_issue_sort_order)
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

-- Due-date views and the overdue query.
CREATE INDEX issue_due_date_idx ON issue (workspace_id, due_date)
  WHERE due_date IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL;

-- A cycle in the parent chain is not a data-quality problem, it is a hang: the progress
-- rollup, the breadcrumb and the delete cascade all walk this chain. Rejecting it on write
-- is the only place it can be caught cheaply, because by the time anything reads it the
-- damage is a spinning tab.
CREATE OR REPLACE FUNCTION issue_parent_acyclic() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cursor_id uuid := NEW.parent_id;
  hops      int  := 0;
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'issue %: parent % would create a cycle', NEW.id, NEW.parent_id;
    END IF;
    hops := hops + 1;
    IF hops > 50 THEN
      -- Only reachable if a cycle already exists that this row is not part of, which
      -- means an earlier bug got past the trigger. Fail rather than spin.
      RAISE EXCEPTION 'issue %: parent chain exceeds 50 levels', NEW.id;
    END IF;
    SELECT parent_id INTO cursor_id FROM issue WHERE id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_parent_acyclic_check
  BEFORE INSERT OR UPDATE OF parent_id ON issue
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION issue_parent_acyclic();

-- ---------------------------------------------------------------------------------------
-- Relations between issues.
--
-- Only `blocks` is stored. "Blocked by" is the same row read from the other end, and
-- storing it separately would mean two rows that can disagree — an issue that blocks
-- another without the other being blocked by it is a state no user can explain or repair.

CREATE TABLE issue_relation (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id          uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  related_issue_id  uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,

  -- blocks:    issue_id blocks related_issue_id.
  -- duplicate: issue_id is a duplicate of related_issue_id.
  -- related:   symmetric, and stored canonically (see the check below).
  type              text NOT NULL,

  -- Both teams, denormalised, because a relation is visible to either side and the hub
  -- must judge that from the change row alone.
  team_id           uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  related_team_id   uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,

  created_by        uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_relation_type_check CHECK (type IN ('blocks', 'related', 'duplicate')),
  CONSTRAINT issue_relation_not_self CHECK (issue_id <> related_issue_id),

  -- `related` has no direction, so it is stored with the smaller id first. That makes the
  -- unique index below enough to prevent A-related-B and B-related-A both existing —
  -- without it, the duplicate is invisible to the database and shows up twice in the UI.
  CONSTRAINT issue_relation_symmetric_canonical
    CHECK (type <> 'related' OR issue_id < related_issue_id)
);

CREATE UNIQUE INDEX issue_relation_key
  ON issue_relation (issue_id, related_issue_id, type);

-- Both directions are read constantly: "what does this block" and "what blocks this".
CREATE INDEX issue_relation_forward_idx ON issue_relation (issue_id, type);
CREATE INDEX issue_relation_reverse_idx ON issue_relation (related_issue_id, type);
CREATE INDEX issue_relation_workspace_idx ON issue_relation (workspace_id);

-- Fills the two team ids from the issues, for the same reason issue_label does: the sync
-- hub cannot re-read a deleted issue.
CREATE OR REPLACE FUNCTION issue_relation_denormalise() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT team_id INTO NEW.team_id FROM issue WHERE id = NEW.issue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_relation: issue % does not exist', NEW.issue_id;
  END IF;
  SELECT team_id INTO NEW.related_team_id FROM issue WHERE id = NEW.related_issue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_relation: issue % does not exist', NEW.related_issue_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_relation_denormalise_write
  BEFORE INSERT OR UPDATE OF issue_id, related_issue_id ON issue_relation
  FOR EACH ROW EXECUTE FUNCTION issue_relation_denormalise();
