-- Status updates on an initiative: health plus narrative markdown.
--
-- Health on the initiative itself is not stored — it is derived from the latest live update,
-- same as projects. Reminders, Slack distribution and including project/sub-initiative
-- updates in the feed stay out of this slice.

CREATE TABLE initiative_update (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  initiative_id  uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,

  -- on_track / at_risk / off_track — same vocabulary as project_update.
  health         text NOT NULL,
  body           text NOT NULL DEFAULT '',

  author_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,

  edited_at      timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT initiative_update_health_check
    CHECK (health IN ('on_track', 'at_risk', 'off_track'))
);

CREATE INDEX initiative_update_initiative_live_idx
  ON initiative_update (initiative_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX initiative_update_workspace_idx ON initiative_update (workspace_id, updated_at);

CREATE TRIGGER initiative_update_set_updated_at
  BEFORE UPDATE ON initiative_update
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
