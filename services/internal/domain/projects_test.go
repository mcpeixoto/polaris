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

// The workspace default is where a new project lands, so the database only lets a Backlog
// or Planned status hold it. Without the same rule here the constraint arrives as
// platform.Internal — which the web client treats as retriable, so the promotion is retried
// five times and then dropped, having looked on screen like it worked the whole time.
func TestUpdateProjectStatus_DefaultMustBeBacklogOrPlanned(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	statuses, err := svc.ListProjectStatuses(ctx, p)
	if err != nil {
		t.Fatalf("list statuses: %v", err)
	}
	byCategory := map[string]model.ProjectStatus{}
	for _, s := range statuses {
		byCategory[s.Category] = s
	}

	for _, category := range []string{
		model.ProjectCategoryStarted, model.ProjectCategoryCompleted, model.ProjectCategoryCanceled,
	} {
		status, ok := byCategory[category]
		if !ok {
			t.Fatalf("no seeded %s status", category)
		}
		yes := true
		_, _, err := svc.UpdateProjectStatus(ctx, p, domain.UpdateProjectStatusInput{
			ID: status.ID, IsDefault: &yes,
		})
		if platform.CodeOf(err) != platform.CodeValidation {
			t.Fatalf("promoting a %s status: want validation, got %v", category, err)
		}
	}

	// Moving the default into a category that cannot hold it is the same violation from
	// the other side, and is refused too.
	backlog := byCategory[model.ProjectCategoryBacklog]
	started := model.ProjectCategoryStarted
	if _, _, err := svc.UpdateProjectStatus(ctx, p, domain.UpdateProjectStatusInput{
		ID: backlog.ID, Category: &started,
	}); platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("moving the default into started: want validation, got %v", err)
	}

	// Planned is allowed, and it really does demote the old default.
	planned := byCategory[model.ProjectCategoryPlanned]
	yes := true
	if _, _, err := svc.UpdateProjectStatus(ctx, p, domain.UpdateProjectStatusInput{
		ID: planned.ID, IsDefault: &yes,
	}); err != nil {
		t.Fatalf("promoting the planned status: %v", err)
	}
	after, err := svc.ListProjectStatuses(ctx, p)
	if err != nil {
		t.Fatalf("list statuses: %v", err)
	}
	for _, s := range after {
		want := s.ID == planned.ID
		if s.IsDefault != want {
			t.Fatalf("%s isDefault = %v, want %v", s.Name, s.IsDefault, want)
		}
	}
}

// project.status_id is NOT NULL and archiving is soft, so a retired status that projects
// still point at is not a tidy-up — it is a row no client can see, and every project in it
// renders as "No status" with no way back. Same rule as ArchiveWorkflowState.
func TestArchiveProjectStatus_RefusesWhileProjectsUseIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	statuses, err := svc.ListProjectStatuses(ctx, p)
	if err != nil {
		t.Fatalf("list statuses: %v", err)
	}
	var backlog, planned, canceled model.ProjectStatus
	for _, s := range statuses {
		switch s.Category {
		case model.ProjectCategoryBacklog:
			backlog = s
		case model.ProjectCategoryPlanned:
			planned = s
		case model.ProjectCategoryCanceled:
			canceled = s
		}
	}

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Search", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if project.StatusID != backlog.ID {
		t.Fatalf("new project status = %v, want the seeded default %v", project.StatusID, backlog.ID)
	}

	// Hand the default to another status so the refusal under test is the one about
	// projects rather than the one about the default.
	yes := true
	if _, _, err := svc.UpdateProjectStatus(ctx, p, domain.UpdateProjectStatusInput{
		ID: planned.ID, IsDefault: &yes,
	}); err != nil {
		t.Fatalf("promote planned: %v", err)
	}

	if _, err := svc.ArchiveProjectStatus(ctx, p, backlog.ID, true); platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("archiving a status in use: want conflict, got %v", err)
	}
	still, err := svc.GetProject(ctx, p, project.ID)
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	if still.StatusID != backlog.ID {
		t.Fatalf("project status = %v, want it untouched at %v", still.StatusID, backlog.ID)
	}

	// An empty status still retires.
	if _, err := svc.ArchiveProjectStatus(ctx, p, canceled.ID, true); err != nil {
		t.Fatalf("archiving an unused status: %v", err)
	}
}
