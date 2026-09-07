-- The rows have to go before the constraint comes back, or re-adding it fails on data the
-- older schema has no name for.
DELETE FROM favorite WHERE kind IN ('project', 'initiative', 'cycle', 'document');
ALTER TABLE favorite DROP CONSTRAINT favorite_kind_check;
ALTER TABLE favorite ADD CONSTRAINT favorite_kind_check
  CHECK (kind IN ('view', 'team', 'issue', 'label', 'folder'));
