package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
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
