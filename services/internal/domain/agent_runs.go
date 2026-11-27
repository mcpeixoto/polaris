package domain

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// DelegationDelay is how long a delegation waits before a runner may claim it.
//
// A delegation is often followed by a second look at the description, and an agent that
// starts on the first draft has to be stopped and told again. Tests shorten this.
var DelegationDelay = 120 * time.Second

// agentRunSummaryMax is how much of the assistant's last reply is kept on the run.
// The transcript holds the rest; this column is the one-line outcome.
const agentRunSummaryMax = 4000

// queueDelegation cancels whatever is still open for the issue and, when a delegate
// remains, queues the next run. Clearing the delegate only cancels.
//
// Called from inside the issue create or update that changed delegate_id, so the issue
// and the queue commit together. Nothing is emitted for the run: the issue change is
// what clients already apply, and a run is not an entity on the sync stream.
func (s *Service) queueDelegation(
	ctx context.Context, q *store.Queries, p *authz.Principal, issueID uuid.UUID, delegate *uuid.UUID,
) error {
	if err := q.CancelOpenAgentRunsForIssue(ctx, issueID); err != nil {
		return platform.Internal(err)
	}
	if delegate == nil {
		return nil
	}
	id, err := uuid.NewV7()
	if err != nil {
		return platform.Internal(err)
	}
	var by *uuid.UUID
	if p.UserID != uuid.Nil {
		uid := p.UserID
		by = &uid
	}
	_, err = q.InsertAgentRun(ctx, store.InsertAgentRunParams{
		ID:          id,
		WorkspaceID: p.WorkspaceID,
		IssueID:     issueID,
		AgentUserID: *delegate,
		DelegatedBy: by,
		RunAfter:    time.Now().Add(DelegationDelay),
	})
	if err != nil {
		return platform.Internal(err)
	}
	return nil
}

// StartDueDelegatedRun claims one due run for the built-in agent and opens the session
// that run will be answered in.
//
// The session belongs to the person who delegated, not to the agent. Proposals land with
// them, and a teammate does not get a conversation they did not ask for. A run for any
// other app user is left queued: that agent's own runner claims it.
//
// Returns nil when nothing is due. One run per call, so a tick cannot hold the worker's
// pool open for every delegation in the workspace.
func (s *Service) StartDueDelegatedRun(ctx context.Context) error {
	return s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		run, err := q.ClaimDueBuiltinAgentRun(ctx)
		if err != nil {
			if store.IsNotFound(err) {
				return nil
			}
			return platform.Internal(err)
		}
		if run.DelegatedBy == nil {
			// COPY: the person who delegated this issue is gone, so there is nobody for the session to belong to
			msg := "the person who delegated this issue is gone, so there is nobody for the session to belong to"
			_, err = q.MarkAgentRunFailed(ctx, store.MarkAgentRunFailedParams{ID: run.ID, Error: &msg})
			if err != nil && !store.IsNotFound(err) {
				return platform.Internal(err)
			}
			return nil
		}

		issue, err := q.GetIssue(ctx, run.IssueID)
		if err != nil {
			if store.IsNotFound(err) {
				// COPY: the issue this run was for has been deleted
				msg := "the issue this run was for has been deleted"
				_, ferr := q.MarkAgentRunFailed(ctx, store.MarkAgentRunFailedParams{ID: run.ID, Error: &msg})
				if ferr != nil && !store.IsNotFound(ferr) {
					return platform.Internal(ferr)
				}
				return nil
			}
			return platform.Internal(err)
		}
		team, err := q.GetTeam(ctx, issue.TeamID)
		if err != nil {
			return platform.Internal(err)
		}

		sessionID, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		body := delegationOpening(model.Identifier(team.Key, issue.Number), issue.Title, issue.Description)
		row, err := q.CreateAgentSession(ctx, store.CreateAgentSessionParams{
			ID:          sessionID,
			WorkspaceID: run.WorkspaceID,
			UserID:      *run.DelegatedBy,
			Title:       agentTitleFrom(body),
			Status:      AgentSessionQueued,
			Origin:      AgentOriginDelegation,
			IssueID:     &issue.ID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		session := toAgentSession(row)
		message, err := s.appendAgentMessage(ctx, q, run.WorkspaceID, session.ID, appendAgentMessage{
			Role: AgentRoleUser, Body: body,
		})
		if err != nil {
			return err
		}

		ref := session.ID.String()
		if _, err := q.MarkAgentRunRunning(ctx, store.MarkAgentRunRunningParams{
			ID: run.ID, SessionRef: &ref,
		}); err != nil {
			return platform.Internal(err)
		}

		// The run itself is not on the sync stream. The session is, because that is how
		// the proposals reach the person who asked.
		_, err = s.em.Emit(ctx, q, run.WorkspaceID, authz.UserActor(*run.DelegatedBy),
			agentSessionChange(session), agentMessageChange(session.UserID, message))
		return err
	})
}

