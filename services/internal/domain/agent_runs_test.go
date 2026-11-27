package domain_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestStartDueDelegatedRun_OpensASessionForTheBuiltinAgent(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	withDelay(t, -time.Minute)

	agent := builtinAgent(t, svc, f)
	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Write the notes", Description: "Cover the empty state.",
		DelegateID: &agent,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := svc.StartDueDelegatedRun(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}

	runs := listRuns(t, db, issue.ID)
	if len(runs) != 1 {
		t.Fatalf("runs = %d, want 1", len(runs))
	}
	if runs[0].Status != "running" {
		t.Fatalf("run status = %q, want running", runs[0].Status)
	}
	if runs[0].SessionRef == nil || *runs[0].SessionRef == "" {
		t.Fatal("running run has no session")
	}

	sessions, err := db.Queries().ListAgentSessionsForUser(ctx, store.ListAgentSessionsForUserParams{
		WorkspaceID: f.WorkspaceID, UserID: f.UserID, Lim: 10,
	})
	if err != nil {
		t.Fatalf("sessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions = %d, want the one delegation opened", len(sessions))
	}
	session := sessions[0]
	if session.Origin != domain.AgentOriginDelegation {
		t.Fatalf("origin = %q, want delegation", session.Origin)
	}
	if session.IssueID == nil || *session.IssueID != issue.ID {
		t.Fatalf("session issue = %v, want %s", session.IssueID, issue.ID)
	}
	if session.UserID != f.UserID {
		t.Fatalf("session owner = %s, want the person who delegated", session.UserID)
	}
	if session.Status != domain.AgentSessionQueued {
		t.Fatalf("session status = %q, want queued for the model runner", session.Status)
	}
	if session.ID.String() != *runs[0].SessionRef {
		t.Fatalf("session %s is not the run's session_ref %s", session.ID, *runs[0].SessionRef)
	}

	messages, err := db.Queries().ListAgentMessages(ctx, store.ListAgentMessagesParams{
		SessionID: session.ID, WorkspaceID: f.WorkspaceID,
	})
	if err != nil {
		t.Fatalf("messages: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("messages = %d, want the opening one", len(messages))
	}
	body := messages[0].Body
	for _, want := range []string{issue.Identifier, issue.Title, "Cover the empty state.", "propose changes"} {
		if !strings.Contains(body, want) {
			t.Fatalf("opening message %q does not contain %q", body, want)
		}
	}
}

func TestStartDueDelegatedRun_LeavesARunThatIsNotDueYet(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	withDelay(t, time.Hour)

	agent := builtinAgent(t, svc, f)
	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Not yet", DelegateID: &agent,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := svc.StartDueDelegatedRun(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}

	runs := listRuns(t, db, issue.ID)
	if len(runs) != 1 || runs[0].Status != "queued" {
		t.Fatalf("runs = %+v, want the one run still queued", runs)
	}
	if runs[0].SessionRef != nil {
		t.Fatalf("session_ref = %v, want none before the run is due", runs[0].SessionRef)
	}
	sessions, err := db.Queries().ListAgentSessionsForUser(ctx, store.ListAgentSessionsForUserParams{
		WorkspaceID: f.WorkspaceID, UserID: f.UserID, Lim: 10,
	})
	if err != nil {
		t.Fatalf("sessions: %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("sessions = %d, want none", len(sessions))
	}
}

func TestStartDueDelegatedRun_LeavesARunForAnotherAppUser(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	withDelay(t, -time.Minute)

	// The built-in identity exists, so the claim has something to join against and the
	// miss is about this run's agent, not about the workspace having no agent at all.
	_ = builtinAgent(t, svc, f)
	other := newAppUser(t, f, "Outside")
	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Theirs", DelegateID: &other,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := svc.StartDueDelegatedRun(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}

	runs := listRuns(t, db, issue.ID)
	if len(runs) != 1 || runs[0].Status != "queued" || runs[0].AgentUserID != other {
		t.Fatalf("runs = %+v, want the other agent's run still queued", runs)
	}
}

func TestRequeueStaleAgentRuns_ReturnsASilentRunToTheQueue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	agent := newAppUser(t, f, "Helper")
	issueID := f.NewIssue(t, "Stuck")
	runID := uuid.Must(uuid.NewV7())
	if _, err := db.Queries().InsertAgentRun(ctx, store.InsertAgentRunParams{
		ID: runID, WorkspaceID: f.WorkspaceID, IssueID: issueID,
		AgentUserID: agent, DelegatedBy: &f.UserID, RunAfter: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatalf("insert run: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `
		UPDATE agent_run
		SET status = 'running', claimed_at = now() - interval '10 minutes',
		    heartbeat_at = now() - interval '10 minutes', session_ref = 'resume-1'
		WHERE id = $1`, runID); err != nil {
		t.Fatalf("age the run: %v", err)
	}

	n, err := svc.RequeueStaleAgentRuns(ctx, 5*time.Minute)
	if err != nil {
		t.Fatalf("requeue: %v", err)
	}
	if n != 1 {
		t.Fatalf("requeued %d, want 1", n)
	}
	runs := listRuns(t, db, issueID)
	if len(runs) != 1 || runs[0].Status != "queued" {
		t.Fatalf("runs = %+v, want the stale run queued again", runs)
	}
	if runs[0].SessionRef == nil || *runs[0].SessionRef != "resume-1" {
		t.Fatalf("session_ref = %v, want the resume handle kept for the next claim", runs[0].SessionRef)
	}
}

// The built-in agent never heartbeats: its run is answered by an agent_session, which has
// its own sweep. Requeuing it would open a second session for one delegation.
func TestRequeueStaleAgentRuns_LeavesTheBuiltinAgentsRunsAlone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	agent := builtinAgent(t, svc, f)
	issueID := f.NewIssue(t, "Long think")
	runID := uuid.Must(uuid.NewV7())
	if _, err := db.Queries().InsertAgentRun(ctx, store.InsertAgentRunParams{
		ID: runID, WorkspaceID: f.WorkspaceID, IssueID: issueID,
		AgentUserID: agent, DelegatedBy: &f.UserID, RunAfter: time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatalf("insert run: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `
		UPDATE agent_run
		SET status = 'running', claimed_at = now() - interval '10 minutes',
		    heartbeat_at = now() - interval '10 minutes'
		WHERE id = $1`, runID); err != nil {
		t.Fatalf("age the run: %v", err)
	}

	n, err := svc.RequeueStaleAgentRuns(ctx, 5*time.Minute)
	if err != nil {
		t.Fatalf("requeue: %v", err)
	}
	if n != 0 {
		t.Fatalf("requeued %d, want 0", n)
	}
	if runs := listRuns(t, db, issueID); len(runs) != 1 || runs[0].Status != "running" {
		t.Fatalf("runs = %+v, want the built-in run left running", runs)
	}
}

func builtinAgent(t *testing.T, svc *domain.Service, f *testutil.Fixture) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := f.DB.InTx(context.Background(), func(ctx context.Context, q *store.Queries) error {
		var err error
		id, err = svc.EnsureAgentIdentity(ctx, q, f.WorkspaceID)
		return err
	})
	if err != nil {
		t.Fatalf("ensure agent identity: %v", err)
	}
	return id
}

func withDelay(t *testing.T, d time.Duration) {
	t.Helper()
	prev := domain.DelegationDelay
	domain.DelegationDelay = d
	t.Cleanup(func() { domain.DelegationDelay = prev })
}
