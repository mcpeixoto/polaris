package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateInitiativeUpdate_LandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	init, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Reliability"})
	if err != nil {
		t.Fatalf("initiative: %v", err)
	}

	update, version, err := svc.CreateInitiativeUpdate(ctx, p, domain.CreateInitiativeUpdateInput{
		InitiativeID: init.ID,
		Health:       model.ProjectUpdateHealthOnTrack,
		Body:         "Shipping on schedule",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("an initiative update must land on the sync stream")
	}
	if update.Health != model.ProjectUpdateHealthOnTrack {
		t.Fatalf("health = %q", update.Health)
	}
	if update.InitiativeID != init.ID {
		t.Fatalf("initiativeId = %s, want %s", update.InitiativeID, init.ID)
	}
}

func TestCreateInitiativeUpdate_RefusesBadHealth(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	init, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Reliability"})
	if err != nil {
		t.Fatalf("initiative: %v", err)
	}

	_, _, err = svc.CreateInitiativeUpdate(ctx, p, domain.CreateInitiativeUpdateInput{
		InitiativeID: init.ID,
		Health:       "unknown",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestUpdateInitiativeUpdate_AuthorOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	otherID := f.NewUser(t, "other", "member", true)
	other := f.PrincipalFor(otherID, authz.RoleMember, f.TeamID)

	init, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Reliability"})
	if err != nil {
		t.Fatalf("initiative: %v", err)
	}

	update, _, err := svc.CreateInitiativeUpdate(ctx, p, domain.CreateInitiativeUpdateInput{
		InitiativeID: init.ID,
		Health:       model.ProjectUpdateHealthOnTrack,
		Body:         "All good",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	atRisk := model.ProjectUpdateHealthAtRisk
	_, _, err = svc.UpdateInitiativeUpdate(ctx, other, domain.UpdateInitiativeUpdateInput{
		ID: update.ID, Health: &atRisk,
	})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("got %v, want forbidden", err)
	}
}

func TestListInitiativeUpdates_NewestFirst(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	init, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Reliability"})
	if err != nil {
		t.Fatalf("initiative: %v", err)
	}

	if _, _, err := svc.CreateInitiativeUpdate(ctx, p, domain.CreateInitiativeUpdateInput{
		InitiativeID: init.ID,
		Health:       model.ProjectUpdateHealthOnTrack,
		Body:         "First",
	}); err != nil {
		t.Fatalf("first: %v", err)
	}
	second, _, err := svc.CreateInitiativeUpdate(ctx, p, domain.CreateInitiativeUpdateInput{
		InitiativeID: init.ID,
		Health:       model.ProjectUpdateHealthAtRisk,
		Body:         "Second",
	})
	if err != nil {
		t.Fatalf("second: %v", err)
	}

	rows, err := svc.ListInitiativeUpdates(ctx, p, init.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d updates", len(rows))
	}
	if rows[0].ID != second.ID {
		t.Fatal("updates must be newest first")
	}
}

func TestCreateInitiativeUpdate_MissingInitiative(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, err := svc.CreateInitiativeUpdate(ctx, p, domain.CreateInitiativeUpdateInput{
		InitiativeID: uuid.Must(uuid.NewV7()),
		Health:       model.ProjectUpdateHealthOnTrack,
	})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not found", err)
	}
}
