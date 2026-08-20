package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateTeam_InheritsParentCycleSchedule(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	enableCycles(t, svc, p, f.TeamID)
	parentCycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(parentCycles) == 0 {
		t.Fatalf("parent cycles: %v (%d)", err, len(parentCycles))
	}

	child, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
		Key: "INF", Name: "Infra", ParentTeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("create sub-team: %v", err)
	}
	if !child.CyclesEnabled {
		t.Fatal("sub-team did not inherit cycles")
	}

	childCycles, err := svc.ListCycles(ctx, p, child.ID)
	if err != nil {
		t.Fatalf("child cycles: %v", err)
	}
	if len(childCycles) != len(parentCycles) {
		t.Fatalf("child has %d cycles, parent has %d", len(childCycles), len(parentCycles))
	}
	for i := range parentCycles {
		if !childCycles[i].StartsAt.Equal(parentCycles[i].StartsAt) || !childCycles[i].EndsAt.Equal(parentCycles[i].EndsAt) {
			t.Fatalf("window %d: child %s–%s, parent %s–%s", i,
				childCycles[i].StartsAt, childCycles[i].EndsAt,
				parentCycles[i].StartsAt, parentCycles[i].EndsAt)
		}
	}
}

func TestUpdateTeamCycles_SubTeamInheritsAndCannotOverride(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	enableCycles(t, svc, p, f.TeamID)
	child, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
		Key: "APP", Name: "App", ParentTeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("create sub-team: %v", err)
	}

	off := false
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: child.ID, Enabled: &off,
	}); err == nil {
		t.Fatal("sub-team overrode an inherited cadence")
	} else if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("code = %s, want VALIDATION (%v)", platform.CodeOf(err), err)
	}

	weeks := 3
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, DurationWeeks: &weeks,
	}); err != nil {
		t.Fatalf("parent duration: %v", err)
	}
	got := mustTeam(t, svc, p, child.ID)
	if got.CycleDurationWeeks != 3 {
		t.Fatalf("child duration = %d, want 3", got.CycleDurationWeeks)
	}
}

func TestMoveTeam_MergesOntoParentCycleSchedule(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	enableCycles(t, svc, p, f.TeamID)
	child, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "DES", Name: "Design"})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	enableCycles(t, svc, p, child.ID)

	nested, _, err := svc.MoveTeam(ctx, p, child.ID, &f.TeamID)
	if err != nil {
		t.Fatalf("nest: %v", err)
	}
	if !nested.CyclesEnabled {
		t.Fatal("nested team dropped cycles")
	}

	now := time.Now()
	parentLive := liveCount(t, svc, p, f.TeamID, now)
	childLive := liveCount(t, svc, p, child.ID, now)
	if childLive != parentLive {
		t.Fatalf("live child windows = %d, parent = %d", childLive, parentLive)
	}
}

func TestAdvanceCycles_InheritedChildFollowsParentClose(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	enableCycles(t, svc, p, f.TeamID)
	child, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
		Key: "ML", Name: "ML", ParentTeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("create sub-team: %v", err)
	}
	childCycles, err := svc.ListCycles(ctx, p, child.ID)
	if err != nil || len(childCycles) < 2 {
		t.Fatalf("child cycles: %v (%d)", err, len(childCycles))
	}
	current, next := childCycles[0], childCycles[1]

	states, err := svc.ListWorkflowStates(ctx, p, child.ID)
	if err != nil {
		t.Fatalf("states: %v", err)
	}
	var started uuid.UUID
	for _, st := range states {
		if st.Category == "started" {
			started = st.ID
			break
		}
	}
	if started == uuid.Nil {
		t.Fatal("child team has no started status")
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: child.ID, Title: "Roll me", StateID: &started, CycleID: &current.ID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := svc.AdvanceCycles(ctx, current.EndsAt); err != nil {
		t.Fatalf("advance: %v", err)
	}

	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.CycleID == nil || *got.CycleID != next.ID {
		t.Fatalf("cycle = %v, want rolled to %s", got.CycleID, next.ID)
	}

	closed, err := svc.GetCycle(ctx, p, current.ID)
	if err != nil {
		t.Fatalf("get closed: %v", err)
	}
	if closed.CompletedAt == nil {
		t.Fatal("child current was not completed when the parent window ended")
	}
}

func TestStartCycleToday_RefusedOnInheritedSubTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	f.SetPlan(t, entitlement.PlanPro)

	enableCycles(t, svc, p, f.TeamID)
	child, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
		Key: "QA", Name: "QA", ParentTeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("create sub-team: %v", err)
	}
	cycles, err := svc.ListCycles(ctx, p, child.ID)
	if err != nil || len(cycles) < 2 {
		t.Fatalf("cycles: %v (%d)", err, len(cycles))
	}
	next := cycles[1]
	if _, _, err := svc.StartCycleToday(ctx, p, next.ID); err == nil {
		t.Fatal("start-today on an inherited sub-team was accepted")
	} else if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("code = %s, want VALIDATION (%v)", platform.CodeOf(err), err)
	}
}

func mustTeam(t *testing.T, svc *domain.Service, p *authz.Principal, id uuid.UUID) model.Team {
	t.Helper()
	teams, err := svc.ListTeams(context.Background(), p)
	if err != nil {
		t.Fatalf("list teams: %v", err)
	}
	for _, team := range teams {
		if team.ID == id {
			return team
		}
	}
	t.Fatalf("team %s missing", id)
	return model.Team{}
}

func liveCount(t *testing.T, svc *domain.Service, p *authz.Principal, teamID uuid.UUID, now time.Time) int {
	t.Helper()
	cycles, err := svc.ListCycles(context.Background(), p, teamID)
	if err != nil {
		t.Fatalf("list cycles: %v", err)
	}
	n := 0
	for _, c := range cycles {
		if c.CompletedAt != nil {
			continue
		}
		if (!c.StartsAt.After(now) && c.EndsAt.After(now)) || c.StartsAt.After(now) {
			n++
		}
	}
	return n
}
