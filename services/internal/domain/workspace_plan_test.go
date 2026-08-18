package domain_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A workspace created with no plan named is self-hosted, not free.
//
// It was the literal "free" for everybody. Nothing enforced the caps yet, so the visible
// damage was a settings screen quoting a five-seat limit that did not exist — but the plan
// is what every future entitlement check reads, so the day one shipped, every self-hosted
// install would have hit a paywall nobody meant to ship. README.md promises "self-host free
// and unlimited on seats", and the comment on PlanSelfHosted in internal/entitlement says a
// seat count there "would make the project a trial with a licence file".
//
// The default is the open-source answer because this repository is the open-source product.
// The cloud is the deployment that knows it is special, and it says so with
// POLARIS_DEFAULT_PLAN.
func TestCreateWorkspace_DefaultsToSelfHostedRatherThanTheCloudFreeTier(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	f := testutil.NewFixture(t, db)

	out, err := svc.CreateWorkspace(context.Background(), domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Unlimited",
		URLKey:    "unlimited-" + f.WorkspaceID.String(),
		UserName:  "Founder",
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	if got := entitlement.Plan(out.Workspace.Plan); got != entitlement.PlanSelfHosted {
		t.Fatalf("a workspace created with no plan is on %q, want %q — every self-hosted "+
			"install would carry the cloud's caps", got, entitlement.PlanSelfHosted)
	}

	// The point of the plan, rather than the string it happens to be.
	limits := entitlement.For(entitlement.Plan(out.Workspace.Plan))
	if limits.SeatLimit != entitlement.Unlimited {
		t.Errorf("seat limit is %d, want unlimited", limits.SeatLimit)
	}
	if limits.TeamLimit != entitlement.Unlimited {
		t.Errorf("team limit is %d, want unlimited", limits.TeamLimit)
	}
}

// The cloud can still say otherwise, or this would be a different hardcoded answer.
func TestCreateWorkspace_HonoursAnExplicitPlan(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	f := testutil.NewFixture(t, db)

	out, err := svc.CreateWorkspace(context.Background(), domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Cloud",
		URLKey:    "cloud-" + f.WorkspaceID.String(),
		UserName:  "Founder",
		Plan:      entitlement.PlanFree,
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if got := entitlement.Plan(out.Workspace.Plan); got != entitlement.PlanFree {
		t.Fatalf("plan is %q, want %q", got, entitlement.PlanFree)
	}
}

// A plan nobody defined is refused rather than written to the column.
func TestCreateWorkspace_RefusesAPlanThatDoesNotExist(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	f := testutil.NewFixture(t, db)

	_, err := svc.CreateWorkspace(context.Background(), domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Nonsense",
		URLKey:    "nonsense-" + f.WorkspaceID.String(),
		UserName:  "Founder",
		Plan:      entitlement.Plan("enterprisey"),
	})
	if err == nil {
		t.Fatal("a workspace was created on a plan that does not exist; every entitlement " +
			"read on it would then fall back to some default and nobody would know why")
	}
}

// TestCreateWorkspace_IsBoundedPerAccount covers the ceiling on POST /auth/workspaces.
//
// There was none. The route required a session and nothing else — no role, no rate limit,
// no count — and every workspace that exists is one the sync hub, the bootstrap endpoint and
// the fan-out job carry from then on. An account in a loop could grow the database without
// doing anything a write limiter would notice.
func TestCreateWorkspace_IsBoundedPerAccount(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	ctx := context.Background()

	accountID := uuid.Must(uuid.NewV7())
	if _, err := db.Queries().CreateAccount(ctx, store.CreateAccountParams{
		ID: accountID, Email: fmt.Sprintf("founder+%s@example.com", accountID),
	}); err != nil {
		t.Fatalf("create account: %v", err)
	}

	const limit = 2
	for i := range limit {
		if _, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
			AccountID:     accountID,
			Name:          fmt.Sprintf("Workspace %d", i),
			URLKey:        fmt.Sprintf("ws-%s-%d", accountID, i),
			UserName:      "Founder",
			FirstTeamKey:  "ENG",
			FirstTeamName: "Engineering",
			MaxPerAccount: limit,
		}); err != nil {
			t.Fatalf("workspace %d is inside the limit and was refused: %v", i, err)
		}
	}

	_, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID:     accountID,
		Name:          "One too many",
		URLKey:        fmt.Sprintf("ws-%s-over", accountID),
		UserName:      "Founder",
		FirstTeamKey:  "ENG",
		FirstTeamName: "Engineering",
		MaxPerAccount: limit,
	})
	if err == nil {
		t.Fatal("an account past its workspace limit was allowed to create another")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Errorf("refused as %s; a limit somebody can do something about should read as a "+
			"validation failure, not a fault: %v", code, err)
	}
}

// TestCreateWorkspace_ZeroMeansUnlimited keeps the escape hatch honest.
//
// It is also what every caller that does not care passes, including every other test in this
// package — so a zero that meant "none" would turn an unrelated fixture into a refusal.
func TestCreateWorkspace_ZeroMeansUnlimited(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	ctx := context.Background()

	accountID := uuid.Must(uuid.NewV7())
	if _, err := db.Queries().CreateAccount(ctx, store.CreateAccountParams{
		ID: accountID, Email: fmt.Sprintf("unbounded+%s@example.com", accountID),
	}); err != nil {
		t.Fatalf("create account: %v", err)
	}

	for i := range 3 {
		if _, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
			AccountID:     accountID,
			Name:          fmt.Sprintf("Workspace %d", i),
			URLKey:        fmt.Sprintf("free-%s-%d", accountID, i),
			UserName:      "Founder",
			FirstTeamKey:  "ENG",
			FirstTeamName: "Engineering",
		}); err != nil {
			t.Fatalf("an unbounded caller was refused at workspace %d: %v", i, err)
		}
	}
}
