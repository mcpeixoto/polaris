package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A micro of a dollar per token is exactly a dollar per million tokens, which is how model
// prices are quoted. If this arithmetic drifts, every invoice is wrong.
func TestCostMicros_PricesATurnFromListRates(t *testing.T) {
	cases := []struct {
		model            string
		in, out          int
		want             int64
		whatItRepresents string
	}{
		{"claude-opus-5", 1_000_000, 0, 5_000_000, "$5 per million input tokens"},
		{"claude-opus-5", 0, 1_000_000, 25_000_000, "$25 per million output tokens"},
		{"claude-sonnet-5", 1_000_000, 1_000_000, 12_000_000, "$2 in + $10 out"},
		{"claude-haiku-4-5", 1_000_000, 1_000_000, 6_000_000, "$1 in + $5 out"},
		// An unknown model bills at the most expensive known rate. Under-billing silently
		// is worse than over-billing visibly.
		{"some-future-model", 1_000_000, 0, 10_000_000, "the fallback rate"},
		{"claude-opus-5", 0, 0, 0, "nothing used, nothing charged"},
	}
	for _, tc := range cases {
		if got := domain.CostMicros(tc.model, tc.in, tc.out); got != tc.want {
			t.Errorf("%s (%s): got %d micros, want %d", tc.model, tc.whatItRepresents, got, tc.want)
		}
	}
}

// A self-hosted install brought its own key and pays its provider directly. Metering it
// would be charging for something we did not provide.
func TestAgentCredits_UnmeteredDeploymentNeverCharges(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	if err := svc.CheckAgentCredits(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("an unmetered deployment refused a run: %v", err)
	}
	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "hi"})
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	if err := svc.ChargeAgentRun(ctx, f.WorkspaceID, session.ID, "claude-opus-5", 1000, 1000); err != nil {
		t.Fatalf("charge: %v", err)
	}
	remaining, err := svc.AgentCreditsRemaining(ctx, f.Principal())
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	// Null, which the client renders as no limit rather than none left.
	if remaining != nil {
		t.Errorf("an unmetered deployment reported a balance of %d", *remaining)
	}

	var rows int
	if err := db.Pool().QueryRow(ctx, `SELECT count(*) FROM ai_credit_ledger`).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 0 {
		t.Errorf("an unmetered deployment wrote %d ledger rows", rows)
	}
}

func TestAgentCredits_MeteredRunSpendsAndRefusesAtZero(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.SetAgentMetered(true)
	ctx := context.Background()

	// With no balance at all, a run is refused before the model is called.
	if err := svc.CheckAgentCredits(ctx, f.WorkspaceID); err == nil {
		t.Fatal("a workspace with no credits was allowed to run the agent")
	} else if platform.CodeOf(err) != platform.CodeForbidden {
		t.Errorf("error code %v, want forbidden", platform.CodeOf(err))
	}

	balance, err := svc.GrantAgentCredits(ctx, f.Principal(), 1_000_000, "welcome grant")
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if balance != 1_000_000 {
		t.Fatalf("balance after a $1 grant is %d micros", balance)
	}
	if err := svc.CheckAgentCredits(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("a funded workspace was refused: %v", err)
	}

	session, _, _, err := svc.CreateAgentSession(ctx, f.Principal(), domain.CreateAgentSessionInput{Body: "hi"})
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	// 100k in + 20k out on Opus 5 = 100000*5 + 20000*25 = 1,000,000 micros exactly.
	if err := svc.ChargeAgentRun(ctx, f.WorkspaceID, session.ID, "claude-opus-5", 100_000, 20_000); err != nil {
		t.Fatalf("charge: %v", err)
	}
	remaining, err := svc.AgentCreditsRemaining(ctx, f.Principal())
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if remaining == nil || *remaining != 0 {
		t.Fatalf("balance after spending the grant is %v, want 0", remaining)
	}
	if err := svc.CheckAgentCredits(ctx, f.WorkspaceID); err == nil {
		t.Fatal("a spent-out workspace was allowed another run")
	}

	// The ledger explains the balance: a grant and a spend.
	var entries int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM ai_credit_ledger WHERE workspace_id = $1`, f.WorkspaceID).Scan(&entries); err != nil {
		t.Fatalf("count: %v", err)
	}
	if entries != 2 {
		t.Errorf("ledger has %d rows, want the grant and the spend", entries)
	}
}

func TestGrantAgentCredits_AdminsOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.SetAgentMetered(true)
	ctx := context.Background()

	memberID := f.NewUser(t, "Member", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)

	if _, err := svc.GrantAgentCredits(ctx, member, 1_000_000, "self-serve"); err == nil {
		t.Fatal("a member granted their own workspace credits")
	} else if platform.CodeOf(err) != platform.CodeForbidden {
		t.Errorf("error code %v, want forbidden", platform.CodeOf(err))
	}
}
