-- Dashboards are a page of Insights tiles. Simpler than Linear Enterprise: a grid of
-- measure × slice charts over the replica, with an optional dashboard-level filter and a
-- per-tile filter. Personal (owner_id set), team (team_id set), or workspace (neither).

CREATE TABLE dashboard (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id       uuid REFERENCES team(id) ON DELETE CASCADE,
  owner_id      uuid REFERENCES "user"(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  filter        jsonb NOT NULL DEFAULT '{}'::jsonb,
  creator_id    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  sort_order    text COLLATE "C" NOT NULL,

  archived_at   timestamptz,
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dashboard_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT dashboard_personal_xor_team CHECK (owner_id IS NULL OR team_id IS NULL)
);

CREATE INDEX dashboard_workspace_live_idx
  ON dashboard (workspace_id, sort_order)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE INDEX dashboard_owner_idx
  ON dashboard (owner_id)
  WHERE owner_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX dashboard_team_idx
  ON dashboard (team_id)
  WHERE team_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER dashboard_set_updated_at
  BEFORE UPDATE ON dashboard
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dashboard_tile (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  dashboard_id  uuid NOT NULL REFERENCES dashboard(id) ON DELETE CASCADE,

  title         text NOT NULL DEFAULT '',
  -- count / effort / cycle_time / lead_time / issue_age / burn_up
  measure       text NOT NULL,
  -- assignee / priority / state_category / team / project / label
  slice         text NOT NULL,
  -- chart / table / metric
  display       text NOT NULL DEFAULT 'chart',
  filter        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order    text COLLATE "C" NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dashboard_tile_measure_chk CHECK (measure IN (
    'count', 'effort', 'cycle_time', 'lead_time', 'issue_age', 'burn_up'
  )),
  CONSTRAINT dashboard_tile_slice_chk CHECK (slice IN (
    'assignee', 'priority', 'state_category', 'team', 'project', 'label'
  )),
  CONSTRAINT dashboard_tile_display_chk CHECK (display IN ('chart', 'table', 'metric'))
);

CREATE INDEX dashboard_tile_dashboard_idx
  ON dashboard_tile (dashboard_id, sort_order);

CREATE TRIGGER dashboard_tile_set_updated_at
  BEFORE UPDATE ON dashboard_tile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
