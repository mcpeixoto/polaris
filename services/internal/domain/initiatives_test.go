package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateInitiative_LandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	init, version, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{
		Name:        "Q3 platform",
		Description: "Ship the core",
		Status:      model.InitiativeStatusActive,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("an initiative must land on the sync stream")
	}
	if init.Status != model.InitiativeStatusActive {
		t.Fatalf("status = %q", init.Status)
	}
}

func TestCreateInitiative_RefusesAnEmptyName(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "   "})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestAddInitiativeProject_LinksAProject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Mobile app", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	init, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{
		Name: "Mobile launch",
	})
	if err != nil {
		t.Fatalf("initiative: %v", err)
	}

	link, version, err := svc.AddInitiativeProject(ctx, p, init.ID, project.ID)
	if err != nil {
		t.Fatalf("add project: %v", err)
	}
	if version == 0 {
		t.Fatal("link must emit")
	}
	if link.ProjectID != project.ID {
		t.Fatalf("project id = %v", link.ProjectID)
	}
}

func TestArchiveInitiative_RemovesItFromTheReplica(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	init, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{Name: "Old goal"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	version, err := svc.ArchiveInitiative(ctx, p, init.ID, true)
	if err != nil {
		t.Fatalf("archive: %v", err)
	}
	if version == 0 {
		t.Fatal("archive must emit")
	}

	_, err = svc.GetInitiative(ctx, p, init.ID)
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("archived initiative should not be readable live, got %v", err)
	}
}
