-- Link attachments on issues. The URL is unique per issue: creating the same URL again
-- updates the existing row rather than minting a second card. That is what lets an
-- integration stay stateless — it posts a URL and does not have to remember whether it
-- already linked it.
--
-- Files are not stored here. There is no M1 upload path to extend; this table is the
-- link card (title, subtitle, icon, metadata). Blob storage stays a later slice.

CREATE TABLE attachment (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id     uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  -- Denormalised so a bootstrap join does not have to go through issue, and so a
  -- webhook fan-out can scope by team without re-reading a deleted issue.
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,

  url          text NOT NULL,
  title        text NOT NULL DEFAULT '',
  subtitle     text,
  icon_url     text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,

  creator_id   uuid REFERENCES "user"(id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attachment_url_not_blank CHECK (length(btrim(url)) > 0),
  CONSTRAINT attachment_url_length CHECK (char_length(url) <= 2048),
  CONSTRAINT attachment_title_length CHECK (char_length(title) <= 512),
  CONSTRAINT attachment_subtitle_length CHECK (subtitle IS NULL OR char_length(subtitle) <= 1024),
  CONSTRAINT attachment_icon_url_length CHECK (icon_url IS NULL OR char_length(icon_url) <= 2048),
  CONSTRAINT attachment_issue_url_key UNIQUE (issue_id, url)
);

CREATE INDEX attachment_issue_idx ON attachment (issue_id, created_at);
CREATE INDEX attachment_url_idx ON attachment (workspace_id, url);
CREATE INDEX attachment_workspace_updated_idx ON attachment (workspace_id, updated_at);

CREATE TRIGGER attachment_set_updated_at
  BEFORE UPDATE ON attachment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
