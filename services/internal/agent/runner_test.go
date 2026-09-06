package agent_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/agent"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/llm"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The property the whole design rests on: a run does not write. A model that calls
// create_issue gets a proposal, and the issue does not exist until somebody approves it.
func TestRun_AWriteToolBecomesAProposalRatherThanAWrite(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	provider := llm.NewFake(
		llm.ToolUseResponse("t1", "create_issue", map[string]any{
			"title": "Fix the login redirect", "team": f.TeamKey,
		}),
		llm.TextResponse("I have prepared one issue for you to approve."),
	)
	runner := agent.NewRunner(svc, provider)

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{
		Body: "create an issue for the login redirect bug",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if err := runner.Run(ctx, session, nil); err != nil {
		t.Fatalf("run: %v", err)
	}

	messages, err := svc.ListAgentMessages(ctx, f.Principal(), session.ID)
	if err != nil {
		t.Fatalf("transcript: %v", err)
	}
	answer := messages[len(messages)-1]
	if answer.Proposal == nil {
		t.Fatal("the write did not become a proposal")
	}
	if len(answer.Proposal.Steps) != 1 || answer.Proposal.Steps[0].Tool != "create_issue" {
		t.Fatalf("proposal steps: %+v", answer.Proposal.Steps)
	}
	if answer.ProposalState == nil || *answer.ProposalState != domain.AgentProposalPending {
		t.Fatalf("proposal state %v, want pending", answer.ProposalState)
	}

	// Nothing was created.
	var n int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM issue WHERE title = $1`, "Fix the login redirect").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("the run created %d issues before anybody approved anything", n)
	}

	// And the model was told so, rather than being left to report the work as done.
	reqs := provider.Requests()
	if len(reqs) < 2 {
		t.Fatalf("provider saw %d requests, want the call and the continuation", len(reqs))
	}
	var toolResult string
	for _, block := range reqs[1].Messages[len(reqs[1].Messages)-1].Content {
		if block.Type == llm.BlockToolResult {
			toolResult = block.Content
		}
	}
	if !strings.Contains(toolResult, "NOT been carried out") {
		t.Errorf("the tool result did not tell the model the write is pending: %q", toolResult)
	}
}

// Approval is what writes. This is the other half of the same property.
func TestApplyProposal_CarriesOutTheStepsAsTheApprover(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	runner := agent.NewRunner(svc, llm.NewFake(
		llm.ToolUseResponse("t1", "create_issue", map[string]any{
			"title": "Fix the login redirect", "team": f.TeamKey,
		}),
		llm.TextResponse("Ready when you are."),
	))
	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "go"})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if err := runner.Run(ctx, session, nil); err != nil {
		t.Fatalf("run: %v", err)
	}
	messages, err := svc.ListAgentMessages(ctx, f.Principal(), session.ID)
	if err != nil {
		t.Fatalf("transcript: %v", err)
	}
	turn := messages[len(messages)-1]

	exec := agent.NewExecutor(svc)
	applied, lines, _, err := exec.ApplyProposal(ctx, f.Principal(), turn.ID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if applied.ProposalState == nil || *applied.ProposalState != domain.AgentProposalApplied {
		t.Fatalf("state %v, want applied", applied.ProposalState)
	}
	if len(lines) != 1 {
		t.Errorf("applied lines: %+v", lines)
	}

	var n int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM issue WHERE title = $1`, "Fix the login redirect").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("approval created %d issues, want 1", n)
	}

	// Approving twice must not create it twice.
	if _, _, _, err := exec.ApplyProposal(ctx, f.Principal(), turn.ID); err == nil {
		t.Fatal("the same proposal was applied twice")
	}
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM issue WHERE title = $1`, "Fix the login redirect").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("a second approval created a duplicate: %d issues", n)
	}
}

func TestRun_ReadToolsRunImmediately(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.NewIssue(t, "An existing issue")
	provider := llm.NewFake(
		llm.ToolUseResponse("t1", "list_issues", map[string]any{"team": f.TeamKey}),
		llm.TextResponse("There is one issue open."),
	)
	runner := agent.NewRunner(svc, provider)

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{
		Body: "what is open?",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := runner.Run(ctx, session, nil); err != nil {
		t.Fatalf("run: %v", err)
	}

	messages, _ := svc.ListAgentMessages(ctx, f.Principal(), session.ID)
	answer := messages[len(messages)-1]
	if answer.Proposal != nil {
		t.Error("a read produced a proposal")
	}
	if len(answer.ToolCalls) != 1 || answer.ToolCalls[0].Name != "list_issues" {
		t.Fatalf("tool calls: %+v", answer.ToolCalls)
	}
	if answer.ToolCalls[0].IsError {
		t.Errorf("the read failed: %s", answer.ToolCalls[0].Summary)
	}
	if answer.Body != "There is one issue open." {
		t.Errorf("answer %q", answer.Body)
	}
}

// With auto-apply on there is no confirmation step, which is the point of the mode.
func TestRun_AutoApplyCarriesTheProposalOutImmediately(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	if _, err := svc.SetAgentAutoApply(ctx, f.Principal(), true); err != nil {
		t.Fatalf("set preference: %v", err)
	}
	runner := agent.NewRunner(svc, llm.NewFake(
		llm.ToolUseResponse("t1", "create_issue", map[string]any{
			"title": "Auto applied", "team": f.TeamKey,
		}),
		llm.TextResponse("Done."),
	))
	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "go"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := runner.Run(ctx, session, nil); err != nil {
		t.Fatalf("run: %v", err)
	}

	var n int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM issue WHERE title = $1`, "Auto applied").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("auto-apply created %d issues, want 1", n)
	}
	messages, _ := svc.ListAgentMessages(ctx, f.Principal(), session.ID)
	turn := messages[len(messages)-1]
	if turn.ProposalState == nil || *turn.ProposalState != domain.AgentProposalApplied {
		t.Errorf("state %v, want applied", turn.ProposalState)
	}
}

