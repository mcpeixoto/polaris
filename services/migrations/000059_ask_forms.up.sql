-- Asks v1: a shareable form that turns a submission into a team's triage issue.
--
-- Slack and SAML-gated web forms stay out. The token is the credential: anybody who has
-- the URL can submit, which is the point of intake from people who have no Polaris
-- account. Members see the token on the replica so they can copy the link; the public
-- page itself never goes through GraphQL (that endpoint requires a session).

CREATE TABLE ask_form (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,

  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  token         text NOT NULL,

  creator_id    uuid REFERENCES "user"(id) ON DELETE SET NULL,
  archived_at   timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ask_form_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT ask_form_token_not_blank CHECK (length(token) > 0)
);

CREATE UNIQUE INDEX ask_form_token_key
  ON ask_form (token)
  WHERE deleted_at IS NULL;

CREATE INDEX ask_form_workspace_live_idx
  ON ask_form (workspace_id, team_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER ask_form_set_updated_at
  BEFORE UPDATE ON ask_form
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
