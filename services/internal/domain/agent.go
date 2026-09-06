package domain

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Storage for the in-app agent. The model is not called from here — this file owns the
// conversation, and internal/agent owns what to do with it. Keeping them apart is what lets
// the transcript be read, listed and tested without an API key in the environment.
//
// Every read is scoped to the owning user, not the workspace. An agent conversation holds
// what somebody asked and what they were told, which is nearer a draft than a comment, so
// the change rows go out under authz.UserScope and reach that person's own devices only.

const (
	// A conversation is a working note, not a record. Long enough to come back to on
	// Monday, short enough that the most sensitive rows in the schema do not accumulate
	// for a year.
	agentSessionRetention = 30 * 24 * time.Hour

	// A run holds its session in `working` while the model answers. Past this it is
	// assumed the process died mid-turn and the session goes back on the queue, because a
	// session stuck in `working` renders as busy forever and no amount of waiting fixes it.
	agentRunStaleAfter = 15 * time.Minute

	maxAgentMessageLength = 16000
	maxAgentTitleLength   = 120
	maxAgentSessionsPage  = 100
)

const (
	AgentSessionIdle    = "idle"
	AgentSessionQueued  = "queued"
	AgentSessionWorking = "working"
	AgentSessionFailed  = "failed"

	AgentOriginChat    = "chat"
	AgentOriginComment = "comment"

	AgentRoleUser      = "user"
	AgentRoleAssistant = "assistant"

	AgentProposalPending  = "pending"
	AgentProposalApplied  = "applied"
	AgentProposalRejected = "rejected"
)

type CreateAgentSessionInput struct {
	// Body is the opening message. Required: a session with no question in it is a row
	// nobody asked for, and the chat surface always has one by the time it calls.
	Body string

	// Set together when the agent was summoned by a mention rather than opened as a chat.
	IssueID   *uuid.UUID
	CommentID *uuid.UUID
}

// CreateAgentSession opens a conversation and records its first message.
//
// The session is created `queued`, not `idle`: the caller has asked something, so there is
// work to do, and whichever runner gets to it first — the api serving an interactive
// request or the worker draining the queue — moves it to `working`.
func (s *Service) CreateAgentSession(
	ctx context.Context, p *authz.Principal, in CreateAgentSessionInput,
) (model.AgentSession, model.AgentMessage, int64, error) {
	if p == nil {
		return model.AgentSession{}, model.AgentMessage{}, 0, platform.Unauthorized("")
	}
	// A guest's agent would spend the workspace's credits, and a guest is by definition
	// somebody the workspace has decided to limit. Refused here rather than at spend time,
	// where the error would arrive after the person had typed their question.
	if p.IsGuest() {
		return model.AgentSession{}, model.AgentMessage{}, 0,
			platform.Forbidden("guests cannot use the agent")
	}
	body, err := validateAgentBody(in.Body)
	if err != nil {
		return model.AgentSession{}, model.AgentMessage{}, 0, err
	}
	origin := AgentOriginChat
	if in.IssueID != nil || in.CommentID != nil {
		if in.IssueID == nil || in.CommentID == nil {
			return model.AgentSession{}, model.AgentMessage{}, 0,
				platform.Validation("commentId", "a comment-triggered session needs both an issue and a comment")
		}
		origin = AgentOriginComment
	}

	var session model.AgentSession
	var message model.AgentMessage
	var version int64

	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if origin == AgentOriginComment {
			// The mention has to be on something the caller can actually read, or the
			// agent would be a way to ask about issues you cannot see.
			if _, _, _, err := s.reactableComment(ctx, q, p, *in.CommentID); err != nil {
				return err
			}
		}

		sessionID, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateAgentSession(ctx, store.CreateAgentSessionParams{
			ID:          sessionID,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
			Title:       agentTitleFrom(body),
			Status:      AgentSessionQueued,
			Origin:      origin,
			IssueID:     in.IssueID,
			CommentID:   in.CommentID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		session = toAgentSession(row)

		message, err = s.appendAgentMessage(ctx, q, p.WorkspaceID, session.ID, appendAgentMessage{
			Role: AgentRoleUser, Body: body,
		})
		if err != nil {
			return err
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(),
			agentSessionChange(session), agentMessageChange(session.UserID, message))
		return err
	})
	if err != nil {
		return model.AgentSession{}, model.AgentMessage{}, 0, err
	}
	return session, message, version, nil
}