// RequeueStaleAgentRuns puts claimed and running runs whose heartbeat is older than
// olderThan back on the queue. A worker that died mid-run would otherwise hold the issue
// until somebody delegated it again.
func (s *Service) RequeueStaleAgentRuns(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	n, err := s.db.Queries().RequeueStaleAgentRuns(ctx, &cutoff)
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

// finishDelegatedRun records the outcome of the session a built-in delegation opened.
//
// A session that was not opened by a delegation is a no-op here. Called from the same
// transaction that marks the session idle or failed, so the run cannot say it is still
// going after the conversation has stopped.
func (s *Service) finishDelegatedRun(
	ctx context.Context, q *store.Queries, sessionID uuid.UUID, status, summary string, runErr *string, inTok, outTok int,
) error {
	ref := sessionID.String()
	run, err := q.GetAgentRunBySessionRef(ctx, &ref)
	if err != nil {
		if store.IsNotFound(err) {
			return nil
		}
		return platform.Internal(err)
	}

	switch status {
	case AgentSessionIdle:
		text := truncateRunSummary(summary)
		_, err = q.MarkAgentRunDone(ctx, store.MarkAgentRunDoneParams{
			ID:           run.ID,
			Summary:      &text,
			InputTokens:  int64(inTok),
			OutputTokens: int64(outTok),
		})
	case AgentSessionFailed:
		_, err = q.MarkAgentRunFailed(ctx, store.MarkAgentRunFailedParams{
			ID:      run.ID,
			Summary: nil,
			Error:   runErr,
		})
	default:
		return nil
	}
	if err != nil && !store.IsNotFound(err) {
		return platform.Internal(err)
	}
	return nil
}

func delegationOpening(identifier, title, description string) string {
	// COPY: asks the agent to work the delegated issue and propose changes.
	var b strings.Builder
	fmt.Fprintf(&b, "Please work %s and propose changes.", identifier)
	fmt.Fprintf(&b, "\n\n%s — %s", identifier, title)
	if body := strings.TrimSpace(description); body != "" {
		fmt.Fprintf(&b, "\n\n%s", body)
	}
	return b.String()
}

func truncateRunSummary(s string) string {
	if len(s) <= agentRunSummaryMax {
		return s
	}
	cut := agentRunSummaryMax
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}

// mintAgentUser makes sure the workspace has its built-in agent and returns the change that
// tells clients about it, or nil when the agent already existed.
//
// The identity used to appear on the first @mention. Delegation needs it earlier: a
// Delegate picker that is empty until somebody happens to type "@Polaris" reads as a
// feature that does not work.
func (s *Service) mintAgentUser(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (*Change, error) {
	if _, err := q.GetAgentIdentity(ctx, workspaceID); err == nil {
		return nil, nil
	} else if !store.IsNotFound(err) {
		return nil, platform.Internal(err)
	}
	id, err := s.EnsureAgentIdentity(ctx, q, workspaceID)
	if err != nil {
		return nil, err
	}
	row, err := q.GetUser(ctx, id)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return &Change{
		EntityType: "user", EntityID: id, Op: OpUpsert,
		Scope: authz.WorkspaceScope(), Payload: toUser(row),
	}, nil
}

// EnsureAgentIdentities mints the built-in agent for workspaces created before it was
// minted with the workspace. A batch per call; the worker runs it at boot.
func (s *Service) EnsureAgentIdentities(ctx context.Context) (int, error) {
	if !s.agentEnabled {
		return 0, nil
	}
	ids, err := s.db.Queries().ListWorkspacesWithoutAgentIdentity(ctx, 200)
	if err != nil {
		return 0, platform.Internal(err)
	}
	n := 0
	for _, ws := range ids {
		err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
			ch, err := s.mintAgentUser(ctx, q, ws)
			if err != nil || ch == nil {
				return err
			}
			_, err = s.em.Emit(ctx, q, ws, authz.SystemActor(), *ch)
			return err
		})
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
