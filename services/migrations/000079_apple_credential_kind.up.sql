-- Sign in with Apple.
--
-- `account_credential` has existed since 000002 and named four kinds in its CHECK, of which
-- 'oauth_google' was one and Apple was not — the table was written before Sign in with Apple
-- was a thing this product intended to offer. Everything else the flow needs is already
-- there: the row is (kind, external_id) unique, and external_id holds the OIDC subject.
--
-- The constraint is replaced rather than dropped. A kind list that permits anything is a
-- column that will eventually hold 'oauth_gogole' and read as "this account has no Apple
-- credential" — a login that silently stops matching rather than failing.
ALTER TABLE account_credential DROP CONSTRAINT account_credential_kind_check;

ALTER TABLE account_credential ADD CONSTRAINT account_credential_kind_check
  CHECK (kind IN ('passkey', 'oauth_google', 'oauth_apple', 'oauth_github', 'saml'));
