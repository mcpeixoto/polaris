DROP INDEX IF EXISTS favorite_folder_idx;
ALTER TABLE favorite DROP CONSTRAINT IF EXISTS favorite_not_in_self;
ALTER TABLE favorite DROP CONSTRAINT IF EXISTS favorite_folder_shape;
DELETE FROM favorite WHERE kind = 'folder';
ALTER TABLE favorite DROP CONSTRAINT favorite_kind_check;
ALTER TABLE favorite ADD CONSTRAINT favorite_kind_check
  CHECK (kind IN ('view', 'team', 'issue', 'label'));
ALTER TABLE favorite DROP COLUMN IF EXISTS name;
ALTER TABLE favorite DROP COLUMN IF EXISTS folder_id;
