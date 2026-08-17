-- Mutation idempotency.
--
-- Every client mutation carries an opId. If the response is lost on the wire the client
-- retries from its outbox; without this table that retry applies the write twice. The
-- server records the outcome and replays the *original* result, so a retry is
-- indistinguishable from the first call.

CREATE TABLE idempotency_key (
  client_id    uuid NOT NULL,
  op_id        uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- Guards against a client reusing an opId for a different mutation, which would
  -- otherwise silently return the wrong entity.
  request_hash bytea NOT NULL,

  -- The serialised GraphQL result of the first successful call.
  result       jsonb NOT NULL,
  -- Version minted by that call, so a replay can still tell the client where it landed.
  version      bigint,

  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (client_id, op_id)
);

CREATE INDEX idempotency_key_expiry_idx ON idempotency_key (expires_at);

-- Workspace invitations.
CREATE TABLE invite (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL DEFAULT 'member',

  -- SHA-256 of the token that went out in the email. The plaintext exists only in that
  -- email, so a database leak does not grant workspace access.
  token_hash   bytea NOT NULL,

  invited_by   uuid REFERENCES "user"(id) ON DELETE SET NULL,
  -- Teams the invitee is added to on acceptance.
  team_ids     uuid[] NOT NULL DEFAULT '{}',

  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES "user"(id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invite_role_check CHECK (role IN ('admin', 'member', 'guest'))
);

CREATE UNIQUE INDEX invite_token_hash_key ON invite (token_hash);
-- One live invite per email per workspace; re-inviting replaces rather than accumulates.
CREATE UNIQUE INDEX invite_workspace_email_pending_key
  ON invite (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invite_workspace_idx ON invite (workspace_id);

CREATE TRIGGER invite_set_updated_at
  BEFORE UPDATE ON invite
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
