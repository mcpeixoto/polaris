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

func TestCreateProjectUpdate_LandsOnTheStream(t *testing.T) {
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

	update, version, err := svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthOnTrack,
		Body:      "Shipping on schedule",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("a project update must land on the sync stream")
	}
	if update.Health != model.ProjectUpdateHealthOnTrack {
		t.Fatalf("health = %q", update.Health)
	}
}

func TestCreateProjectUpdate_RefusesBadHealth(t *testing.T) {
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

	_, _, err = svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    "unknown",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestUpdateProjectUpdate_AuthorOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	otherID := f.NewUser(t, "other", "member", true)
	other := f.PrincipalFor(otherID, authz.RoleMember, f.TeamID)

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID}, MemberIDs: []uuid.UUID{otherID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}

	update, _, err := svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthOnTrack,
		Body:      "All good",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	atRisk := model.ProjectUpdateHealthAtRisk
	_, _, err = svc.UpdateProjectUpdate(ctx, other, domain.UpdateProjectUpdateInput{
		ID: update.ID, Health: &atRisk,
	})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("got %v, want forbidden", err)
	}
}

func TestListProjectUpdates_NewestFirst(t *testing.T) {
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
		Body:      "First",
	}); err != nil {
		t.Fatalf("first: %v", err)
	}
	second, _, err := svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthAtRisk,
		Body:      "Second",
	})
	if err != nil {
		t.Fatalf("second: %v", err)
	}

	rows, err := svc.ListProjectUpdates(ctx, p, project.ID)
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
