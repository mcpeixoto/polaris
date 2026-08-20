-- Third-party integration proposals for the workspace directory.
--
-- Not replicated: this is an admin-facing inbox of "please list this tool", not a
-- credential and not something every replica needs in order to render the catalogue
-- that already ships. Slack follows as 000065.

CREATE TABLE integration_submission (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  website      text NOT NULL,
  summary      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT integration_submission_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT integration_submission_website_not_blank CHECK (length(btrim(website)) > 0),
  CONSTRAINT integration_submission_summary_not_blank CHECK (length(btrim(summary)) > 0)
);

CREATE INDEX integration_submission_workspace
  ON integration_submission (workspace_id, created_at DESC);

CREATE TRIGGER integration_submission_set_updated_at
  BEFORE UPDATE ON integration_submission
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
