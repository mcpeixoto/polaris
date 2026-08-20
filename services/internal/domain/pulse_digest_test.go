package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestDeliverPulseDigests_WritesOneInboxRowPerDuePerson(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	if _, _, err := svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthOnTrack,
		Body:      "Shipping",
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	now := time.Date(2026, 8, 21, 6, 15, 0, 0, time.UTC)
	n, err := svc.DeliverPulseDigests(ctx, now)
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if n != 1 {
		t.Fatalf("delivered %d, want 1", n)
	}

	rows, err := svc.ListNotifications(ctx, p, true, true, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	found := 0
	for _, row := range rows {
		if row.Type == model.NotifyPulseDigest {
			found++
		}
	}
	if found != 1 {
		t.Fatalf("inbox pulse rows = %d, want 1", found)
	}

	again, err := svc.DeliverPulseDigests(ctx, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if again != 0 {
		t.Fatalf("second pass delivered %d, want 0", again)
	}
}

func TestDeliverPulseDigests_SkipsBeforeSix(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	if _, _, err := svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthOnTrack,
		Body:      "Shipping",
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	n, err := svc.DeliverPulseDigests(ctx, time.Date(2026, 8, 21, 5, 50, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if n != 0 {
		t.Fatalf("delivered %d before 06:00, want 0", n)
	}
}

func TestDeliverPulseDigests_OffCadenceSendsNothing(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	off := model.PulseDigestOff
	if _, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{
		PulseDigestCadence: &off,
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	if _, _, err := svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthOnTrack,
		Body:      "Shipping",
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	n, err := svc.DeliverPulseDigests(ctx, time.Date(2026, 8, 21, 6, 15, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if n != 0 {
		t.Fatalf("off cadence delivered %d, want 0", n)
	}
}

func TestDeliverPulseDigests_EmptyForMeIsSilent(t *testing.T) {
	db := testutil.NewDB(t)
	_ = testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	n, err := svc.DeliverPulseDigests(ctx, time.Date(2026, 8, 21, 6, 15, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if n != 0 {
		t.Fatalf("empty feed delivered %d, want 0", n)
	}
}

func TestUpdateWorkspace_PulseCadenceValidation(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bad := "hourly"
	if _, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{
		PulseDigestCadence: &bad,
	}); err == nil {
		t.Fatal("hourly cadence must not save")
	}

	weekly := model.PulseDigestWeekly
	ws, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{
		PulseDigestCadence: &weekly,
	})
	if err != nil {
		t.Fatalf("weekly: %v", err)
	}
	if ws.PulseDigestCadence != model.PulseDigestWeekly {
		t.Fatalf("cadence = %q", ws.PulseDigestCadence)
	}

	off := false
	ws, _, err = svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{PulseEnabled: &off})
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if ws.PulseEnabled {
		t.Fatal("pulse stayed enabled")
	}
}
