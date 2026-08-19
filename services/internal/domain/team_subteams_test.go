package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateTeam_SubTeamUnderPrivateParentIsPrivate(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	parent, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "SEC", Name: "Security", Private: true,
	})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}

	child, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "APP", Name: "AppSec", ParentTeamID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("create sub-team: %v", err)
	}
	if !child.Private {
		t.Fatal("sub-team under private parent should be private")
	}
	if child.ParentTeamID == nil || *child.ParentTeamID != parent.ID {
		t.Fatalf("parentTeamId = %v, want %v", child.ParentTeamID, parent.ID)
	}
}

func TestMoveTeam_UnnestAndRenest(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	parent, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "PLAT", Name: "Platform"})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	child, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "INF", Name: "Infra"})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}

	nested, _, err := svc.MoveTeam(ctx, p, child.ID, &parent.ID)
	if err != nil {
		t.Fatalf("nest: %v", err)
	}
	if nested.ParentTeamID == nil || *nested.ParentTeamID != parent.ID {
		t.Fatalf("nested parent = %v", nested.ParentTeamID)
	}

	top, _, err := svc.MoveTeam(ctx, p, child.ID, nil)
	if err != nil {
		t.Fatalf("unnest: %v", err)
	}
	if top.ParentTeamID != nil {
		t.Fatalf("parent should be cleared, got %v", top.ParentTeamID)
	}
}

func TestAddTeamMember_SubTeamRequiresParentMembership(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	parent, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{Key: "CORE", Name: "Core"})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	child, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "EDGE", Name: "Edge", ParentTeamID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}

	outsider := f.NewUser(t, "outsider", "member", true)
	outPrincipal := f.PrincipalFor(outsider, authz.RoleMember, f.TeamID)

	if _, _, err := svc.AddTeamMember(ctx, admin, child.ID, outsider, "member"); err == nil {
		t.Fatal("adding non-parent member should fail")
	} else if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("code = %s, want FORBIDDEN (%v)", platform.CodeOf(err), err)
	}

	if _, _, err := svc.AddTeamMember(ctx, admin, parent.ID, outsider, "member"); err != nil {
		t.Fatalf("add to parent: %v", err)
	}
	outPrincipal.Teams[parent.ID] = struct{}{}

	if _, _, err := svc.AddTeamMember(ctx, admin, child.ID, outsider, "member"); err != nil {
		t.Fatalf("add to child after parent membership: %v", err)
	}
}

func TestMoveTeam_RefusesMultiLevelWithoutEnterprise(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	root, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "R", Name: "Root"})
	if err != nil {
		t.Fatalf("root: %v", err)
	}
	mid, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
		Key: "M", Name: "Mid", ParentTeamID: &root.ID,
	})
	if err != nil {
		t.Fatalf("mid: %v", err)
	}
	leaf, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "L", Name: "Leaf"})
	if err != nil {
		t.Fatalf("leaf: %v", err)
	}

	if _, _, err := svc.MoveTeam(ctx, p, leaf.ID, &mid.ID); err == nil {
		t.Fatal("third nesting level should fail on Pro")
	} else if platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("code = %s, want CONFLICT (%v)", platform.CodeOf(err), err)
	}
}

func TestCreateTeam_RefusesSubTeamsOnFreePlan(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanFree)

	parentID := f.TeamID
	_, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
		Key: "SUB", Name: "Sub", ParentTeamID: &parentID,
	})
	if err == nil {
		t.Fatal("sub-team on free plan should fail")
	} else if platform.CodeOf(err) != platform.CodeEntitlement {
		t.Fatalf("code = %s, want ENTITLEMENT (%v)", platform.CodeOf(err), err)
	}
}