// SendAgentMessage adds a follow-up question to an existing conversation and puts it
// back on the queue.
func (s *Service) SendAgentMessage(
	ctx context.Context, p *authz.Principal, sessionID uuid.UUID, body string,
) (model.AgentMessage, int64, error) {
	if p == nil {
		return model.AgentMessage{}, 0, platform.Unauthorized("")
	}
	body, err := validateAgentBody(body)
	if err != nil {
		return model.AgentMessage{}, 0, err
	}

	var out model.AgentMessage
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		session, err := s.ownedAgentSession(ctx, q, p, sessionID)
		if err != nil {
			return err
		}
		// A second question while the first is still running would interleave two runs
		// over one transcript, and the model would answer the pair as though they were
		// asked together.
		if session.Status == AgentSessionWorking || session.Status == AgentSessionQueued {
			return platform.Conflict("the agent is still working on this conversation")
		}

		out, err = s.appendAgentMessage(ctx, q, p.WorkspaceID, session.ID, appendAgentMessage{
			Role: AgentRoleUser, Body: body,
		})
		if err != nil {
			return err
		}
		updated, err := q.UpdateAgentSessionStatus(ctx, store.UpdateAgentSessionStatusParams{
			ID: session.ID, WorkspaceID: p.WorkspaceID, Status: AgentSessionQueued, Title: "",
		})
		if err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(),
			agentSessionChange(toAgentSession(updated)), agentMessageChange(p.UserID, out))
		return err
	})
	if err != nil {
		return model.AgentMessage{}, 0, err
	}
	return out, version, nil
}

type appendAgentMessage struct {
	Role          string
	Body          string
	ToolCalls     []model.AgentToolCall
	Proposal      *model.AgentProposal
	ProposalState *string
	InputTokens   int
	OutputTokens  int
}

func (s *Service) appendAgentMessage(
	ctx context.Context, q *store.Queries, workspaceID, sessionID uuid.UUID, in appendAgentMessage,
) (model.AgentMessage, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return model.AgentMessage{}, platform.Internal(err)
	}
	calls := in.ToolCalls
	if calls == nil {
		calls = []model.AgentToolCall{}
	}
	callsJSON, err := json.Marshal(calls)
	if err != nil {
		return model.AgentMessage{}, platform.Internal(err)
	}
	var proposalJSON []byte
	if in.Proposal != nil {
		proposalJSON, err = json.Marshal(in.Proposal)
		if err != nil {
			return model.AgentMessage{}, platform.Internal(err)
		}
	}

	row, err := q.CreateAgentMessage(ctx, store.CreateAgentMessageParams{
		ID:            id,
		WorkspaceID:   workspaceID,
		SessionID:     sessionID,
		Role:          in.Role,
		Body:          in.Body,
		ToolCalls:     callsJSON,
		Proposal:      proposalJSON,
		ProposalState: in.ProposalState,
		InputTokens:   int32(in.InputTokens),
		OutputTokens:  int32(in.OutputTokens),
	})
	if err != nil {
		return model.AgentMessage{}, platform.Internal(err)
	}
	return toAgentMessage(row), nil
}

