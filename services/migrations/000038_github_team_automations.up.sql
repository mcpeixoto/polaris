-- Per-team GitHub pull-request status automations.
--
-- Not replicated: a mapping is a settings row, not a sync entity, so adding it does not
-- bump the client schema. No row means the product defaults (opened → first Started,
-- merged closing PR → first Completed; drafted / review-requested / ready-for-merge are
-- no-ops). A present row with a NULL column means no action for that event, even when
-- the default would have moved the issue.
--
-- Team owners and workspace admins write these; the GitHub webhook applies them.

CREATE TABLE github_team_automation (
  team_id                      uuid PRIMARY KEY REFERENCES team(id) ON DELETE CASCADE,
  workspace_id                 uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  drafted_state_id             uuid REFERENCES workflow_state(id) ON DELETE SET NULL,
  opened_state_id              uuid REFERENCES workflow_state(id) ON DELETE SET NULL,
  review_requested_state_id    uuid REFERENCES workflow_state(id) ON DELETE SET NULL,
  ready_for_merge_state_id     uuid REFERENCES workflow_state(id) ON DELETE SET NULL,
  merged_state_id              uuid REFERENCES workflow_state(id) ON DELETE SET NULL,

  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_team_automation_workspace_idx
  ON github_team_automation (workspace_id);

CREATE TRIGGER github_team_automation_set_updated_at
  BEFORE UPDATE ON github_team_automation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
