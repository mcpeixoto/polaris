-- The in-app agent: a conversation, and the turns in it.
--
-- Two tables rather than one document per conversation, for the reason every other list in
-- this schema is rows: a turn is appended while the previous ones are being read, and a
-- JSON column rewritten on every append is a lost update the first time somebody has the
-- same conversation open on two devices.
--
-- These are the first entities in the product that are **private to one person**. Everything
-- else here is visible to a workspace or a team; an agent conversation is not, because it
-- contains what somebody asked and what they were told, which is closer to a draft than to a
-- comment. The change rows are emitted with authz.UserScope, so the sync hub delivers them
-- to that user's own sessions and to nobody else.
CREATE TABLE agent_session (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Derived from the opening message rather than asked for. A chat that makes you name it
  -- before you can use it is a chat nobody starts.
  title        text NOT NULL DEFAULT '',

  -- idle: waiting for a person. working: a run is in flight. failed: the last run did not
  -- finish, and `error` says why.
  --
  -- Status is stored rather than derived from the messages because the worker needs to
  -- claim queued work with a predicate, and "derive the state of every session to find the
  -- queued ones" is a table scan on every tick.
  status       text NOT NULL DEFAULT 'idle',
  error        text,

  -- Where the conversation came from. A session opened from a comment carries the issue it
  -- was mentioned on, which is both the context the run needs and where its reply goes.
  origin       text NOT NULL DEFAULT 'chat',
  issue_id     uuid REFERENCES issue(id) ON DELETE SET NULL,
  comment_id   uuid REFERENCES comment(id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_session_status CHECK (status IN ('idle', 'queued', 'working', 'failed')),
  CONSTRAINT agent_session_origin CHECK (origin IN ('chat', 'comment')),
  -- A comment-triggered session without the comment it was triggered by cannot build its
  -- own context, so the pair is required together or not at all.
  CONSTRAINT agent_session_origin_shape CHECK (
    origin <> 'comment' OR (issue_id IS NOT NULL AND comment_id IS NOT NULL)
  )
);

-- The sidebar's read: this person's conversations, most recent first.
CREATE INDEX agent_session_user_idx ON agent_session (user_id, updated_at DESC);

-- The worker's claim. Partial, because the queue is almost always empty and this index
-- exists to make "is there anything to do" free rather than to make a report fast.
CREATE INDEX agent_session_queued_idx ON agent_session (created_at)
  WHERE status = 'queued';

-- Deleting a user cascades, and without this that cascade is a sequential scan — the same
-- unindexed-foreign-key defect that made every issue delete scan `notification`.
CREATE INDEX agent_session_workspace_idx ON agent_session (workspace_id);

CREATE TABLE agent_message (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,

  role         text NOT NULL,
  body         text NOT NULL DEFAULT '',

  -- What the model did to produce this turn: the tools it called and what came back,
  -- rendered in the transcript so a person can see the work rather than only the summary.
  -- Display data, never replayed as instructions.
  tool_calls   jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The writes this turn wants to perform, held until somebody approves them. Null on a
  -- turn that proposes nothing, which is most of them.
  --
  -- The proposal is stored rather than re-derived on approval so that what a person
  -- approves is exactly what runs: re-asking the model at apply time would let it answer
  -- differently, and the screen would have been a decoration.
  proposal       jsonb,
  proposal_state text,

  -- Charged to the workspace's balance once metering exists. Recorded from the first turn
  -- so the ledger can be reconciled against what actually ran.
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,

  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_message_role CHECK (role IN ('user', 'assistant')),
  CONSTRAINT agent_message_proposal_state
    CHECK (proposal_state IS NULL OR proposal_state IN ('pending', 'applied', 'rejected')),
  -- A state without a proposal, or a proposal without a state, is a row that cannot be
  -- rendered. Keep the two facts inseparable.
  CONSTRAINT agent_message_proposal_shape CHECK (
    (proposal IS NULL AND proposal_state IS NULL)
    OR (proposal IS NOT NULL AND proposal_state IS NOT NULL)
  )
);

-- The transcript's read, and the order it is replayed to the model in.
CREATE INDEX agent_message_session_idx ON agent_message (session_id, created_at);
CREATE INDEX agent_message_workspace_idx ON agent_message (workspace_id);

-- The agent's own identity in a workspace.
--
-- A reply to "@polaris, what changed this week?" has to be authored by somebody, and that
-- somebody must not be the person who asked: a comment signed by them saying something they
-- did not write is a forgery, however helpful its contents. So the agent gets a user row of
-- its own, kind='app' — the same shape a third-party agent installed over OAuth gets, and
-- which CountWorkspaceSeats already excludes, so no seat is charged for it.
--
-- A mapping table rather than a flag on `user`, for the reason oauth_app_user is one: the
-- user table is read by explicit column list in dozens of queries, and a column added there
-- changes the generated row struct of every one of them.
CREATE TABLE agent_identity (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_identity_user_idx ON agent_identity (user_id);

-- "Accept everything" mode, per person.
--
-- Its own table rather than a column on `user`, for the same reason agent_identity is one:
-- the user table is read by explicit column list in dozens of queries, and a column there
-- reshapes every generated row struct that touches it.
--
-- Default off, and deliberately so: the confirmation step is the second line of defence
-- against a model that was talked into something by text it read in an issue. Turning it
-- off is a choice somebody makes, not one they inherit.
CREATE TABLE agent_preference (
  user_id      uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  -- Derivable from the user, and carried anyway: acceptance test 10 requires every table to
  -- have it so that tenant isolation is a property of the schema rather than of remembering
  -- a join at each call site.
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  auto_apply   boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_preference_workspace_idx ON agent_preference (workspace_id);
