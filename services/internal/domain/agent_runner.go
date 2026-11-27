package domain

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// runnerCommentLimit is how much of an issue's thread a claim hands the runner.
// Older than that, the runner is re-reading history it will not act on, and the
// payload stops being something a poll wants to carry.
const runnerCommentLimit = 50

// runnerVersionMax is how much of a runner's self-reported version is kept.
// The column is what the online dot's tooltip can show; a build string past this
// is a client bug, and storing it whole would let a poll write an unbounded row.
const runnerVersionMax = 128

// RunnerClaim is the body of a successful POST /runner/v1/claim.
//
// The JSON names are that route's contract. Nothing else in the product decodes them:
// the sync stream does not carry a run, and GraphQL does not return one.
type RunnerClaim struct {
	Run   RunnerClaimRun   `json:"run"`
	Issue RunnerClaimIssue `json:"issue"`
}

// RunnerClaimRun is the queue row the runner now holds, plus the resume handle from
// a previous attempt when this run was put back after a missed heartbeat.
type RunnerClaimRun struct {
	ID         uuid.UUID `json:"id"`
	SessionRef *string   `json:"sessionRef"`
}

// RunnerClaimIssue is the issue as the app user is allowed to see it.
type RunnerClaimIssue struct {
	ID          uuid.UUID            `json:"id"`
	Identifier  string               `json:"identifier"`
	Title       string               `json:"title"`
	Description string               `json:"description"`
	URL         string               `json:"url"`
	Team        RunnerClaimTeam      `json:"team"`
	State       RunnerClaimState     `json:"state"`
	Priority    int                  `json:"priority"`
	Comments    []RunnerClaimComment `json:"comments"`
}

