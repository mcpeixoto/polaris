-- GitLab v1: one instance per workspace (hosted or self-hosted), MR/commit linking with
-- magic words, and per-team status automations.
--
-- Tokens and the webhook secret stay in columns that listing and bootstrap queries never
-- select. The replicated payload is the settings a client needs to copy a git branch name
-- and to render "GitLab is connected" — not a credential.
--
-- GitLab has no bot accounts, so linkbacks are posted as the token owner. The product
-- recommends a dedicated user; that is a human setup step, not a column.

CREATE TABLE gitlab_connection (
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
  creator_id          uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  enabled             boolean NOT NULL DEFAULT true,
  -- Origin only: scheme + host + optional port, no path. Default is gitlab.com.
  instance_url        text NOT NULL DEFAULT 'https://gitlab.com',

  branch_name_format  text NOT NULL DEFAULT '{identifier}-{title}',
  link_commits        boolean NOT NULL DEFAULT false,
  -- Disableable because a GitLab note is also a notification, and some installs do not
  -- want one every time an MR opens. Default on, matching GitHub and the product.
  linkbacks           boolean NOT NULL DEFAULT true,

  -- Pasted into GitLab as the webhook token (X-Gitlab-Token). Never on the replica.
  webhook_secret      text NOT NULL,
  -- Personal or project access token. Empty is the supported self-hosted state: inbound
  -- webhooks still link; linkbacks are skipped until a token is saved.
  access_token        text,

  connected_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gitlab_connection_instance_url_length CHECK (char_length(instance_url) BETWEEN 8 AND 512),
  CONSTRAINT gitlab_connection_format_length CHECK (char_length(branch_name_format) BETWEEN 1 AND 256),
  CONSTRAINT gitlab_connection_secret_not_blank CHECK (length(btrim(webhook_secret)) > 0)
);

CREATE TRIGGER gitlab_connection_set_updated_at
  BEFORE UPDATE ON gitlab_connection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE gitlab_user_link (
  id               uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  gitlab_username  text NOT NULL,
  gitlab_user_id   bigint,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gitlab_user_link_username_not_blank CHECK (length(btrim(gitlab_username)) > 0),
  CONSTRAINT gitlab_user_link_username_length CHECK (char_length(gitlab_username) <= 256),
  CONSTRAINT gitlab_user_link_user_key UNIQUE (workspace_id, user_id)
);

CREATE INDEX gitlab_user_link_username_idx ON gitlab_user_link (workspace_id, lower(gitlab_username));

CREATE TRIGGER gitlab_user_link_set_updated_at
  BEFORE UPDATE ON gitlab_user_link
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Not replicated: a mapping is a settings row, not a sync entity. No row means the
-- product defaults (opened → first Started, merged closing MR → first Completed).
CREATE TABLE gitlab_team_automation (
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

CREATE INDEX gitlab_team_automation_workspace_idx
  ON gitlab_team_automation (workspace_id);

CREATE TRIGGER gitlab_team_automation_set_updated_at
  BEFORE UPDATE ON gitlab_team_automation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
