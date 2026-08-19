package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestAddProjectDependency_LinksProjects(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	blocking, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Foundation", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("blocking project: %v", err)
	}
	blocked, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("blocked project: %v", err)
	}

	dep, version, err := svc.AddProjectDependency(ctx, p, blocking.ID, blocked.ID)
	if err != nil {
		t.Fatalf("add dependency: %v", err)
	}
	if version == 0 {
		t.Fatal("dependency must emit")
	}
	if dep.BlockingProjectID != blocking.ID || dep.BlockedProjectID != blocked.ID {
		t.Fatalf("got %+v", dep)
	}

	blockingRows, err := svc.ListProjectDependenciesBlocking(ctx, p, blocking.ID)
	if err != nil || len(blockingRows) != 1 {
		t.Fatalf("blocking list: %v len=%d", err, len(blockingRows))
	}
	blockedByRows, err := svc.ListProjectDependenciesBlockedBy(ctx, p, blocked.ID)
	if err != nil || len(blockedByRows) != 1 {
		t.Fatalf("blocked-by list: %v len=%d", err, len(blockedByRows))
	}
}

func TestAddProjectDependency_RejectsSelf(t *testing.T) {
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

	_, _, err = svc.AddProjectDependency(ctx, p, project.ID, project.ID)
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestAddProjectDependency_RejectsCycle(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "A", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project A: %v", err)
	}
	b, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "B", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project B: %v", err)
	}
	if _, _, err := svc.AddProjectDependency(ctx, p, a.ID, b.ID); err != nil {
		t.Fatalf("A blocks B: %v", err)
	}

	_, _, err = svc.AddProjectDependency(ctx, p, b.ID, a.ID)
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation for cycle", err)
	}
}

func TestRemoveProjectDependency_DropsTheLink(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	blocking, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "First", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("blocking: %v", err)
	}
	blocked, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Second", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("blocked: %v", err)
	}
	dep, _, err := svc.AddProjectDependency(ctx, p, blocking.ID, blocked.ID)
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	id, version, err := svc.RemoveProjectDependency(ctx, p, dep.ID)
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if version == 0 || id != dep.ID {
		t.Fatalf("id=%v version=%d", id, version)
	}

	rows, err := svc.ListProjectDependenciesBlocking(ctx, p, blocking.ID)
	if err != nil || len(rows) != 0 {
		t.Fatalf("want empty, got %v len=%d", err, len(rows))
	}
}

func TestAddProjectDependency_RejectsDuplicate(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	blocking, _, _ := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "X", TeamIDs: []uuid.UUID{f.TeamID},
	})
	blocked, _, _ := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Y", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if _, _, err := svc.AddProjectDependency(ctx, p, blocking.ID, blocked.ID); err != nil {
		t.Fatalf("first: %v", err)
	}
	_, _, err := svc.AddProjectDependency(ctx, p, blocking.ID, blocked.ID)
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}
