-- The trash had no index.
--
-- Every partial index on `issue` is built the other way round — `WHERE deleted_at IS NULL` —
-- because until now every query that read the table wanted the live rows. Two do not: the
-- trash screen (ListDeletedIssues) and the purge, and both had to scan the whole table to
-- find the handful of rows they wanted. On the ten-thousand-issue development workspace that
-- is a sequential scan over 9,980 live rows to reach 50 deleted ones, and the ratio only gets
-- worse, because deleted rows are the ones that stay rare.
--
-- Partial, and on the same predicate both queries use. A full index on deleted_at would carry
-- an entry for every live issue in the workspace to serve a screen that only ever asks about
-- the ones that are not.
--
-- Ordered (workspace_id, deleted_at) rather than by id: the trash lists newest-deleted first
-- and the purge takes the oldest first, so the deletion time is the sort as well as the
-- filter, and both get it from the index rather than from a sort node.
CREATE INDEX issue_deleted_idx ON issue (workspace_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
