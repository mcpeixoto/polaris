-- Personal API keys, and the plan facts the entitlement service reads.

-- ---------------------------------------------------------------------------------------
-- API keys.
--
-- A key acts as its owner. It does not get its own identity, its own permissions or its
-- own seat: a key that could do more than the person who made it is a privilege-escalation
-- path, and a key that outlives their account is an access path nobody is reviewing.
-- Scopes narrow what the key can do; they never widen it.

CREATE TABLE api_key (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  name          text NOT NULL,

  -- SHA-256 of the token. The plaintext exists only in the response to the call that
  -- created it; a database leak therefore does not hand out working credentials.
  token_hash    bytea NOT NULL,

  -- The leading characters of the token, so a listing can say which key is which without
  -- the listing itself being a credential.
  prefix        text NOT NULL,

  -- Empty means "everything the owner can do". Narrowing only.
  scopes        text[] NOT NULL DEFAULT '{}',

  -- Written at most once a minute by the auth path — enough to answer "is this key still
  -- in use before I revoke it", cheap enough not to be a write on every request.
  last_used_at  timestamptz,

  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT api_key_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX api_key_token_hash_key ON api_key (token_hash);
CREATE INDEX api_key_user_idx ON api_key (user_id) WHERE revoked_at IS NULL;
CREATE INDEX api_key_workspace_idx ON api_key (workspace_id);

CREATE TRIGGER api_key_set_updated_at
  BEFORE UPDATE ON api_key
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Plan facts.
--
-- The *feature matrix* deliberately does not live here. Which plan may use which feature
-- changes with a release, not with data, and putting it in the database means a deploy
-- that adds a feature also needs a data migration in every self-hosted install — and that
-- a bug in the matrix is a production data fix rather than a revert. The matrix is Go, in
-- internal/entitlement; these columns are only the facts about *this* workspace that the
-- matrix cannot know.

ALTER TABLE workspace
  -- When the current plan lapses. NULL means it does not.
  ADD COLUMN plan_expires_at timestamptz,
  -- An override of the plan's default seat count, for the deals that always happen.
  -- NULL means "whatever the plan says".
  ADD COLUMN seat_limit integer,
  -- Set when a paid plan lapses. Reads keep working; writes that need the paid feature do
  -- not. Locking people out of their own data over a failed card is not a business model.
  ADD COLUMN plan_lapsed_at timestamptz;

ALTER TABLE workspace ADD CONSTRAINT workspace_seat_limit_positive
  CHECK (seat_limit IS NULL OR seat_limit > 0);
