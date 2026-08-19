-- GitHub v1: workspace connection (PR/commit linking, magic words, branch format) and
-- per-user account links so activity can attribute to a person rather than a bot.
--
-- Tokens and the commit-webhook secret stay in columns that listing and bootstrap
-- queries never select. The replicated payload is the settings a client needs to copy a
-- git branch name and to render "GitHub is connected" — not a credential.

CREATE TABLE github_connection (
  id                     uuid PRIMARY KEY,
  workspace_id           uuid NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
  creator_id             uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  enabled                boolean NOT NULL DEFAULT true,
  org_login              text,
  installation_id        bigint,

  branch_name_format     text NOT NULL DEFAULT '{identifier}-{title}',
  link_commits           boolean NOT NULL DEFAULT false,

  -- Pasted into GitHub as the Push-events webhook secret. Never on the replica.
  commit_webhook_secret  text NOT NULL,
  -- GitHub App / OAuth token, when the install has completed. Empty is the supported
  -- self-hosted state: linking still works from inbound webhooks and from the public API.
  access_token           text,

  connected_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT github_connection_org_login_length CHECK (org_login IS NULL OR char_length(org_login) <= 256),
  CONSTRAINT github_connection_format_length CHECK (char_length(branch_name_format) BETWEEN 1 AND 256),
  CONSTRAINT github_connection_secret_not_blank CHECK (length(btrim(commit_webhook_secret)) > 0)
);

CREATE TRIGGER github_connection_set_updated_at
  BEFORE UPDATE ON github_connection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE github_user_link (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  github_login    text NOT NULL,
  github_user_id  bigint,

  access_token    text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT github_user_link_login_not_blank CHECK (length(btrim(github_login)) > 0),
  CONSTRAINT github_user_link_login_length CHECK (char_length(github_login) <= 256),
  CONSTRAINT github_user_link_user_key UNIQUE (workspace_id, user_id)
);

CREATE INDEX github_user_link_login_idx ON github_user_link (workspace_id, lower(github_login));

CREATE TRIGGER github_user_link_set_updated_at
  BEFORE UPDATE ON github_user_link
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
