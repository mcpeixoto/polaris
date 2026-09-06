package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateAgentSession_OpensAQueuedConversationTitledAfterTheQuestion(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, message, version, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{
		Body: "Plan the login rework\nand put it in ENG",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Error("a created conversation should mint a version for the client to wait on")
	}
	// Queued, not idle: the caller has asked something, so there is work to do.
	if session.Status != domain.AgentSessionQueued {
		t.Errorf("status %q, want %q", session.Status, domain.AgentSessionQueued)
	}
	if session.Title != "Plan the login rework" {
		t.Errorf("title %q should be the first line of the question", session.Title)
	}
	if session.Origin != domain.AgentOriginChat {
		t.Errorf("origin %q, want chat", session.Origin)
	}
	if message.Role != domain.AgentRoleUser || !strings.HasPrefix(message.Body, "Plan the login rework") {
		t.Errorf("first message is %q by %q", message.Body, message.Role)
	}
}

// The conversation holds what somebody asked and what they were told. A teammate must not
// be able to read it, and must not be able to tell it exists.
func TestAgentSession_IsInvisibleToEverybodyButItsOwner(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{
		Body: "something private",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	otherID := f.NewUser(t, "Other", "admin", true)
	other := f.PrincipalFor(otherID, authz.RoleAdmin, f.TeamID)

	if _, err := svc.ListAgentMessages(ctx, other, session.ID); err == nil {
		t.Fatal("another user read somebody else's agent transcript")
	} else if platform.CodeOf(err) != platform.CodeNotFound {
		// Not "forbidden": that answer confirms the conversation exists.
		t.Errorf("error code %v, want not-found", platform.CodeOf(err))
	}

	sessions, err := svc.ListAgentSessions(ctx, other, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("another user's session list has %d rows, want 0", len(sessions))
	}
}

func TestCreateAgentSession_GuestsAreRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	guestID := f.NewUser(t, "Guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	_, _, _, err := svc.CreateAgentSession(ctx, guest, domain.CreateAgentSessionInput{Body: "hello"})
	if err == nil {
		t.Fatal("a guest opened an agent conversation")
	}
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Errorf("error code %v, want forbidden", platform.CodeOf(err))
	}
}

// Two questions at once would interleave two runs over one transcript, and the model would
// answer the pair as though they had been asked together.
func TestSendAgentMessage_RefusedWhileARunIsInFlight(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "first"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// The session is queued from creation, which is already "in flight".
	if _, _, err := svc.SendAgentMessage(ctx, f.Principal(), session.ID, "second"); err == nil {
		t.Fatal("a second question was accepted while the first was still queued")
	} else if platform.CodeOf(err) != platform.CodeConflict {
		t.Errorf("error code %v, want conflict", platform.CodeOf(err))
	}

	// Once the run lands, the follow-up is allowed.
	if _, _, err := svc.AddAgentTurn(ctx, f.WorkspaceID, session.ID, f.UserID, domain.AgentTurn{
		Body: "done", Status: domain.AgentSessionIdle,
	}); err != nil {
		t.Fatalf("record turn: %v", err)
	}
	if _, _, err := svc.SendAgentMessage(ctx, f.Principal(), session.ID, "second"); err != nil {
		t.Fatalf("follow-up after the run finished: %v", err)
	}
}

func TestAddAgentTurn_StoresTheAnswerAndMovesTheSession(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "q"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	pending := domain.AgentProposalPending
	if _, _, err := svc.AddAgentTurn(ctx, f.WorkspaceID, session.ID, f.UserID, domain.AgentTurn{
		Body:      "Here is what I would do.",
		ToolCalls: []model.AgentToolCall{{Name: "list_issues", Summary: "read 3 issues"}},
		Proposal: &model.AgentProposal{
			Summary: "Create one issue",
			Steps: []model.AgentProposalStep{{
				Tool: "create_issue", Description: "Create ENG issue",
				Arguments: map[string]any{"title": "Fix login", "team": f.TeamKey},
			}},
		},
		ProposalState: &pending,
		InputTokens:   120, OutputTokens: 45,
		Status: domain.AgentSessionIdle,
	}); err != nil {
		t.Fatalf("record: %v", err)
	}

	messages, err := svc.ListAgentMessages(ctx, f.Principal(), session.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("transcript has %d turns, want the question and the answer", len(messages))
	}
	answer := messages[1]
	if answer.Role != domain.AgentRoleAssistant {
		t.Errorf("second turn is %q", answer.Role)
	}
	if answer.Proposal == nil || len(answer.Proposal.Steps) != 1 {
		t.Fatalf("the proposal did not survive the round trip: %+v", answer.Proposal)
	}
	if got := answer.Proposal.Steps[0].Arguments["title"]; got != "Fix login" {
		t.Errorf("step arguments lost in storage: %v", answer.Proposal.Steps[0].Arguments)
	}
	// Usage is what a later slice bills against, so it has to survive storage exactly.
	if answer.InputTokens != 120 || answer.OutputTokens != 45 {
		t.Errorf("usage stored as %d/%d, want 120/45", answer.InputTokens, answer.OutputTokens)
	}
	if len(answer.ToolCalls) != 1 || answer.ToolCalls[0].Name != "list_issues" {
		t.Errorf("tool calls lost: %+v", answer.ToolCalls)
	}

	sessions, err := svc.ListAgentSessions(ctx, f.Principal(), 0)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(sessions) != 1 || sessions[0].Status != domain.AgentSessionIdle {
		t.Errorf("session did not settle to idle: %+v", sessions)
	}
}

