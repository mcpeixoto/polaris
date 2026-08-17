-- Issue statuses. Per team, ordered, and each belongs to one of six fixed categories.
--
-- The categories are fixed by the product, not by the customer: cycle completion, project
-- progress, insights, triage semantics, auto-archival and the GitHub status automations
-- all branch on category. A team may create, rename and reorder statuses *within* a
-- category, and that is the whole of the flexibility on offer.

CREATE TABLE workflow_state (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,

  name         text NOT NULL,
  description  text,
  color        text NOT NULL DEFAULT '#6b7280',
  category     text NOT NULL,

  -- Order within the category. Fractional index so reordering never rewrites siblings.
  position     text COLLATE "C" NOT NULL,

  -- Exactly one default per team, and it must be in backlog or unstarted — a new issue
  -- may not land in a started or completed state.
  is_default   boolean NOT NULL DEFAULT false,

  -- The reserved Duplicate status, created and owned by the system, not editable.
  is_system    boolean NOT NULL DEFAULT false,

  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workflow_state_category_check
    CHECK (category IN ('triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate')),
  CONSTRAINT workflow_state_default_category_check
    CHECK (NOT is_default OR category IN ('backlog', 'unstarted'))
);

CREATE UNIQUE INDEX workflow_state_team_name_key
  ON workflow_state (team_id, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX workflow_state_team_default_key
  ON workflow_state (team_id) WHERE is_default;
-- Triage and Duplicate are singletons per team; the product has no concept of two of either.
CREATE UNIQUE INDEX workflow_state_team_singleton_category_key
  ON workflow_state (team_id, category) WHERE category IN ('triage', 'duplicate');
CREATE INDEX workflow_state_team_idx ON workflow_state (team_id, category, position);
CREATE INDEX workflow_state_workspace_idx ON workflow_state (workspace_id);

CREATE TRIGGER workflow_state_set_updated_at
  BEFORE UPDATE ON workflow_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
