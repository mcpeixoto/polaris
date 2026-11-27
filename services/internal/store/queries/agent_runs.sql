-- One delegation, from the moment it is asked for to the moment the agent reports back.
--
-- The issue row says who is delegated now. These statements are the queue that row points
-- at: cancel what is still open, claim the oldest due run, and record how it ended.

-- name: InsertAgentRun :one
INSERT INTO agent_run (
  id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after
) VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(issue_id), sqlc.arg(agent_user_id),
  sqlc.narg(delegated_by), 'queued', sqlc.arg(run_after)
)
RETURNING id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
          claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
          input_tokens, output_tokens, created_at, updated_at;

-- Re-delegating or clearing the delegate drops whatever is still in flight. A run that
-- already finished stays, because that is the history of the previous attempt.
--
-- name: CancelOpenAgentRunsForIssue :exec
UPDATE agent_run
SET status = 'cancelled', finished_at = now(), updated_at = now()
WHERE issue_id = sqlc.arg(issue_id)
  AND status IN ('queued', 'claimed', 'running');

-- The external runner's claim: this agent's oldest due run, and not one another worker
-- is already taking. SKIP LOCKED is what makes two pollers overlap without waiting.
--
-- name: ClaimDueAgentRun :one
UPDATE agent_run
SET status = 'claimed',
    claimed_at = now(),
    heartbeat_at = now(),
    updated_at = now()
WHERE id = (
  SELECT queued.id
  FROM agent_run AS queued
  WHERE queued.agent_user_id = sqlc.arg(agent_user_id)
    AND queued.status = 'queued'
    AND queued.run_after <= now()
  ORDER BY queued.run_after, queued.id
  LIMIT 1
  FOR UPDATE OF queued SKIP LOCKED
)
RETURNING id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
          claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
          input_tokens, output_tokens, created_at, updated_at;

-- The built-in agent's claim. Same queue, restricted to identities this install owns, so
-- a third-party app user delegated an issue is left for that app's own runner.
--
-- name: ClaimDueBuiltinAgentRun :one
UPDATE agent_run
SET status = 'claimed',
    claimed_at = now(),
    heartbeat_at = now(),
    updated_at = now()
WHERE id = (
  SELECT ar.id
  FROM agent_run ar
  JOIN agent_identity ai ON ai.user_id = ar.agent_user_id
  WHERE ar.status = 'queued'
    AND ar.run_after <= now()
  ORDER BY ar.run_after, ar.id
  LIMIT 1
  FOR UPDATE OF ar SKIP LOCKED
)
RETURNING id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
          claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
          input_tokens, output_tokens, created_at, updated_at;

-- name: MarkAgentRunRunning :one
UPDATE agent_run
SET status = 'running',
    session_ref = sqlc.arg(session_ref),
    heartbeat_at = now(),
    updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
          claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
          input_tokens, output_tokens, created_at, updated_at;

-- name: MarkAgentRunDone :one
UPDATE agent_run
SET status = 'done',
    finished_at = now(),
    summary = sqlc.narg(summary),
    input_tokens = input_tokens + sqlc.arg(input_tokens),
    output_tokens = output_tokens + sqlc.arg(output_tokens),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND status IN ('claimed', 'running')
RETURNING id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
          claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
          input_tokens, output_tokens, created_at, updated_at;

-- A failure after the run was already marked done is still a failure: automatic apply can
-- succeed at writing the turn and then fail a step, and the run should say so.
--
-- name: MarkAgentRunFailed :one
UPDATE agent_run
SET status = 'failed',
    finished_at = now(),
    summary = COALESCE(sqlc.narg(summary), summary),
    error = sqlc.narg(error),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND status IN ('claimed', 'running', 'done')
RETURNING id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
          claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
          input_tokens, output_tokens, created_at, updated_at;

-- name: GetAgentRunBySessionRef :one
SELECT id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
       claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
       input_tokens, output_tokens, created_at, updated_at
FROM agent_run
WHERE session_ref = sqlc.arg(session_ref)
ORDER BY created_at DESC
LIMIT 1;

-- name: ListAgentRunsForIssue :many
SELECT id, workspace_id, issue_id, agent_user_id, delegated_by, status, run_after,
       claimed_at, heartbeat_at, finished_at, session_ref, summary, error,
       input_tokens, output_tokens, created_at, updated_at
FROM agent_run
WHERE issue_id = sqlc.arg(issue_id)
ORDER BY created_at DESC;

-- An external runner whose claim went quiet still holds the run. Put it back.
--
-- Only external runners heartbeat, so only their runs are swept. A built-in run is answered
-- by an agent_session, which has its own sweep; requeuing it here would open a second
-- session for the same delegation every five minutes the model spent thinking.
--
-- session_ref is kept: for an external runner it is the CLI's resume handle, and the next
-- claim should pick the conversation up rather than start it again.
--
-- name: RequeueStaleAgentRuns :execrows
UPDATE agent_run
SET status = 'queued',
    claimed_at = NULL,
    heartbeat_at = NULL,
    updated_at = now()
WHERE status IN ('claimed', 'running')
  AND heartbeat_at < sqlc.arg(older_than)
  AND NOT EXISTS (
    SELECT 1 FROM agent_identity ai WHERE ai.user_id = agent_run.agent_user_id
  );

-- name: UpsertAgentRunner :one
INSERT INTO agent_runner (agent_user_id, workspace_id, last_seen_at, version)
VALUES (sqlc.arg(agent_user_id), sqlc.arg(workspace_id), now(), sqlc.arg(version))
ON CONFLICT (agent_user_id) DO UPDATE
SET workspace_id = EXCLUDED.workspace_id,
    last_seen_at = now(),
    version = EXCLUDED.version
RETURNING agent_user_id, workspace_id, last_seen_at, version;

-- name: GetAgentRunner :one
SELECT agent_user_id, workspace_id, last_seen_at, version
FROM agent_runner
WHERE agent_user_id = sqlc.arg(agent_user_id);

-- Workspaces whose built-in agent has never been minted. The identity used to be created on
-- the first @mention, which left nothing to delegate to in a workspace that never had one.
--
-- name: ListWorkspacesWithoutAgentIdentity :many
SELECT w.id
FROM workspace w
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM agent_identity ai WHERE ai.workspace_id = w.id)
ORDER BY w.id
LIMIT sqlc.arg(lim);
