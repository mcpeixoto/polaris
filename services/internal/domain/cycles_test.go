package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestUpdateTeamCycles_EnableCreatesCurrentAndUpcoming(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enabled := true
	duration := 2
	cooldown := 1
	upcoming := 3
	start := "monday"
	team, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID:        f.TeamID,
		Enabled:       &enabled,
		DurationWeeks: &duration,
		CooldownWeeks: &cooldown,
		StartDay:      &start,
		UpcomingCount: &upcoming,
	})
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !team.CyclesEnabled {
		t.Fatal("cycles stayed off")
	}
	if team.CycleDurationWeeks != 2 || team.CycleCooldownWeeks != 1 || team.CycleUpcomingCount != 3 {
		t.Fatalf("cadence = %d/%d/%d, want 2/1/3", team.CycleDurationWeeks, team.CycleCooldownWeeks, team.CycleUpcomingCount)
	}

	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(cycles) != 1+upcoming {
		t.Fatalf("got %d cycles, want %d (current + upcoming)", len(cycles), 1+upcoming)
	}

	now := time.Now()
	current := 0
	for i, c := range cycles {
		if !c.EndsAt.After(c.StartsAt) {
			t.Fatalf("cycle %d ends at or before it starts", c.Number)
		}
		if !c.StartsAt.After(now) && c.EndsAt.After(now) {
			current++
		}
		if i > 0 {
			gap := cycles[i].StartsAt.Sub(cycles[i-1].EndsAt)
			want := time.Duration(cooldown) * 7 * 24 * time.Hour
			if gap != want {
				t.Fatalf("gap between %d and %d is %s, want cooldown %s",
					cycles[i-1].Number, cycles[i].Number, gap, want)
			}
		}
	}
	if current != 1 {
		t.Fatalf("%d cycles contain now, want exactly one current", current)
	}
}

func TestUpdateTeamCycles_DurationIsBounded(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bad := 9
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, DurationWeeks: &bad,
	}); err == nil {
		t.Fatal("a 9-week duration was accepted")
	}
}

func TestIssue_OneCycleAtATimeAndSameTeam(t *testing.T) {
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

	other, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "DES", Name: "Design"})
	if err != nil {
		t.Fatalf("other team: %v", err)
	}
	enableCycles(t, svc, p, other.ID)
	theirs, err := svc.ListCycles(ctx, p, other.ID)
	if err != nil || len(theirs) == 0 {
		t.Fatalf("their cycles: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "In a cycle", CycleID: &cycles[0].ID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.CycleID == nil || *issue.CycleID != cycles[0].ID {
		t.Fatalf("cycle = %v, want %s", issue.CycleID, cycles[0].ID)
	}

	moved, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, CycleID: &cycles[1].ID})
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if moved.CycleID == nil || *moved.CycleID != cycles[1].ID {
		t.Fatalf("after move cycle = %v, want %s", moved.CycleID, cycles[1].ID)
	}

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, CycleID: &theirs[0].ID}); err == nil {
		t.Fatal("an issue accepted a cycle from another team")
	}
}

func TestAdvanceCycles_RollsOpenWorkForwardAndLeavesCompleted(t *testing.T) {
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
		TeamID: f.TeamID, Title: "Still going", StateID: &f.InProgress, CycleID: &current.ID,
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	done, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Shipped", StateID: &f.Done, CycleID: &current.ID,
	})
	if err != nil {
		t.Fatalf("done: %v", err)
	}

	if _, err := svc.AdvanceCycles(ctx, current.EndsAt); err != nil {
		t.Fatalf("advance: %v", err)
	}

	gotOpen, err := svc.GetIssue(ctx, p, open.ID)
	if err != nil {
		t.Fatalf("get open: %v", err)
	}
	if gotOpen.CycleID == nil || *gotOpen.CycleID != next.ID {
		t.Fatalf("open issue cycle = %v, want the next cycle %s", gotOpen.CycleID, next.ID)
	}
	gotDone, err := svc.GetIssue(ctx, p, done.ID)
	if err != nil {
		t.Fatalf("get done: %v", err)
	}
	if gotDone.CycleID == nil || *gotDone.CycleID != current.ID {
		t.Fatalf("completed issue was rolled; it belongs to the cycle it finished in")
	}
}