// A proposal is single-shot. Two clicks, or a click and a retry, must not run the writes
// twice — that is the difference between one issue and two.
func TestMarkAgentProposal_IsSingleShot(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "q"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	pending := domain.AgentProposalPending
	turn, _, err := svc.AddAgentTurn(ctx, f.WorkspaceID, session.ID, f.UserID, domain.AgentTurn{
		Body: "plan",
		Proposal: &model.AgentProposal{Summary: "do it", Steps: []model.AgentProposalStep{
			{Tool: "create_issue", Description: "one"},
		}},
		ProposalState: &pending,
		Status:        domain.AgentSessionIdle,
	})
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	applied, _, err := svc.MarkAgentProposal(ctx, f.Principal(), turn.ID, domain.AgentProposalApplied)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if applied.ProposalState == nil || *applied.ProposalState != domain.AgentProposalApplied {
		t.Fatalf("state is %v, want applied", applied.ProposalState)
	}

	if _, _, err := svc.MarkAgentProposal(ctx, f.Principal(), turn.ID, domain.AgentProposalApplied); err == nil {
		t.Fatal("the same proposal was applied twice")
	} else if platform.CodeOf(err) != platform.CodeConflict {
		t.Errorf("error code %v, want conflict", platform.CodeOf(err))
	}
}

func TestDeleteAgentSession_TakesTheTranscriptWithIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "q"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := svc.DeleteAgentSession(ctx, f.Principal(), session.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.ListAgentMessages(ctx, f.Principal(), session.ID); err == nil {
		t.Fatal("the transcript outlived the conversation")
	}

	var n int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM agent_message WHERE session_id = $1`, session.ID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("%d messages survived the delete", n)
	}
}

// A run whose process died leaves its session in `working`, where it renders as busy
// forever. The sweep is what returns it to the queue.
func TestSweepAgentSessions_RequeuesARunThatDiedMidTurn(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "q"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	claimed, ok, err := svc.StartQueuedAgentRun(ctx)
	if err != nil || !ok {
		t.Fatalf("claim: %v ok=%v", err, ok)
	}
	if claimed.ID != session.ID || claimed.Status != domain.AgentSessionWorking {
		t.Fatalf("claimed %v with status %q", claimed.ID, claimed.Status)
	}
	// Nothing else is waiting.
	if _, ok, err := svc.StartQueuedAgentRun(ctx); err != nil || ok {
		t.Fatalf("a second claim found work: ok=%v err=%v", ok, err)
	}

	if _, err := db.Pool().Exec(ctx,
		`UPDATE agent_session SET updated_at = now() - interval '1 hour' WHERE id = $1`, session.ID); err != nil {
		t.Fatalf("age the run: %v", err)
	}
	if _, err := svc.SweepAgentSessions(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if _, ok, err := svc.StartQueuedAgentRun(ctx); err != nil || !ok {
		t.Fatalf("the stale run was not returned to the queue: ok=%v err=%v", ok, err)
	}
}

// Naming the agent in a comment is how it gets summoned onto an issue.
func TestCreateComment_MentioningTheAgentQueuesARun(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.SetAgentEnabled(true)
	ctx := context.Background()

	issueID := f.NewIssue(t, "Login is broken")
	if _, _, err := svc.CreateComment(ctx, f.Principal(), domain.CreateCommentInput{
		IssueID: issueID, Body: "@polaris can you work out what changed here?",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}

	sessions, err := svc.ListAgentSessions(ctx, f.Principal(), 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("the mention queued %d runs, want 1", len(sessions))
	}
	if sessions[0].Origin != domain.AgentOriginComment {
		t.Errorf("origin %q, want comment", sessions[0].Origin)
	}
	if sessions[0].IssueID == nil || *sessions[0].IssueID != issueID {
		t.Errorf("the run does not carry the issue it was summoned onto: %+v", sessions[0].IssueID)
	}
	if sessions[0].Status != domain.AgentSessionQueued {
		t.Errorf("status %q, want queued", sessions[0].Status)
	}
}

// On a deployment with no provider configured the mention is not a trigger: queuing a run
// whose only possible outcome is "not configured" is worse than doing nothing.
func TestCreateComment_MentionDoesNothingWhenTheAgentIsOff(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	issueID := f.NewIssue(t, "Login is broken")
	if _, _, err := svc.CreateComment(ctx, f.Principal(), domain.CreateCommentInput{
		IssueID: issueID, Body: "@polaris look at this",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	sessions, err := svc.ListAgentSessions(ctx, f.Principal(), 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("a disabled agent queued %d runs", len(sessions))
	}
}

// The agent's replies quote text and name people. Answering itself is the one loop this
// feature can produce.
func TestCreateComment_TheAgentDoesNotSummonItself(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.SetAgentEnabled(true)
	ctx := context.Background()

	issueID := f.NewIssue(t, "Login is broken")
	agentish := f.PrincipalFor(f.NewUser(t, "Polaris", "member", true), authz.RoleMember, f.TeamID)
	agentish.ActorType = authz.ActorAppUser

	if _, _, err := svc.CreateComment(ctx, agentish, domain.CreateCommentInput{
		IssueID: issueID, Body: "@polaris here is what I found",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	sessions, err := svc.ListAgentSessions(ctx, agentish, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("the agent answered its own comment: %d runs queued", len(sessions))
	}
}

func TestMentionsAgent_WordBoundary(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.SetAgentEnabled(true)
	ctx := context.Background()

	issueID := f.NewIssue(t, "Climate")
	// "@polarisation" is not a summons.
	if _, _, err := svc.CreateComment(ctx, f.Principal(), domain.CreateCommentInput{
		IssueID: issueID, Body: "see the notes on @polarisation effects",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	sessions, err := svc.ListAgentSessions(ctx, f.Principal(), 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("a word merely starting with polaris summoned the agent")
	}
}