// ListAgentSessions is the sidebar: this person's conversations, newest first.
func (s *Service) ListAgentSessions(
	ctx context.Context, p *authz.Principal, limit int,
) ([]model.AgentSession, error) {
	if p == nil {
		return nil, platform.Unauthorized("")
	}
	if limit <= 0 || limit > maxAgentSessionsPage {
		limit = maxAgentSessionsPage
	}
	rows, err := s.db.Queries().ListAgentSessionsForUser(ctx, store.ListAgentSessionsForUserParams{
		WorkspaceID: p.WorkspaceID, UserID: p.UserID, Lim: int32(limit),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.AgentSession, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAgentSession(row))
	}
	return out, nil
}

// ListAgentMessages is one transcript, oldest first — both what the screen renders and the
// order the run replays to the model.
func (s *Service) ListAgentMessages(
	ctx context.Context, p *authz.Principal, sessionID uuid.UUID,
) ([]model.AgentMessage, error) {
	if p == nil {
		return nil, platform.Unauthorized("")
	}
	if _, err := s.ownedAgentSession(ctx, s.db.Queries(), p, sessionID); err != nil {
		return nil, err
	}
	rows, err := s.db.Queries().ListAgentMessages(ctx, store.ListAgentMessagesParams{
		SessionID: sessionID, WorkspaceID: p.WorkspaceID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.AgentMessage, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAgentMessage(row))
	}
	return out, nil
}

// DeleteAgentSession removes a conversation and everything in it.
func (s *Service) DeleteAgentSession(
	ctx context.Context, p *authz.Principal, sessionID uuid.UUID,
) (uuid.UUID, int64, error) {
	if p == nil {
		return uuid.Nil, 0, platform.Unauthorized("")
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.ownedAgentSession(ctx, q, p, sessionID); err != nil {
			return err
		}
		id, err := q.DeleteAgentSession(ctx, store.DeleteAgentSessionParams{
			ID: sessionID, WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("agent session")
			}
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "agentSession", EntityID: id, Op: OpDelete,
			Scope: authz.UserScope(p.UserID),
		})
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return sessionID, version, nil
}

