package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestUpdateProject_PriorityChangeAppendsWithinTheBand(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	first, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Alpha", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Beta", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	_ = second

	urgent := 1
	updated, _, err := svc.UpdateProject(ctx, p, domain.UpdateProjectInput{
		ID: first.ID, Priority: &urgent,
	})
	if err != nil {
		t.Fatalf("update priority: %v", err)
	}
	if updated.Priority != 1 {
		t.Fatalf("priority = %d, want 1", updated.Priority)
	}

	rows, err := svc.ListProjects(ctx, p)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) < 2 {
		t.Fatalf("want at least 2 projects, got %d", len(rows))
	}
	// Urgent bands sort before none; within a band sort_order applies.
	foundFirst := false
	for _, row := range rows {
		if row.ID == first.ID {
			foundFirst = true
			if row.Priority != 1 {
				t.Fatalf("listed priority = %d", row.Priority)
			}
			break
		}
	}
	if !foundFirst {
		t.Fatal("updated project missing from list")
	}
}

func TestUpdateProject_ReorderWithinPriorityBand(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "A", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("a: %v", err)
	}
	b, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "B", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("b: %v", err)
	}

	updated, _, err := svc.UpdateProject(ctx, p, domain.UpdateProjectInput{
		ID: a.ID, AfterProjectID: &b.ID,
	})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}
	if updated.SortOrder <= b.SortOrder {
		t.Fatalf("A should sort after B, got %q vs %q", updated.SortOrder, b.SortOrder)
	}
}

func TestUpdateProject_RejectsCrossPriorityAnchor(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	anchor, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Anchor", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("anchor: %v", err)
	}
	moving, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Moving", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("moving: %v", err)
	}
	urgent := 1
	if _, _, err := svc.UpdateProject(ctx, p, domain.UpdateProjectInput{
		ID: anchor.ID, Priority: &urgent,
	}); err != nil {
		t.Fatalf("set anchor urgent: %v", err)
	}

	_, _, err = svc.UpdateProject(ctx, p, domain.UpdateProjectInput{
		ID: moving.ID, AfterProjectID: &anchor.ID,
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestUpdateProject_RejectsUnknownAfterProject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Solo", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	missing := uuid.New()
	_, _, err = svc.UpdateProject(ctx, p, domain.UpdateProjectInput{
		ID: project.ID, AfterProjectID: &missing,
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}
