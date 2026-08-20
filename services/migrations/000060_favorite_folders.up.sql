-- Favourites folders. A folder is a favourite of kind `folder` whose target is itself
-- and whose name is the heading in the sidebar. Other favourites may sit inside one via
-- folder_id. Nested folders stay out: a folder has no folder_id, and that is a constraint
-- rather than a convention so a drag cannot invent a tree the sidebar does not render.

ALTER TABLE favorite
  ADD COLUMN folder_id uuid REFERENCES favorite(id) ON DELETE SET NULL,
  ADD COLUMN name text;

ALTER TABLE favorite DROP CONSTRAINT favorite_kind_check;
ALTER TABLE favorite ADD CONSTRAINT favorite_kind_check
  CHECK (kind IN ('view', 'team', 'issue', 'label', 'folder'));

ALTER TABLE favorite ADD CONSTRAINT favorite_folder_shape
  CHECK (
    (kind = 'folder'
      AND name IS NOT NULL
      AND length(btrim(name)) > 0
      AND target_id = id
      AND folder_id IS NULL)
    OR
    (kind <> 'folder' AND name IS NULL)
  );

ALTER TABLE favorite ADD CONSTRAINT favorite_not_in_self
  CHECK (folder_id IS NULL OR folder_id <> id);

CREATE INDEX favorite_folder_idx ON favorite (folder_id) WHERE folder_id IS NOT NULL;
