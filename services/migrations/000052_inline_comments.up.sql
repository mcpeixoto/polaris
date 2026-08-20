-- Inline comments on issue descriptions (inventory 6.5).
--
-- A thread on selected text is still a comment: same body, same one-level replies, same
-- resolve. These three columns name the span they belong to. Offsets are UTF-16 code units
-- as a textarea reports them; the quote is the text that was selected, so a later edit can
-- re-find the span when the offsets drift.
--
-- All three are null on an ordinary issue-thread comment. Replies never carry a span of
-- their own — they hang off the root, which is what already has the mark.

ALTER TABLE comment
  ADD COLUMN anchor_start int,
  ADD COLUMN anchor_end int,
  ADD COLUMN quote text;

ALTER TABLE comment
  ADD CONSTRAINT comment_anchor_consistent CHECK (
    (anchor_start IS NULL AND anchor_end IS NULL AND quote IS NULL)
    OR (
      parent_id IS NULL
      AND anchor_start IS NOT NULL
      AND anchor_end IS NOT NULL
      AND quote IS NOT NULL
      AND length(btrim(quote)) > 0
      AND char_length(quote) <= 16384
      AND anchor_start >= 0
      AND anchor_end > anchor_start
    )
  );