func TestAdvanceCycles_AutoAddsStartedToCurrent(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	on := true
	addStarted := true
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &on, AutoAddStarted: &addStarted,
	}); err != nil {
		t.Fatalf("enable: %v", err)
	}
	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(cycles) == 0 {
		t.Fatalf("cycles: %v", err)
	}

	orphan, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Already started", StateID: &f.InProgress,
	})
	if err != nil {
		t.Fatalf("orphan: %v", err)
	}

	if _, err := svc.AdvanceCycles(ctx, time.Now()); err != nil {
		t.Fatalf("advance: %v", err)
	}

	got, err := svc.GetIssue(ctx, p, orphan.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.CycleID == nil || *got.CycleID != cycles[0].ID {
		t.Fatalf("started issue cycle = %v, want current %s", got.CycleID, cycles[0].ID)
	}
}

func TestAdvanceCycles_CooldownAttributesCompletedToPrevious(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	on := true
	cooldown := 1
	addCompleted := true
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID:           f.TeamID,
		Enabled:          &on,
		CooldownWeeks:    &cooldown,
		AutoAddCompleted: &addCompleted,
	}); err != nil {
		t.Fatalf("enable: %v", err)
	}
	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(cycles) < 2 {
		t.Fatalf("cycles: %v", err)
	}
	previous := cycles[0]
	during := previous.EndsAt.Add(time.Hour)

	orphan, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Finished in the gap", StateID: &f.Done,
	})
	if err != nil {
		t.Fatalf("orphan: %v", err)
	}
	started, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Still going in the gap", StateID: &f.InProgress,
	})
	if err != nil {
		t.Fatalf("started: %v", err)
	}

	if _, err := svc.AdvanceCycles(ctx, during); err != nil {
		t.Fatalf("advance: %v", err)
	}

	gotDone, err := svc.GetIssue(ctx, p, orphan.ID)
	if err != nil {
		t.Fatalf("get done: %v", err)
	}
	if gotDone.CycleID == nil || *gotDone.CycleID != previous.ID {
		t.Fatalf("completed-in-cooldown cycle = %v, want previous %s", gotDone.CycleID, previous.ID)
	}
	gotStarted, err := svc.GetIssue(ctx, p, started.ID)
	if err != nil {
		t.Fatalf("get started: %v", err)
	}
	if gotStarted.CycleID != nil {
		t.Fatalf("started issue was auto-added during cooldown to %s; started work waits for the next cycle", *gotStarted.CycleID)
	}
}

func TestUpdateTeamCycles_DisableCompletesCurrentAndDropsUpcoming(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableCycles(t, svc, p, f.TeamID)
	off := false
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &off,
	}); err != nil {
		t.Fatalf("disable: %v", err)
	}

	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	now := time.Now()
	for _, c := range cycles {
		if c.StartsAt.After(now) {
			t.Fatalf("upcoming cycle %d survived disable", c.Number)
		}
		if !c.StartsAt.After(now) && c.EndsAt.After(now) && c.CompletedAt == nil {
			t.Fatalf("the current cycle was not marked completed")
		}
	}
}

func enableCycles(t *testing.T, svc *domain.Service, p *authz.Principal, teamID uuid.UUID) {
	t.Helper()
	on := true
	if _, _, err := svc.UpdateTeamCycles(context.Background(), p, domain.UpdateTeamCyclesInput{
		TeamID: teamID, Enabled: &on,
	}); err != nil {
		t.Fatalf("enable cycles: %v", err)
	}
}
