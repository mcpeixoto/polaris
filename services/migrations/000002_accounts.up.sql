-- Global identity. Deliberately separate from "user" (see 000004).
--
-- An account is a person's login. A user is that person *inside one workspace*.
-- One account -> many users. This split is decided in docs/07-milestones/00-milestone-0.md
-- and is not deferrable: retrofitting it rewrites auth, JWT claims, sync scoping and the
-- meaning of every user_id foreign key in the schema.

CREATE TABLE account (
  id               uuid PRIMARY KEY,
  email            text NOT NULL,
  -- Argon2id encoded string ($argon2id$v=19$m=...). NULL means the account exists but
  -- has no password (invited-but-not-activated, or passkey/SSO only).
  password_hash    text,
  email_verified_at timestamptz,
  -- Set when the person asks for deletion; a purge job hard-deletes after the window.
  deleted_at       timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Emails are compared case-insensitively but stored as typed, so the person sees
-- their own capitalisation back.
CREATE UNIQUE INDEX account_email_lower_key ON account (lower(email));

CREATE TRIGGER account_set_updated_at
  BEFORE UPDATE ON account
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens. Opaque and stored, never JWTs, because the product exposes a session
-- list with a revoke button and a stateless token cannot be revoked.
CREATE TABLE account_session (
  id            uuid PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  -- SHA-256 of the refresh token. The plaintext is shown to the client once and never
  -- stored, so a database leak does not hand over live sessions.
  token_hash    bytea NOT NULL,
  user_agent    text,
  ip            inet,
  -- Rough geo for the session list; filled best-effort, never used for authorisation.
  country       text,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX account_session_token_hash_key ON account_session (token_hash);
CREATE INDEX account_session_account_idx ON account_session (account_id) WHERE revoked_at IS NULL;
CREATE INDEX account_session_expiry_idx ON account_session (expires_at) WHERE revoked_at IS NULL;

CREATE TRIGGER account_session_set_updated_at
  BEFORE UPDATE ON account_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Passkeys and external identity providers. Ships empty in M0; the table exists so that
-- adding WebAuthn later is a feature, not a migration of the auth model.
CREATE TABLE account_credential (
  id             uuid PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  kind           text NOT NULL,   -- 'passkey' | 'oauth_google' | 'oauth_github' | 'saml'
  -- Provider-scoped identifier: credential id for WebAuthn, subject for OIDC.
  external_id    text NOT NULL,
  label          text,
  -- WebAuthn public key / provider metadata. No secrets.
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_used_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_credential_kind_check
    CHECK (kind IN ('passkey', 'oauth_google', 'oauth_github', 'saml'))
);

CREATE UNIQUE INDEX account_credential_provider_key ON account_credential (kind, external_id);
CREATE INDEX account_credential_account_idx ON account_credential (account_id);

CREATE TRIGGER account_credential_set_updated_at
  BEFORE UPDATE ON account_credential
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
