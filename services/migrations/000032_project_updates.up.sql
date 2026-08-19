-- Status updates on a project: health plus narrative markdown.
--
-- Health on the project itself is not stored — it is derived from the latest live update,
-- same as Linear. Reminders, Slack distribution and auto progress summaries stay out of
-- this slice.

CREATE TABLE project_update (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,

  -- on_track / at_risk / off_track
  health       text NOT NULL,
  body         text NOT NULL DEFAULT '',

  author_id    uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,

  edited_at    timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_update_health_check
    CHECK (health IN ('on_track', 'at_risk', 'off_track'))
);

CREATE INDEX project_update_project_live_idx
  ON project_update (project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX project_update_workspace_idx ON project_update (workspace_id, updated_at);

CREATE TRIGGER project_update_set_updated_at
  BEFORE UPDATE ON project_update
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