// SweepAgentSessions drops conversations past the retention window, and returns runs that
// died mid-turn to the queue.
func (s *Service) SweepAgentSessions(ctx context.Context) (int64, error) {
	stale := time.Now().Add(-agentRunStaleAfter)
	if _, err := s.db.Queries().RequeueStaleAgentSessions(ctx, stale); err != nil {
		return 0, platform.Internal(err)
	}
	cutoff := time.Now().Add(-agentSessionRetention)
	n, err := s.db.Queries().PruneAgentSessions(ctx, cutoff)
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

func (s *Service) ownedAgentSession(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (model.AgentSession, error) {
	row, err := q.GetAgentSession(ctx, store.GetAgentSessionParams{
		ID: id, WorkspaceID: p.WorkspaceID, UserID: p.UserID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			// Not found rather than forbidden: somebody else's conversation must not be
			// distinguishable from one that does not exist.
			return model.AgentSession{}, platform.NotFound("agent session")
		}
		return model.AgentSession{}, platform.Internal(err)
	}
	return toAgentSession(row), nil
}

func validateAgentBody(raw string) (string, error) {
	body := strings.TrimSpace(raw)
	if body == "" {
		return "", platform.Validation("body", "say something for the agent to work on")
	}
	if len(body) > maxAgentMessageLength {
		return "", platform.Validation("body", "that message is too long")
	}
	return body, nil
}

// agentTitleFrom names a conversation after its opening line, because a chat that makes you
// name it before you can use it is a chat nobody starts.
func agentTitleFrom(body string) string {
	title := strings.TrimSpace(strings.SplitN(body, "\n", 2)[0])
	if utf8.RuneCountInString(title) <= maxAgentTitleLength {
		return title
	}
	runes := []rune(title)
	return strings.TrimSpace(string(runes[:maxAgentTitleLength])) + "…"
}

func agentSessionChange(session model.AgentSession) Change {
	return Change{
		EntityType: "agentSession", EntityID: session.ID, Op: OpUpsert,
		Scope: authz.UserScope(session.UserID), Payload: session,
	}
}

func agentMessageChange(userID uuid.UUID, message model.AgentMessage) Change {
	return Change{
		EntityType: "agentMessage", EntityID: message.ID, Op: OpUpsert,
		Scope: authz.UserScope(userID), Payload: message,
	}
}

func toAgentSession(r store.AgentSession) model.AgentSession {
	return model.AgentSession{
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		UserID:      r.UserID,
		Title:       r.Title,
		Status:      r.Status,
		Error:       r.Error,
		Origin:      r.Origin,
		IssueID:     r.IssueID,
		CommentID:   r.CommentID,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func toAgentMessage(r store.AgentMessage) model.AgentMessage {
	out := model.AgentMessage{
		ID:            r.ID,
		WorkspaceID:   r.WorkspaceID,
		SessionID:     r.SessionID,
		Role:          r.Role,
		Body:          r.Body,
		ToolCalls:     []model.AgentToolCall{},
		ProposalState: r.ProposalState,
		InputTokens:   int(r.InputTokens),
		OutputTokens:  int(r.OutputTokens),
		CreatedAt:     r.CreatedAt,
	}
	if len(r.ToolCalls) > 0 {
		// A row whose display JSON will not parse is not worth failing a transcript read
		// over: the turn's text is the part that matters, and the calls are decoration.
		_ = json.Unmarshal(r.ToolCalls, &out.ToolCalls)
		if out.ToolCalls == nil {
			out.ToolCalls = []model.AgentToolCall{}
		}
	}
	if len(r.Proposal) > 0 {
		var proposal model.AgentProposal
		if err := json.Unmarshal(r.Proposal, &proposal); err == nil {
			out.Proposal = &proposal
		}
	}
	return out
}

// GetAgentMessageForOwner reads one turn and the conversation it belongs to, refusing
// anything the caller does not own.
func (s *Service) GetAgentMessageForOwner(
	ctx context.Context, p *authz.Principal, messageID uuid.UUID,
) (model.AgentMessage, model.AgentSession, error) {
	if p == nil {
		return model.AgentMessage{}, model.AgentSession{}, platform.Unauthorized("")
	}
	row, err := s.db.Queries().GetAgentMessage(ctx, store.GetAgentMessageParams{
		ID: messageID, WorkspaceID: p.WorkspaceID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return model.AgentMessage{}, model.AgentSession{}, platform.NotFound("agent message")
		}
		return model.AgentMessage{}, model.AgentSession{}, platform.Internal(err)
	}
	message := toAgentMessage(row)
	session, err := s.ownedAgentSession(ctx, s.db.Queries(), p, message.SessionID)
	if err != nil {
		return model.AgentMessage{}, model.AgentSession{}, err
	}
	return message, session, nil
}

// MarkAgentProposal moves a pending proposal to applied or rejected.
//
// The update is conditional on the row still being pending, so two clicks — or a click and
// a retry — cannot run the same writes twice. A second attempt finds nothing to update and
// is told the decision was already made.
func (s *Service) MarkAgentProposal(
	ctx context.Context, p *authz.Principal, messageID uuid.UUID, state string,
) (model.AgentMessage, int64, error) {
	if state != AgentProposalApplied && state != AgentProposalRejected {
		return model.AgentMessage{}, 0, platform.Validation("state", "a proposal is applied or rejected")
	}
	var out model.AgentMessage
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		message, session, err := s.GetAgentMessageForOwner(ctx, p, messageID)
		if err != nil {
			return err
		}
		if message.Proposal == nil {
			return platform.Validation("messageId", "that turn proposed nothing")
		}
		row, err := q.SetAgentMessageProposalState(ctx, store.SetAgentMessageProposalStateParams{
			ID: messageID, WorkspaceID: p.WorkspaceID, ProposalState: &state,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Conflict("that proposal has already been decided")
			}
			return platform.Internal(err)
		}
		out = toAgentMessage(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(),
			agentMessageChange(session.UserID, out))
		return err
	})
	if err != nil {
		return model.AgentMessage{}, 0, err
	}
	return out, version, nil
}

// AddAgentTurn writes what a run produced: the assistant's turn, and the session's new
// status, in one transaction so a transcript never shows an answer under a session that
// still says it is working.
//
// Called by internal/agent rather than by a resolver, and takes ids rather than a principal
// because the worker runs it with no request behind it.
func (s *Service) AddAgentTurn(
	ctx context.Context,
	workspaceID, sessionID, userID uuid.UUID,
	turn AgentTurn,
) (model.AgentMessage, int64, error) {
	var out model.AgentMessage
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		var err error
		out, err = s.appendAgentMessage(ctx, q, workspaceID, sessionID, appendAgentMessage{
			Role:          AgentRoleAssistant,
			Body:          turn.Body,
			ToolCalls:     turn.ToolCalls,
			Proposal:      turn.Proposal,
			ProposalState: turn.ProposalState,
			InputTokens:   turn.InputTokens,
			OutputTokens:  turn.OutputTokens,
		})
		if err != nil {
			return err
		}
		updated, err := q.UpdateAgentSessionStatus(ctx, store.UpdateAgentSessionStatusParams{
			ID: sessionID, WorkspaceID: workspaceID, Status: turn.Status, Error: turn.Error, Title: "",
		})
		if err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, workspaceID, authz.AppActor(userID),
			agentSessionChange(toAgentSession(updated)), agentMessageChange(userID, out))
		return err
	})
	if err != nil {
		return model.AgentMessage{}, 0, err
	}
	return out, version, nil
}

