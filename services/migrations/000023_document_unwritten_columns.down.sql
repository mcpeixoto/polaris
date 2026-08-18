-- Removing the comment restores the previous state exactly: a column that says nothing
-- about itself. That is the state this migration exists to end, so the down is here for
-- completeness of the ladder rather than because anybody should run it.
COMMENT ON COLUMN account.email_verified_at IS NULL;