// A run acts with the asker's permissions and no more. A tool reaching a team they cannot
// see must fail as it would for them.
func TestRun_ActsWithTheAskersPermissionsOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// A private team the asker is not a member of. The fixture's own team is public, and
	// a public team is visible to every non-guest — which is the product working, not a
	// permission to test against.
	secret, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "SEC", Name: "Security", Timezone: "UTC", Private: true,
	})
	if err != nil {
		t.Fatalf("create private team: %v", err)
	}

	outsiderID := f.NewUser(t, "Outsider", "member", false)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember)

	session, _, _, err := svc.CreateAgentSession(ctx, outsider, domain.CreateAgentSessionInput{
		Body: "list the issues in that team",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	runner := agent.NewRunner(svc, llm.NewFake(
		llm.ToolUseResponse("t1", "list_issues", map[string]any{"team": secret.Key}),
		llm.TextResponse("I could not see that team."),
	))
	if err := runner.Run(ctx, session, nil); err != nil {
		t.Fatalf("run: %v", err)
	}

	messages, err := svc.ListAgentMessages(ctx, outsider, session.ID)
	if err != nil {
		t.Fatalf("transcript: %v", err)
	}
	answer := messages[len(messages)-1]
	if len(answer.ToolCalls) != 1 || !answer.ToolCalls[0].IsError {
		t.Fatalf("a tool reached a team the asker cannot see: %+v", answer.ToolCalls)
	}
}

// A provider that is not configured must produce an explanation on the session, not a
// silent failure: the session is the only place the person who asked will look.
func TestRun_WithoutAProviderFailsTheSessionWithAReason(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "hi"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	runner := agent.NewRunner(svc, nil)
	if err := runner.Run(ctx, session, nil); err != nil {
		t.Fatalf("run: %v", err)
	}

	sessions, err := svc.ListAgentSessions(ctx, f.Principal(), 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if sessions[0].Status != domain.AgentSessionFailed {
		t.Fatalf("status %q, want failed", sessions[0].Status)
	}
	if sessions[0].Error == nil || !strings.Contains(*sessions[0].Error, "provider") {
		t.Errorf("the failure does not say why: %v", sessions[0].Error)
	}
}

func TestRun_StreamsTextToTheReader(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "hi"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	runner := agent.NewRunner(svc, llm.NewFake(llm.TextResponse("Hello, here is the answer.")))

	var streamed strings.Builder
	if err := runner.Run(ctx, session, func(delta string) error {
		streamed.WriteString(delta)
		return nil
	}); err != nil {
		t.Fatalf("run: %v", err)
	}
	if streamed.String() != "Hello, here is the answer." {
		t.Errorf("streamed %q", streamed.String())
	}
}