// AgentTurn is one assistant answer, ready to store.
type AgentTurn struct {
	Body          string
	ToolCalls     []model.AgentToolCall
	Proposal      *model.AgentProposal
	ProposalState *string
	InputTokens   int
	OutputTokens  int
	// Status the session lands in — idle when the answer is complete, failed when the run
	// gave up. Error accompanies failed.
	Status string
	Error  *string
}

// MarkAgentSessionFailed records that a run could not finish. Separate from AddAgentTurn
// because a failure has no assistant turn to show: writing an empty one would put a blank
// bubble in the transcript where the explanation belongs.
func (s *Service) MarkAgentSessionFailed(
	ctx context.Context, workspaceID, sessionID, userID uuid.UUID, reason string,
) error {
	return s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		updated, err := q.UpdateAgentSessionStatus(ctx, store.UpdateAgentSessionStatusParams{
			ID: sessionID, WorkspaceID: workspaceID, Status: AgentSessionFailed, Error: &reason, Title: "",
		})
		if err != nil {
			if store.IsNotFound(err) {
				return nil // the conversation was deleted while its run was in flight
			}
			return platform.Internal(err)
		}
		_, err = s.em.Emit(ctx, q, workspaceID, authz.AppActor(userID),
			agentSessionChange(toAgentSession(updated)))
		return err
	})
}

// StartQueuedAgentRun takes the oldest waiting conversation and marks it working.
// Returns false when the queue is empty, which is the usual answer.
func (s *Service) StartQueuedAgentRun(ctx context.Context) (model.AgentSession, bool, error) {
	row, err := s.db.Queries().ClaimQueuedAgentSession(ctx)
	if err != nil {
		if store.IsNotFound(err) {
			return model.AgentSession{}, false, nil
		}
		return model.AgentSession{}, false, platform.Internal(err)
	}
	return toAgentSession(row), true, nil
}

// ListAgentTurns reads a conversation's turns for a run that has no principal behind it.
func (s *Service) ListAgentTurns(
	ctx context.Context, workspaceID, sessionID uuid.UUID,
) ([]model.AgentMessage, error) {
	rows, err := s.db.Queries().ListAgentMessages(ctx, store.ListAgentMessagesParams{
		SessionID: sessionID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.AgentMessage, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAgentMessage(row))
	}
	return out, nil
}

