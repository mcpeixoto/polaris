-- Rows for the kind being removed go first: the constraint cannot be narrowed while a row
-- violates it, and failing halfway through a down migration is worse than deleting the
-- credentials this version cannot represent. Anyone affected signs in with their password,
-- or with Apple again after the next roll forward.
DELETE FROM account_credential WHERE kind = 'oauth_apple';

ALTER TABLE account_credential DROP CONSTRAINT account_credential_kind_check;

ALTER TABLE account_credential ADD CONSTRAINT account_credential_kind_check
  CHECK (kind IN ('passkey', 'oauth_google', 'oauth_github', 'saml'));
