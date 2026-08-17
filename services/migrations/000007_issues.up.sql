CREATE TABLE issue (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES team(id) ON DELETE RESTRICT,

  -- The n in ENG-123. Allocated from team.issue_counter under a row lock.
  --
  -- There is deliberately NO identifier column. The team key is mutable, and a stored
  -- identifier would mean rewriting every issue in a team whenever someone fixes a typo
  -- in the key. Clients hold every team in their local store, so "ENG" || '-' || number
  -- is a free string concatenation at render time. One serialiser does it for the API.
  number        bigint NOT NULL,

  title         text NOT NULL,
  -- Markdown in M0. Becomes a Yjs document when collaborative editing lands; the column
  -- keeps holding the flattened text so search, exports and the API never depend on
  -- being able to parse a CRDT.
  description   text NOT NULL DEFAULT '',

  state_id      uuid NOT NULL REFERENCES workflow_state(id) ON DELETE RESTRICT,
  assignee_id   uuid REFERENCES "user"(id) ON DELETE SET NULL,
  creator_id    uuid REFERENCES "user"(id) ON DELETE SET NULL,

  -- 0 none, 1 urgent, 2 high, 3 medium, 4 low. Fixed scale — this is a product decision
  -- in the source product and every filter, sort and insight assumes it.
  priority      smallint NOT NULL DEFAULT 0,

  -- Manual ordering is workspace-global, not per-user and not per-view. Fractional index
  -- string under C collation so comparison is plain byte order and an insert between two
  -- neighbours never renumbers anything.
  sort_order    text COLLATE "C" NOT NULL,

  -- Set by the domain layer when the issue first enters a status of that category, and
  -- never recomputed afterwards. Insights (cycle time, lead time) read these, so a
  -- re-open must not clear started_at.
  started_at    timestamptz,
  completed_at  timestamptz,
  canceled_at   timestamptz,

  archived_at   timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_priority_check CHECK (priority BETWEEN 0 AND 4),
  CONSTRAINT issue_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE UNIQUE INDEX issue_team_number_key ON issue (team_id, number);

-- The list view's primary query: a team's live issues, grouped by status, in manual order.
CREATE INDEX issue_team_state_sort_idx ON issue (team_id, state_id, sort_order)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

-- My Issues, and the assignee grouping.
CREATE INDEX issue_assignee_idx ON issue (workspace_id, assignee_id)
  WHERE archived_at IS NULL AND deleted_at IS NULL AND assignee_id IS NOT NULL;

-- Bootstrap streams by workspace in a stable order; incremental reindex reads by updated_at.
CREATE INDEX issue_workspace_updated_idx ON issue (workspace_id, updated_at);

-- In-view find and the command menu's issue search.
CREATE INDEX issue_title_trgm ON issue USING gin (title gin_trgm_ops);

CREATE TRIGGER issue_set_updated_at
  BEFORE UPDATE ON issue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