// AgentDisplayName is the name the agent's own comments are signed with.
const AgentDisplayName = "Polaris"

// EnsureAgentIdentity returns the workspace's agent user, creating it on first use.
//
// The agent needs an identity of its own because a reply it writes must not be signed by
// the person who summoned it: a comment attributed to somebody saying something they did
// not write is a forgery, however useful its contents. kind='app' is the same shape a
// third-party agent gets, and CountWorkspaceSeats excludes it, so this costs no seat.
func (s *Service) EnsureAgentIdentity(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID,
) (uuid.UUID, error) {
	existing, err := q.GetAgentIdentity(ctx, workspaceID)
	if err == nil {
		return existing, nil
	}
	if !store.IsNotFound(err) {
		return uuid.Nil, platform.Internal(err)
	}

	userID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, platform.Internal(err)
	}
	if _, err := q.CreateUser(ctx, store.CreateUserParams{
		ID:          userID,
		WorkspaceID: workspaceID,
		AccountID:   nil,
		Name:        AgentDisplayName,
		DisplayName: AgentDisplayName,
		Timezone:    "UTC",
		Role:        "member",
		Kind:        "app",
	}); err != nil {
		return uuid.Nil, platform.Internal(err)
	}
	// The insert upserts on workspace_id, so two requests racing to be the first mention in
	// a workspace both end up pointing at whichever user row won.
	mapped, err := q.CreateAgentIdentity(ctx, store.CreateAgentIdentityParams{
		WorkspaceID: workspaceID, UserID: userID,
	})
	if err != nil {
		return uuid.Nil, platform.Internal(err)
	}
	return mapped, nil
}

// maybeSummonAgent turns an "@Polaris" in a comment into a queued conversation.
//
// Called from inside CreateComment's transaction so the mention and the run it starts
// commit together: a comment that summoned the agent and a queue that never heard about it
// is a request silently dropped.
func (s *Service) maybeSummonAgent(
	ctx context.Context, q *store.Queries, p *authz.Principal, issue store.GetIssueRow, comment model.Comment,
) error {
	if !s.agentEnabled {
		// Nothing was promised on this deployment, so nothing is owed. Better than queuing
		// a run whose only possible outcome is "no model provider is configured".
		return nil
	}
	// The agent's own replies mention people and quote text. Answering itself is the one
	// loop this feature can produce, so it is cut here rather than depended on elsewhere.
	if p.ActorType == authz.ActorAppUser {
		return nil
	}
	if !mentionsAgent(ctx, q, comment.Body, s, issue.WorkspaceID) {
		return nil
	}

	sessionID, err := uuid.NewV7()
	if err != nil {
		return platform.Internal(err)
	}
	body := strings.TrimSpace(comment.Body)
	row, err := q.CreateAgentSession(ctx, store.CreateAgentSessionParams{
		ID:          sessionID,
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
		Title:       agentTitleFrom(body),
		Status:      AgentSessionQueued,
		Origin:      AgentOriginComment,
		IssueID:     &issue.ID,
		CommentID:   &comment.ID,
	})
	if err != nil {
		return platform.Internal(err)
	}
	session := toAgentSession(row)

	message, err := s.appendAgentMessage(ctx, q, p.WorkspaceID, session.ID, appendAgentMessage{
		Role: AgentRoleUser, Body: body,
	})
	if err != nil {
		return err
	}
	_, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(),
		agentSessionChange(session), agentMessageChange(session.UserID, message))
	return err
}

// mentionsAgent reports whether a comment addressed the agent.
//
// Two ways, because the identity is created lazily: a structured mention of the agent's
// user id once that user exists, and a bare "@polaris" before it does. Without the second,
// the very first mention in a workspace would silently do nothing, which reads as the
// feature being broken rather than as an ordering subtlety.
func mentionsAgent(
	ctx context.Context, q *store.Queries, body string, s *Service, workspaceID uuid.UUID,
) bool {
	if agentID, err := q.GetAgentIdentity(ctx, workspaceID); err == nil {
		for _, id := range notify.ParseMentions(body) {
			if id == agentID {
				return true
			}
		}
	}
	return bareAgentMention.MatchString(body)
}

