-- SLA rules are workspace-scoped policies: first match wins, ordered by position.
-- Applying a rule sets issue.due_date (calendar day) and due_date_source = 'sla'.
-- Hour-precision breach times are deferred; the date is the day the duration lands on
-- in the issue's team timezone.

CREATE TABLE sla_rule (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  position           text COLLATE "C" NOT NULL,
  filter             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- apply | remove
  action             text NOT NULL,
  duration_minutes   integer,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sla_rule_action_check CHECK (action IN ('apply', 'remove')),
  CONSTRAINT sla_rule_duration_check CHECK (
    (action = 'remove' AND duration_minutes IS NULL)
    OR (action = 'apply' AND duration_minutes IS NOT NULL AND duration_minutes > 0)
  )
);

CREATE INDEX sla_rule_workspace_position_idx
  ON sla_rule (workspace_id, position);

CREATE TRIGGER sla_rule_set_updated_at
  BEFORE UPDATE ON sla_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
