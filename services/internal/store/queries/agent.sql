-- The in-app agent's conversations and turns.
--
-- Sessions are read by owner, never by workspace: these rows are private to one person and
-- every query here carries the user id so that a missing WHERE clause is a compile error
-- rather than a disclosure.

-- name: CreateAgentSession :one
INSERT INTO agent_session (id, workspace_id, user_id, title, status, origin, issue_id, comment_id)
VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(title),
  sqlc.arg(status), sqlc.arg(origin), sqlc.narg(issue_id), sqlc.narg(comment_id)
)
RETURNING *;

-- name: GetAgentSession :one
SELECT * FROM agent_session
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id);

-- name: ListAgentSessionsForUser :many
SELECT * FROM agent_session
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
ORDER BY updated_at DESC
LIMIT sqlc.arg(lim);

-- name: UpdateAgentSessionStatus :one
UPDATE agent_session
SET status = sqlc.arg(status),
    error = sqlc.narg(error),
    title = CASE WHEN sqlc.arg(title)::text <> '' THEN sqlc.arg(title)::text ELSE title END,
    updated_at = now()
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)
RETURNING *;

-- name: DeleteAgentSession :one
DELETE FROM agent_session
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
RETURNING id;

-- The worker's claim. SKIP LOCKED so two ticks overlapping take different rows rather than
-- one waiting on the other, and LIMIT 1 because a run holds its transaction open for as
-- long as the model takes to answer.
-- name: ClaimQueuedAgentSession :one
UPDATE agent_session
SET status = 'working', updated_at = now()
WHERE id = (
  SELECT id FROM agent_session
  WHERE status = 'queued'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;

-- The interactive claim: this conversation, if it is still waiting. Distinct from the
-- worker's claim, which takes whatever is oldest — here somebody is watching one session
-- and the answer belongs to them.
-- name: ClaimAgentSessionByID :one
UPDATE agent_session
SET status = 'working', updated_at = now()
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)
  AND user_id = sqlc.arg(user_id) AND status = 'queued'
RETURNING *;

-- A run that was claimed and never finished — the process died mid-turn. Returned to the
-- queue rather than left working forever, which would otherwise be a session that renders
-- as busy and never moves again.
-- name: RequeueStaleAgentSessions :execrows
UPDATE agent_session
SET status = 'queued', updated_at = now()
WHERE status = 'working' AND updated_at < sqlc.arg(cutoff);

-- name: CreateAgentMessage :one
INSERT INTO agent_message (
  id, workspace_id, session_id, role, body, tool_calls, proposal, proposal_state,
  input_tokens, output_tokens
)
VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(session_id), sqlc.arg(role), sqlc.arg(body),
  sqlc.arg(tool_calls), sqlc.narg(proposal), sqlc.narg(proposal_state),
  sqlc.arg(input_tokens), sqlc.arg(output_tokens)
)
RETURNING *;

-- name: ListAgentMessages :many
SELECT * FROM agent_message
WHERE session_id = sqlc.arg(session_id) AND workspace_id = sqlc.arg(workspace_id)
ORDER BY created_at;

-- name: GetAgentMessage :one
SELECT * FROM agent_message
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id);

-- name: SetAgentMessageProposalState :one
UPDATE agent_message
SET proposal_state = sqlc.arg(proposal_state)
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)
  AND proposal_state = 'pending'
RETURNING *;

-- Retention. An agent conversation is a working note, not a record: the transcripts are
-- large, they are the most sensitive rows in the schema, and nobody scrolls back a year.
-- name: PruneAgentSessions :execrows
DELETE FROM agent_session WHERE updated_at < sqlc.arg(cutoff);

-- The workspace's built-in agent identity, created on first use.
-- name: GetAgentIdentity :one
SELECT user_id FROM agent_identity WHERE workspace_id = $1;

-- name: CreateAgentIdentity :one
INSERT INTO agent_identity (workspace_id, user_id)
VALUES (sqlc.arg(workspace_id), sqlc.arg(user_id))
ON CONFLICT (workspace_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id
RETURNING user_id;

-- name: GetAgentPreference :one
SELECT auto_apply FROM agent_preference WHERE user_id = $1;

-- name: SetAgentPreference :one
INSERT INTO agent_preference (user_id, workspace_id, auto_apply)
VALUES (sqlc.arg(user_id), sqlc.arg(workspace_id), sqlc.arg(auto_apply))
ON CONFLICT (user_id) DO UPDATE
  SET auto_apply = EXCLUDED.auto_apply, updated_at = now()
RETURNING auto_apply;

-- name: GetAiCreditBalance :one
SELECT micros FROM ai_credit_balance WHERE workspace_id = $1;

-- The ledger row and the running total move together or not at all.
-- name: AppendAiCreditEntry :one
INSERT INTO ai_credit_ledger (
  id, workspace_id, micros, reason, session_id, model, input_tokens, output_tokens
)
VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(micros), sqlc.arg(reason),
  sqlc.narg(session_id), sqlc.narg(model), sqlc.arg(input_tokens), sqlc.arg(output_tokens)
)
RETURNING id;

-- name: AdjustAiCreditBalance :one
INSERT INTO ai_credit_balance (workspace_id, micros)
VALUES (sqlc.arg(workspace_id), sqlc.arg(micros))
ON CONFLICT (workspace_id) DO UPDATE
  SET micros = ai_credit_balance.micros + EXCLUDED.micros, updated_at = now()
RETURNING micros;