// Word-bounded so "@polarisation" is not a summons.
var bareAgentMention = regexp.MustCompile(`(?i)@polaris\b`)

// AgentAutoApply reports whether this person has turned the confirmation step off.
func (s *Service) AgentAutoApply(ctx context.Context, userID uuid.UUID) (bool, error) {
	on, err := s.db.Queries().GetAgentPreference(ctx, userID)
	if err != nil {
		if store.IsNotFound(err) {
			// Off by default. The confirmation is the second line of defence against a
			// model talked into something by text it read in an issue, so it is a choice
			// somebody makes rather than one they inherit.
			return false, nil
		}
		return false, platform.Internal(err)
	}
	return on, nil
}

// SetAgentAutoApply turns the confirmation step off, or back on.
func (s *Service) SetAgentAutoApply(
	ctx context.Context, p *authz.Principal, enabled bool,
) (bool, error) {
	if p == nil {
		return false, platform.Unauthorized("")
	}
	on, err := s.db.Queries().SetAgentPreference(ctx, store.SetAgentPreferenceParams{
		UserID: p.UserID, WorkspaceID: p.WorkspaceID, AutoApply: enabled,
	})
	if err != nil {
		return false, platform.Internal(err)
	}
	return on, nil
}

// ResolvePrincipalForUser builds the caller a run acts as, for a run with no request behind
// it. The worker has a user id and nothing else; every tool the run calls still has to be
// checked against that person's own permissions, so it needs a real principal.
func (s *Service) ResolvePrincipalForUser(
	ctx context.Context, workspaceID, userID uuid.UUID,
) (*authz.Principal, error) {
	q := s.db.Queries()
	user, err := q.GetUser(ctx, userID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("user")
		}
		return nil, platform.Internal(err)
	}
	if user.WorkspaceID != workspaceID {
		return nil, platform.NotFound("user")
	}
	if user.Status != "active" {
		// A suspended person's queued run must not keep working on their behalf.
		return nil, platform.Forbidden("this account is suspended")
	}

	memberships, err := q.ListTeamIDsForUser(ctx, user.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	teams := authz.NewTeamSet(memberships...)
	if authz.Role(user.Role) != authz.RoleGuest {
		all, err := q.ListTeamsInWorkspace(ctx, workspaceID)
		if err != nil {
			return nil, platform.Internal(err)
		}
		for _, t := range all {
			if !t.Private {
				teams[t.ID] = struct{}{}
			}
		}
	}
	p := &authz.Principal{
		UserID:         user.ID,
		WorkspaceID:    workspaceID,
		Role:           authz.Role(user.Role),
		Teams:          teams,
		SharedEntities: map[uuid.UUID]struct{}{},
	}
	if user.AccountID != nil {
		p.AccountID = *user.AccountID
	}
	return p, nil
}

// StartAgentRunFor claims one conversation for an interactive run. Returns false when it is
// not waiting — already running, or already answered — which the streaming endpoint reports
// rather than treating as an error.
func (s *Service) StartAgentRunFor(
	ctx context.Context, p *authz.Principal, sessionID uuid.UUID,
) (model.AgentSession, bool, error) {
	if p == nil {
		return model.AgentSession{}, false, platform.Unauthorized("")
	}
	row, err := s.db.Queries().ClaimAgentSessionByID(ctx, store.ClaimAgentSessionByIDParams{
		ID: sessionID, WorkspaceID: p.WorkspaceID, UserID: p.UserID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return model.AgentSession{}, false, nil
		}
		return model.AgentSession{}, false, platform.Internal(err)
	}
	return toAgentSession(row), true, nil
}
