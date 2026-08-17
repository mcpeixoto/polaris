-- Who moved an issue to the trash.
--
-- deleted_at has been on the row since 000007 and answers "when"; nothing has ever answered
-- "who". The trash screen says so out loud today — it names the issue's *creator* and
-- explains in prose that the person who deleted it is not recorded — which is the honest
-- rendering of a missing column and a bad answer to the question somebody arrives on that
-- screen asking.
--
-- Nullable, and it stays nullable for two reasons that are not the same. Rows deleted before
-- this migration have no answer and must not be given a guessed one. And the retention sweep
-- deletes on a schedule rather than on somebody's instruction, so for the rows it takes there
-- is genuinely no person to name; NULL there is the true value, not a gap.
--
-- ON DELETE SET NULL, matching assignee_id and creator_id: removing a user archives them
-- rather than deleting the row (see domain.RemoveUser), so this only fires on a genuine
-- account deletion, and losing the attribution is better than blocking it.
ALTER TABLE issue
  ADD COLUMN deleted_by uuid REFERENCES "user"(id) ON DELETE SET NULL;
