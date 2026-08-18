-- Say, in the database, which columns the product does not yet write.
--
-- `account.email_verified_at` has existed since migration 000002 and nothing has ever set
-- it. That is a reasonable state for a column to be in — the schema was designed ahead of
-- the flow, which is cheaper than an ALTER later — and it is not a reasonable state for it
-- to be in silently. A nullable timestamp called email_verified_at reads, to anybody
-- querying this database, as "NULL means this address is unverified". It does not: it means
-- nothing at all, because no address is ever verified, and a report or an integration that
-- filtered on it would exclude every account on the server.
--
-- The Go side already says so where it matters most (see the comment on the digest
-- recipients query in internal/store/queries/notifications.sql, which explains why it does
-- NOT exclude unverified addresses). This puts the same fact where somebody with a psql
-- prompt will find it, which is the audience that has no source tree to read.
--
-- A comment rather than dropping the column: the flow is intended, the column is the right
-- shape for it, and dropping and re-adding it later would lose nothing except make this
-- migration a round trip.
COMMENT ON COLUMN account.email_verified_at IS
  'RESERVED, NEVER WRITTEN. No email-verification flow exists yet, so this is NULL for '
  'every account and NULL does not mean "unverified" — it means "unknown". Do not filter '
  'on it until something sets it.';
