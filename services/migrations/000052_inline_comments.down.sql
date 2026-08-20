ALTER TABLE comment DROP CONSTRAINT comment_anchor_consistent;
ALTER TABLE comment
  DROP COLUMN quote,
  DROP COLUMN anchor_end,
  DROP COLUMN anchor_start;
