-- Emoji reactions on comments (feature 6.4).
--
-- A reaction is the smallest write in the product and the one people make most, which is
-- what shapes this table: no updates, no soft delete, no body. Adding one is an insert and
-- removing one is a delete, so the change stream carries an upsert and a delete of a row
-- whose id is the whole payload — there is no edit to reconcile and therefore no
-- last-writer-wins question to answer.
CREATE TABLE reaction (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  comment_id   uuid NOT NULL REFERENCES comment(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- The emoji itself rather than a shortcode. A shortcode needs a table mapping it to a
  -- character, that table has to be versioned against whatever the client's picker knows,
  -- and the two drift the first time either side is updated. The character is what is
  -- rendered and what is compared, so it is what is stored.
  emoji        text NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Long enough for any single emoji including a ZWJ sequence with skin-tone modifiers
  -- (a four-person family with tones is around 30 code points), short enough that the
  -- column cannot be used as a message field.
  CONSTRAINT reaction_emoji_shape
    CHECK (length(btrim(emoji)) > 0 AND length(emoji) <= 64)
);

-- One person reacts with one emoji once. The unique key is what makes "add" idempotent
-- without a read: a second tap on the same face conflicts and does nothing, which is also
-- the correct answer for a retried mutation.
CREATE UNIQUE INDEX reaction_key ON reaction (comment_id, user_id, emoji);

-- The read: every reaction on a page of comments, in one statement.
CREATE INDEX reaction_comment_idx ON reaction (comment_id, created_at);

-- Deleting a user cascades, and without this that cascade is a sequential scan — the same
-- unindexed-foreign-key defect that made every issue delete scan `notification`.
CREATE INDEX reaction_user_idx ON reaction (user_id);
