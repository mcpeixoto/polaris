-- OAuth 2.0 applications: Polaris as a provider for third-party apps.
--
-- An application is owned by a workspace (Linear's guidance: give it a dedicated
-- workspace so every admin of that workspace can manage it). It is not replicated.
-- Client secrets, authorization codes and tokens are credentials: a listing may hold
-- metadata, never the plaintext. Only SHA-256 digests are stored, except the 30-minute
-- refresh-token grace columns, which hold the successor pair so a lost token response
-- can be replayed. Those columns are ignored after `refresh_replayable_until`.
--
-- App identity (actor=app) is a real `user` row with kind='app', one per
-- (application, installing workspace). The mapping lives here rather than on `user`,
-- so the replica's User shape does not change and the client schema does not bump.

CREATE TABLE oauth_application (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  creator_id      uuid NOT NULL REFERENCES "user"(id),

  name            text NOT NULL,
  description     text,
  developer       text,
  developer_url   text,
  image_url       text,

  -- Public identifier third parties put in authorize URLs. Not a secret.
  client_id       text NOT NULL,
  client_secret_hash   bytea NOT NULL,
  client_secret_prefix text NOT NULL,

  redirect_uris   text[] NOT NULL,
  allowed_scopes  text[] NOT NULL DEFAULT '{read}',

  public_enabled              boolean NOT NULL DEFAULT false,
  client_credentials_enabled  boolean NOT NULL DEFAULT false,
  webhook_url     text,

  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oauth_application_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT oauth_application_redirects_not_empty CHECK (cardinality(redirect_uris) > 0)
);

CREATE UNIQUE INDEX oauth_application_client_id_key ON oauth_application (client_id);
CREATE INDEX oauth_application_workspace_idx
  ON oauth_application (workspace_id) WHERE archived_at IS NULL;

CREATE TRIGGER oauth_application_set_updated_at
  BEFORE UPDATE ON oauth_application
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Short-lived codes issued at consent and exchanged once at /oauth/token.
CREATE TABLE oauth_authorization_code (
  id              uuid PRIMARY KEY,
  application_id  uuid NOT NULL REFERENCES oauth_application(id) ON DELETE CASCADE,
  -- Workspace the token will act in, which may differ from the application's owner.
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES "user"(id),
  actor_kind      text NOT NULL,
  code_hash       bytea NOT NULL,
  redirect_uri    text NOT NULL,
  scopes          text[] NOT NULL,
  code_challenge  text,
  code_challenge_method text,
  team_ids        uuid[] NOT NULL DEFAULT '{}',
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oauth_authorization_code_actor_kind
    CHECK (actor_kind IN ('user', 'app'))
);

CREATE UNIQUE INDEX oauth_authorization_code_hash_key ON oauth_authorization_code (code_hash);
CREATE INDEX oauth_authorization_code_expiry_idx
  ON oauth_authorization_code (expires_at) WHERE consumed_at IS NULL;

-- Access and refresh tokens. Looked up by digest; plaintext exists in the token response.
CREATE TABLE oauth_token (
  id                  uuid PRIMARY KEY,
  application_id      uuid NOT NULL REFERENCES oauth_application(id) ON DELETE CASCADE,
  workspace_id        uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- The actor the token authenticates as: the authorizing human, or the app user.
  user_id             uuid NOT NULL REFERENCES "user"(id),
  authorizing_user_id uuid REFERENCES "user"(id),
  grant_type          text NOT NULL,

  access_token_hash   bytea NOT NULL,
  refresh_token_hash  bytea,

  scopes              text[] NOT NULL,
  team_ids            uuid[] NOT NULL DEFAULT '{}',

  access_expires_at   timestamptz NOT NULL,
  refresh_expires_at  timestamptz,
  revoked_at          timestamptz,
  last_used_at        timestamptz,

  -- Refresh rotation. A consumed refresh token can be replayed until
  -- refresh_replayable_until to recover the successor pair if the response was lost.
  replaced_by         uuid REFERENCES oauth_token(id),
  refresh_replayable_until timestamptz,
  successor_access_token  text,
  successor_refresh_token text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oauth_token_grant_type
    CHECK (grant_type IN ('authorization_code', 'refresh_token', 'client_credentials'))
);

CREATE UNIQUE INDEX oauth_token_access_hash_key ON oauth_token (access_token_hash);
CREATE UNIQUE INDEX oauth_token_refresh_hash_key
  ON oauth_token (refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX oauth_token_application_idx ON oauth_token (application_id)
  WHERE revoked_at IS NULL;

CREATE TRIGGER oauth_token_set_updated_at
  BEFORE UPDATE ON oauth_token
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One app user per (application, installing workspace). The user row itself is ordinary
-- (kind='app') and is what assignee, mention and the replica already speak.
CREATE TABLE oauth_app_user (
  application_id  uuid NOT NULL REFERENCES oauth_application(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, workspace_id)
);

CREATE UNIQUE INDEX oauth_app_user_user_key ON oauth_app_user (user_id);
