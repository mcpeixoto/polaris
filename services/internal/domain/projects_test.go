package domain_test

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestAddProjectTeam_ConcurrentAddsOfDifferentTeamsBothSurvive(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	design, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "DES", Name: "Design"})
	if err != nil {
		t.Fatalf("design team: %v", err)
	}
	ops, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "OPS", Name: "Operations"})
	if err != nil {
		t.Fatalf("ops team: %v", err)
	}

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name:    "Search",
		TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	type result struct {
		link    model.ProjectTeam
		version int64
		err     error
	}
	teams := []uuid.UUID{design.ID, ops.ID}
	results := make([]result, len(teams))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range teams {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			link, version, err := svc.AddProjectTeam(ctx, p, project.ID, teams[i])
			results[i] = result{link, version, err}
		}(i)
	}
	close(start)
	wg.Wait()

	for i, r := range results {
		if r.err != nil {
			t.Fatalf("add %d: %v — both concurrent adds must succeed", i, r.err)
		}
	}
	if results[0].link.ID == results[1].link.ID {
		t.Fatal("both adds returned one row id; a team membership is one row per (project, team)")
	}
	if results[0].version == results[1].version {
		t.Fatalf("both adds landed on version %d; every write gets its own place in the stream", results[0].version)
	}

	links, err := svc.ListProjectTeams(ctx, p, project.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(links) != 3 {
		t.Fatalf("project has %d teams, want 3 (the original plus both adds)", len(links))
	}

	changes := emittedChangesOf(t, db, f.WorkspaceID, "projectTeam")
	if len(changes) < 3 {
		t.Fatalf("emitted %d projectTeam changes, want at least 3 — membership is rows on the stream, not a set on the project", len(changes))
	}
	for _, c := range emittedChanges(t, db, f.WorkspaceID) {
		if c.EntityType == "project" && c.Op == string(domain.OpUpsert) {
			continue
		}
	}
}

func TestIssue_OneProjectAtATime(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	first, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{Name: "First", TeamIDs: []uuid.UUID{f.TeamID}})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{Name: "Second", TeamIDs: []uuid.UUID{f.TeamID}})
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "In one project", ProjectID: &first.ID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.ProjectID == nil || *issue.ProjectID != first.ID {
		t.Fatalf("issue project = %v, want %s", issue.ProjectID, first.ID)
	}

	moved, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, ProjectID: &second.ID})
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if moved.ProjectID == nil || *moved.ProjectID != second.ID {
		t.Fatalf("after move project = %v, want %s", moved.ProjectID, second.ID)
	}
}

func TestIssue_MilestoneImpliesProject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	mine, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{Name: "Mine", TeamIDs: []uuid.UUID{f.TeamID}})
	if err != nil {
		t.Fatalf("mine: %v", err)
	}
	theirs, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{Name: "Theirs", TeamIDs: []uuid.UUID{f.TeamID}})
	if err != nil {
		t.Fatalf("theirs: %v", err)
	}
	ms, _, err := svc.CreateProjectMilestone(ctx, p, domain.CreateProjectMilestoneInput{ProjectID: theirs.ID, Name: "Beta"})
	if err != nil {
		t.Fatalf("milestone: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Borrowed milestone"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	_, _, err = svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
		ID: issue.ID, ProjectID: &mine.ID, ProjectMilestoneID: &ms.ID,
	})
	if err == nil {
		t.Fatal("an issue accepted a milestone from another project")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}
}

func TestUpdateIssue_CompletingWorkDoesNotMoveProjectStatus(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{Name: "Manual", TeamIDs: []uuid.UUID{f.TeamID}})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	before := project.StatusID

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The only work", ProjectID: &project.ID,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("complete: %v", err)
	}

	got, err := svc.GetProject(ctx, p, project.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StatusID != before {
		t.Fatalf("completing the issue moved the project from %s to %s; status is always manual", before, got.StatusID)
	}
}

func TestCreateProject_NameAndTeamAreRequired(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{TeamIDs: []uuid.UUID{f.TeamID}}); err == nil {
		t.Fatal("a nameless project was accepted")
	}
	if _, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{Name: "Lonely"}); err == nil {
		t.Fatal("a project with no team was accepted")
	}
}

func TestDeleteProject_RestoresInsideTheWindow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{Name: "Oops", TeamIDs: []uuid.UUID{f.TeamID}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.DeleteProject(ctx, p, project.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.GetProject(ctx, p, project.ID); err == nil {
		t.Fatal("a deleted project is still readable as live")
	}
	restored, _, err := svc.RestoreProject(ctx, p, project.ID)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Name != "Oops" {
		t.Fatalf("restored name %q, want Oops", restored.Name)
	}
}
