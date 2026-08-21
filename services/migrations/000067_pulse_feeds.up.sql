-- Personal Pulse feeds: a named subset of project updates, owned by one person.
--
-- Popular is replica-derived (comment engagement on the project's issues) and needs no
-- table. Custom feeds do: the set of projects is the person's, and only they see the row.

CREATE TABLE pulse_feed (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  name         text NOT NULL,
  project_ids  uuid[] NOT NULL DEFAULT '{}',

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pulse_feed_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX pulse_feed_owner_idx
  ON pulse_feed (workspace_id, user_id, id);

CREATE TRIGGER pulse_feed_set_updated_at
  BEFORE UPDATE ON pulse_feed
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
