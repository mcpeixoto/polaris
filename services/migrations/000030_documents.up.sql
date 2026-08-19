-- Long-form markdown attached to a team or a project.
--
-- Collaborative editing and version history stay out of this slice: the body column holds
-- markdown text, same as an issue description today, and becomes a Yjs snapshot when the
-- editor lands. Team documents are runbooks and meeting notes; project documents live beside
-- the overview spec.

CREATE TABLE document (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- Always set: scopes the row for sync, webhooks and team-private visibility.
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  -- NULL means a team document; set means the doc belongs to that project.
  project_id   uuid REFERENCES project(id) ON DELETE CASCADE,

  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  sort_order   text NOT NULL,

  creator_id   uuid REFERENCES "user"(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES "user"(id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  deleted_at   timestamptz,

  CONSTRAINT document_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT document_title_length CHECK (char_length(title) <= 512)
);

CREATE INDEX document_team_live_idx
  ON document (team_id, sort_order)
  WHERE deleted_at IS NULL AND archived_at IS NULL AND project_id IS NULL;

CREATE INDEX document_project_live_idx
  ON document (project_id, sort_order)
  WHERE project_id IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL;

CREATE INDEX document_workspace_updated_idx ON document (workspace_id, updated_at);

CREATE TRIGGER document_set_updated_at
  BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
