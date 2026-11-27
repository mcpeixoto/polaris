-- Delegation: a person keeps an issue, an agent does the work on it.
--
-- The assignee answers "whose is this"; the delegate answers "who is working it right now".
-- Folding the two into one field forces a choice between losing the owner when an agent
-- picks the issue up and hiding from the agent that it was asked to. Only app users can be
-- delegates; the domain enforces that, because the kind lives on a different row.
ALTER TABLE issue
  ADD COLUMN delegate_id uuid REFERENCES "user"(id) ON DELETE SET NULL;

CREATE INDEX issue_delegate_idx ON issue (delegate_id) WHERE delegate_id IS NOT NULL;

-- One delegation, from the moment it is asked for to the moment the agent reports back.
--
-- A row per run rather than state on the issue, because an issue is delegated more than
-- once and each attempt has its own outcome, tokens and resume handle. The issue holds who
-- is delegated now; this table holds what each of them did.
CREATE TABLE agent_run (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id       uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  agent_user_id  uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  delegated_by   uuid REFERENCES "user"(id) ON DELETE SET NULL,

  status         text NOT NULL DEFAULT 'queued',

  -- Not claimable before this. A delegation is often followed by a second look at the
  -- description, and an agent that starts on the first draft has to be stopped and told
  -- again.
  run_after      timestamptz NOT NULL,

  claimed_at     timestamptz,
  heartbeat_at   timestamptz,
  finished_at    timestamptz,

  -- An external runner's session id, so the next run on the same issue resumes the same
  -- conversation instead of rereading the repository from nothing.
  session_ref    text,

  summary        text,
  error          text,
  input_tokens   bigint NOT NULL DEFAULT 0,
  output_tokens  bigint NOT NULL DEFAULT 0,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_run_status CHECK (
    status IN ('queued', 'claimed', 'running', 'done', 'failed', 'cancelled')
  )
);

-- The claim: due runs for one agent, oldest first. Partial because the queue is almost
-- always empty.
CREATE INDEX agent_run_queued_idx ON agent_run (agent_user_id, run_after)
  WHERE status = 'queued';

-- The stale-heartbeat sweep.
CREATE INDEX agent_run_active_idx ON agent_run (heartbeat_at)
  WHERE status IN ('claimed', 'running');

-- Cancelling the open run when an issue is re-delegated, and the issue's run history.
CREATE INDEX agent_run_issue_idx ON agent_run (issue_id, created_at DESC);

CREATE INDEX agent_run_workspace_idx ON agent_run (workspace_id);
CREATE INDEX agent_run_delegated_by_idx ON agent_run (delegated_by) WHERE delegated_by IS NOT NULL;

-- When an external runner last asked for work. Drives the online dot beside an agent; a
-- runner that stopped polling is an agent nobody should be delegating to.
CREATE TABLE agent_runner (
  agent_user_id  uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  version        text NOT NULL DEFAULT ''
);

CREATE INDEX agent_runner_workspace_idx ON agent_runner (workspace_id);

-- The built-in agent takes delegated work through the same session machinery as a chat.
ALTER TABLE agent_session DROP CONSTRAINT agent_session_origin;
ALTER TABLE agent_session
  ADD CONSTRAINT agent_session_origin CHECK (origin IN ('chat', 'comment', 'delegation'));
