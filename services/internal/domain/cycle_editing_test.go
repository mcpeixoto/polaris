package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestUpdateCycle_RenamesAndExtendsCurrentIntoNext(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableCycles(t, svc, p, f.TeamID)
	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(cycles) < 2 {
		t.Fatalf("cycles: %v (%d)", err, len(cycles))
	}
	current, next := cycles[0], cycles[1]

	name := "Sprint focus"
	if _, _, err := svc.UpdateCycle(ctx, p, domain.UpdateCycleInput{
		ID: current.ID, Name: &name,
	}); err != nil {
		t.Fatalf("rename: %v", err)
	}

	extend := next.StartsAt.Add(24 * time.Hour)
	updated, _, err := svc.UpdateCycle(ctx, p, domain.UpdateCycleInput{
		ID: current.ID, EndsAt: &extend,
	})
	if err != nil {
		t.Fatalf("extend: %v", err)
	}
	if !updated.EndsAt.Equal(extend) {
		t.Fatalf("current ends = %s, want %s", updated.EndsAt, extend)
	}

	after, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var gotNext domainCycleDates
	for _, c := range after {
		if c.ID == next.ID {
			gotNext = domainCycleDates{starts: c.StartsAt, ends: c.EndsAt}
		}
	}
	if gotNext.starts.Before(extend) {
		t.Fatalf("next cycle was not pushed after the extended end: starts %s, extended end %s", gotNext.starts, extend)
	}
}

func TestUpdateCycle_PastDatesAreImmutable(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableCycles(t, svc, p, f.TeamID)
	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(cycles) == 0 {
		t.Fatalf("cycles: %v", err)
	}
	current := cycles[0]

	if _, err := svc.AdvanceCycles(ctx, current.EndsAt); err != nil {
		t.Fatalf("advance: %v", err)
	}
	closed, err := svc.GetCycle(ctx, p, current.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	pastEnd := closed.EndsAt.Add(-24 * time.Hour)
	if _, _, err := svc.UpdateCycle(ctx, p, domain.UpdateCycleInput{
		ID: closed.ID, EndsAt: &pastEnd,
	}); err == nil {
		t.Fatal("past cycle dates should be rejected")
	}
}

func TestUpdateCycle_UpcomingCanMoveBothEnds(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableCycles(t, svc, p, f.TeamID)
	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(cycles) < 2 {
		t.Fatalf("cycles: %v", err)
	}
	upcoming := cycles[len(cycles)-1]

	newStart := upcoming.StartsAt.Add(48 * time.Hour)
	newEnd := upcoming.EndsAt.Add(48 * time.Hour)
	updated, _, err := svc.UpdateCycle(ctx, p, domain.UpdateCycleInput{
		ID: upcoming.ID, StartsAt: &newStart, EndsAt: &newEnd,
	})
	if err != nil {
		t.Fatalf("move upcoming: %v", err)
	}
	if !updated.StartsAt.Equal(newStart) || !updated.EndsAt.Equal(newEnd) {
		t.Fatalf("got %s–%s, want %s–%s", updated.StartsAt, updated.EndsAt, newStart, newEnd)
	}
}

func TestStartCycleToday_CompletesCurrentAndPullsNextForward(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableCycles(t, svc, p, f.TeamID)
	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(cycles) < 2 {
		t.Fatalf("cycles: %v", err)
	}
	current, next := cycles[0], cycles[1]

	open, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Still active", StateID: &f.InProgress, CycleID: &current.ID,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	started, _, err := svc.StartCycleToday(ctx, p, next.ID)
	if err != nil {
		t.Fatalf("start today: %v", err)
	}
	if started.CompletedAt != nil {
		t.Fatal("started cycle should not already be completed")
	}
	if started.StartsAt.After(time.Now()) {
		t.Fatalf("started cycle begins in the future: %s", started.StartsAt)
	}

	gotCurrent, err := svc.GetCycle(ctx, p, current.ID)
	if err != nil {
		t.Fatalf("get current: %v", err)
	}
	if gotCurrent.CompletedAt == nil {
		t.Fatal("current cycle should be completed")
	}

	gotOpen, err := svc.GetIssue(ctx, p, open.ID)
	if err != nil {
		t.Fatalf("get issue: %v", err)
	}
	if gotOpen.CycleID == nil || *gotOpen.CycleID != started.ID {
		t.Fatalf("open issue cycle = %v, want %s", gotOpen.CycleID, started.ID)
	}
}

type domainCycleDates struct {
	starts time.Time
	ends   time.Time
}
