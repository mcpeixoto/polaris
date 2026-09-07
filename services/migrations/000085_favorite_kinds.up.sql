-- Favouriting the rest of the product. The sidebar could hold a view, a team, an issue or a
-- label, so every project, initiative, cycle and document page shipped without a star — not
-- because the surface was undecided but because the kind check refused the row. The four
-- kinds go in here rather than one per surface: the constraint is a single list, and adding
-- to it four times would be four migrations that each rewrite the same line.

ALTER TABLE favorite DROP CONSTRAINT favorite_kind_check;
ALTER TABLE favorite ADD CONSTRAINT favorite_kind_check
  CHECK (kind IN ('view', 'team', 'issue', 'label', 'folder',
                  'project', 'initiative', 'cycle', 'document'));