// RunnerClaimTeam is the key the identifier is built from and the name people say.
type RunnerClaimTeam struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// RunnerClaimState is the workflow status. Type is the category (unstarted, started,
// completed, …) because a name alone does not tell an agent whether the work is done.
type RunnerClaimState struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// RunnerClaimComment is one comment, oldest first within the window the claim returns.
type RunnerClaimComment struct {
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

// FinishRunnerInput is how a runner reports that it stopped.
type FinishRunnerInput struct {
	Status       string
	Summary      string
	Error        string
	SessionRef   string
	InputTokens  int64
	OutputTokens int64
}

// StartRunnerClaim records that this runner is polling and takes its oldest due run.
//
// A nil claim is "nothing to do": the queue was empty, or the issue the run pointed at
// is no longer readable by this app. The latter is marked failed here, with a reason,
// so the queue does not hand the same invisible issue out on every poll.
func (s *Service) StartRunnerClaim(ctx context.Context, p *authz.Principal, version string) (*RunnerClaim, error) {
	if err := requireRunner(p); err != nil {
		return nil, err
	}

	var claim *RunnerClaim
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := q.UpsertAgentRunner(ctx, store.UpsertAgentRunnerParams{
			AgentUserID: p.UserID,
			WorkspaceID: p.WorkspaceID,
			Version:     clipRunnerVersion(version),
		}); err != nil {
			return platform.Internal(err)
		}

		run, err := q.ClaimDueAgentRun(ctx, p.UserID)
		if err != nil {
			if store.IsNotFound(err) {
				return nil
			}
			return platform.Internal(err)
		}
		if run.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("run")
		}

		issue, err := s.GetIssue(ctx, p, run.IssueID)
		if err != nil {
			if platform.CodeOf(err) == platform.CodeNotFound {
				// COPY: the delegated issue is not visible to this agent
				msg := "the delegated issue is not visible to this agent"
				if _, ferr := q.MarkAgentRunFailed(ctx, store.MarkAgentRunFailedParams{
					ID: run.ID, Error: &msg,
				}); ferr != nil && !store.IsNotFound(ferr) {
					return platform.Internal(ferr)
				}
				return nil
			}
			return err
		}

		team, err := q.GetTeam(ctx, issue.TeamID)
		if err != nil {
			return platform.Internal(err)
		}
		state, err := q.GetWorkflowState(ctx, issue.StateID)
		if err != nil {
			return platform.Internal(err)
		}
		comments, err := s.ListComments(ctx, p, issue.ID)
		if err != nil {
			return err
		}
		if len(comments) > runnerCommentLimit {
			comments = comments[len(comments)-runnerCommentLimit:]
		}

		names := map[uuid.UUID]string{}
		out := make([]RunnerClaimComment, 0, len(comments))
		for _, c := range comments {
			out = append(out, RunnerClaimComment{
				Author:    runnerCommentAuthor(ctx, q, c.Actor.ID, names),
				Body:      c.Body,
				CreatedAt: c.CreatedAt,
			})
		}

		claim = &RunnerClaim{
			Run: RunnerClaimRun{ID: run.ID, SessionRef: run.SessionRef},
			Issue: RunnerClaimIssue{
				ID:          issue.ID,
				Identifier:  issue.Identifier,
				Title:       issue.Title,
				Description: issue.Description,
				URL:         issueURL(s.PublicURL, issue.Identifier),
				Team:        RunnerClaimTeam{Key: team.Key, Name: team.Name},
				State:       RunnerClaimState{Name: state.Name, Type: state.Category},
				Priority:    issue.Priority,
				Comments:    out,
			},
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return claim, nil
}

// MarkRunnerHeartbeat records that the runner is still working this run, and moves
// the first one from claimed to running.
func (s *Service) MarkRunnerHeartbeat(ctx context.Context, p *authz.Principal, runID uuid.UUID) error {
	_, err := s.touchRunnerRun(ctx, p, runID)
	return err
}

// CreateRunnerComment posts a comment as the agent and counts as a heartbeat.
//
// The comment goes through the ordinary write, so subscriptions and notifications fire
// the same way they would if a person had typed it. The agent is a user; this is that
// user talking.
func (s *Service) CreateRunnerComment(ctx context.Context, p *authz.Principal, runID uuid.UUID, body string) error {
	run, err := s.touchRunnerRun(ctx, p, runID)
	if err != nil {
		return err
	}
	_, _, err = s.CreateComment(ctx, p, CreateCommentInput{IssueID: run.IssueID, Body: body})
	return err
}

// MarkRunnerFinished records a done or failed outcome.
//
// A done run whose summary is non-empty, and that posted no comment of its own while it
// held the issue, leaves the summary as a comment. A runner that already said what it
// did should not say it twice; a runner that only reports at the end still has to leave
// something on the issue, which is where a person looks.
func (s *Service) MarkRunnerFinished(ctx context.Context, p *authz.Principal, runID uuid.UUID, in FinishRunnerInput) error {
	switch in.Status {
	case "done", "failed":
	default:
		// COPY: a run finishes as done or failed
		return platform.Validation("status", "a run finishes as done or failed")
	}
	if in.InputTokens < 0 || in.OutputTokens < 0 {
		// COPY: token counts cannot be negative
		return platform.Validation("inputTokens", "token counts cannot be negative")
	}

	run, err := s.touchRunnerRun(ctx, p, runID)
	if err != nil {
		return err
	}

	summary := truncateRunSummary(strings.TrimSpace(in.Summary))
	var summaryPtr *string
	if summary != "" {
		summaryPtr = &summary
	}
	var ref *string
	if handle := strings.TrimSpace(in.SessionRef); handle != "" {
		ref = &handle
	}
	var errText *string
	if msg := truncateRunSummary(strings.TrimSpace(in.Error)); msg != "" {
		errText = &msg
	}

	if in.Status == "done" && summaryPtr != nil {
		if err := s.postRunnerSummary(ctx, p, run, summary); err != nil && platform.CodeOf(err) != platform.CodeNotFound {
			return err
		}
	}

	switch in.Status {
	case "done":
		_, err = s.db.Queries().MarkAgentRunDone(ctx, store.MarkAgentRunDoneParams{
			ID:           run.ID,
			Summary:      summaryPtr,
			SessionRef:   ref,
			InputTokens:  in.InputTokens,
			OutputTokens: in.OutputTokens,
		})
	default:
		_, err = s.db.Queries().MarkAgentRunFailed(ctx, store.MarkAgentRunFailedParams{
			ID:           run.ID,
			Summary:      summaryPtr,
			Error:        errText,
			SessionRef:   ref,
			InputTokens:  in.InputTokens,
			OutputTokens: in.OutputTokens,
		})
	}
	if err != nil {
		if store.IsNotFound(err) {
			// COPY: this run was cancelled
			return platform.Conflict("this run was cancelled")
		}
		return platform.Internal(err)
	}
	return nil
}

// GetAgentLastSeen is when this app user's runner last polled.
//
// Null for a person, and for an agent that has never called. The row is written by
// the claim route; this only reads it, and only for a user the caller may already see.
func (s *Service) GetAgentLastSeen(ctx context.Context, p *authz.Principal, userID uuid.UUID) (*time.Time, error) {
	if p == nil {
		return nil, platform.Unauthorized("")
	}
	user, err := s.GetUser(ctx, p, userID)
	if err != nil {
		return nil, err
	}
	if user.Kind != "app" {
		return nil, nil
	}
	row, err := s.db.Queries().GetAgentRunner(ctx, userID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return nil, nil
	}
	seen := row.LastSeenAt
	return &seen, nil
}

func (s *Service) touchRunnerRun(ctx context.Context, p *authz.Principal, runID uuid.UUID) (store.AgentRun, error) {
	if err := requireRunner(p); err != nil {
		return store.AgentRun{}, err
	}
	run, err := s.db.Queries().HeartbeatAgentRun(ctx, store.HeartbeatAgentRunParams{
		ID: runID, AgentUserID: p.UserID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return store.AgentRun{}, platform.NotFound("run")
		}
		return store.AgentRun{}, platform.Internal(err)
	}
	if run.WorkspaceID != p.WorkspaceID {
		return store.AgentRun{}, platform.NotFound("run")
	}
	if err := runnerRunActive(run); err != nil {
		return store.AgentRun{}, err
	}
	return run, nil
}

func (s *Service) postRunnerSummary(ctx context.Context, p *authz.Principal, run store.AgentRun, summary string) error {
	comments, err := s.ListComments(ctx, p, run.IssueID)
	if err != nil {
		return err
	}
	if runnerCommentedSince(comments, p.UserID, runnerSince(run)) {
		return nil
	}
	_, _, err = s.CreateComment(ctx, p, CreateCommentInput{IssueID: run.IssueID, Body: summary})
	return err
}

func requireRunner(p *authz.Principal) error {
	if p == nil || p.ActorType != authz.ActorAppUser {
		// COPY: only an installed app can run delegated work
		return platform.Forbidden("only an installed app can run delegated work")
	}
	return nil
}

func runnerRunActive(run store.AgentRun) error {
	switch run.Status {
	case "running":
		return nil
	case "cancelled":
		// COPY: this run was cancelled
		return platform.Conflict("this run was cancelled")
	default:
		// COPY: this run is already finished
		return platform.Conflict("this run is already finished")
	}
}

func runnerSince(run store.AgentRun) time.Time {
	if run.ClaimedAt != nil {
		return *run.ClaimedAt
	}
	return run.CreatedAt
}

func runnerCommentedSince(comments []model.Comment, agent uuid.UUID, since time.Time) bool {
	for _, c := range comments {
		if c.Actor.ID == nil || *c.Actor.ID != agent {
			continue
		}
		if !c.CreatedAt.Before(since) {
			return true
		}
	}
	return false
}

func runnerCommentAuthor(ctx context.Context, q *store.Queries, id *uuid.UUID, cache map[uuid.UUID]string) string {
	if id == nil {
		return ""
	}
	if name, ok := cache[*id]; ok {
		return name
	}
	name := ""
	if u, err := q.GetUser(ctx, *id); err == nil {
		name = u.DisplayName
		if name == "" {
			name = u.Name
		}
	}
	cache[*id] = name
	return name
}

func clipRunnerVersion(v string) string {
	v = strings.TrimSpace(v)
	if len(v) <= runnerVersionMax {
		return v
	}
	cut := runnerVersionMax
	for cut > 0 && !utf8.RuneStart(v[cut]) {
		cut--
	}
	return v[:cut]
}
