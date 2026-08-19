package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestUpdateTeamArchive_PeriodIsBounded(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bad := 7
	if _, _, err := svc.UpdateTeamArchive(ctx, p, domain.UpdateTeamArchiveInput{
		TeamID: f.TeamID, AutoCloseDays: &bad,
	}); err == nil {
		t.Fatal("a 7-day auto-close period was accepted")
	}

	bad = 14
	if _, _, err := svc.UpdateTeamArchive(ctx, p, domain.UpdateTeamArchiveInput{
		TeamID: f.TeamID, AutoArchiveDays: &bad,
	}); err == nil {
		t.Fatal("a 14-day auto-archive period was accepted")
	}

	ok := 30
	team, _, err := svc.UpdateTeamArchive(ctx, p, domain.UpdateTeamArchiveInput{
		TeamID: f.TeamID, AutoCloseDays: &ok, AutoArchiveDays: &ok,
	})
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if team.AutoCloseDays != 30 || team.AutoArchiveDays != 30 {
		t.Fatalf("periods = %d/%d, want 30/30", team.AutoCloseDays, team.AutoArchiveDays)
	}
}

func TestAutoCloseIssues_ClosesStaleWork(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 30, 0, false, false)

	created, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Stale"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := svc.AutoCloseIssues(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-close: %v", err)
	}

	got, err := svc.GetIssue(ctx, p, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Done {
		t.Fatalf("state = %s, want Done", got.StateID)
	}
	if got.AutoClosedAt == nil {
		t.Fatal("auto-closed issue has no stamp")
	}
}

func TestAutoCloseIssues_SkipsActiveCycle(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 30, 0, false, false)
	on := true
	weeks := 8
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &on, DurationWeeks: &weeks,
	}); err != nil {
		t.Fatalf("enable cycles: %v", err)
	}

	cycles, err := svc.ListCycles(ctx, p, f.TeamID)
	if err != nil || len(cycles) == 0 {
		t.Fatalf("cycles: %v %d", err, len(cycles))
	}
	id, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "In cycle", CycleID: &cycles[0].ID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// 31 days later an 8-week window is still current, so the skip is the cycle, not age.
	if _, err := svc.AutoCloseIssues(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-close: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, id.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Backlog {
		t.Fatalf("an issue in an active cycle was auto-closed")
	}
}

func TestAutoCloseIssues_SkipsUnfinishedProject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 30, 0, false, false)

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Open work", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	id, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "In project", ProjectID: &project.ID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := svc.AutoCloseIssues(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-close: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, id.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Backlog {
		t.Fatal("an issue in an unfinished project was auto-closed")
	}
}

func TestAutoCloseIssues_SkipsFutureDueDate(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 30, 0, false, false)

	now := time.Now()
	due := model.Date(now.Add(90 * 24 * time.Hour).Format("2006-01-02"))
	id, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Due later", DueDate: &due,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := svc.AutoCloseIssues(ctx, now.Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-close: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, id.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Backlog {
		t.Fatal("an issue with a future due date was auto-closed")
	}
}

func TestAutoCloseIssues_SkipsOpenChildren(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 30, 0, false, false)

	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Parent"})
	if err != nil {
		t.Fatalf("parent: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Child", ParentID: &parent.ID,
	}); err != nil {
		t.Fatalf("child: %v", err)
	}

	if _, err := svc.AutoCloseIssues(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-close: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, parent.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Backlog {
		t.Fatal("a parent with open sub-issues was auto-closed")
	}
}

func TestAutoArchive_SkipsOpenParent(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 0, 30, false, false)

	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Parent"})
	if err != nil {
		t.Fatalf("parent: %v", err)
	}
	child, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Child", ParentID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("child: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: child.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close child: %v", err)
	}

	if _, err := svc.AutoArchive(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-archive: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, child.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ArchivedAt != nil {
		t.Fatal("a completed child whose parent is still open was archived")
	}
}

func TestAutoArchive_SkipsOpenChildren(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 0, 30, false, false)

	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Parent"})
	if err != nil {
		t.Fatalf("parent: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Child", ParentID: &parent.ID,
	}); err != nil {
		t.Fatalf("child: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: parent.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close parent: %v", err)
	}

	if _, err := svc.AutoArchive(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-archive: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, parent.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ArchivedAt != nil {
		t.Fatal("a completed parent with open sub-issues was archived")
	}
}

func TestAutoArchive_SkipsOpenProject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 0, 30, false, false)

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Still going", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Shipped", ProjectID: &project.ID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close: %v", err)
	}

	if _, err := svc.AutoArchive(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-archive: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ArchivedAt != nil {
		t.Fatal("a closed issue in an open project was archived on its own")
	}
}

func TestAutoArchive_ProjectTakesItsIssuesWithIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 0, 30, false, false)

	completed := projectStatusIn(t, svc, p, "completed")
	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Shipped", TeamIDs: []uuid.UUID{f.TeamID}, StatusID: &completed,
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Done in project", ProjectID: &project.ID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close: %v", err)
	}

	if _, err := svc.AutoArchive(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-archive: %v", err)
	}

	gotIssue, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get issue: %v", err)
	}
	if gotIssue.ArchivedAt == nil {
		t.Fatal("the project's issue was left live")
	}
	gotProject, err := svc.GetProject(ctx, p, project.ID)
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	if gotProject.ArchivedAt == nil {
		t.Fatal("the completed project was left live")
	}
}

func TestAutoArchive_StandaloneClosedIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	enableArchive(t, svc, p, f.TeamID, 0, 30, false, false)

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Shipped"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close: %v", err)
	}

	if _, err := svc.AutoArchive(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
		t.Fatalf("auto-archive: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ArchivedAt == nil {
		t.Fatal("a stale completed issue with no blockers was left live")
	}
}

func TestFamilyClose_ParentClosesWhenChildrenAreDone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	parentOn := true
	if _, _, err := svc.UpdateTeamArchive(ctx, p, domain.UpdateTeamArchiveInput{
		TeamID: f.TeamID, AutoCloseParent: &parentOn,
	}); err != nil {
		t.Fatalf("enable: %v", err)
	}

	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Parent"})
	if err != nil {
		t.Fatalf("parent: %v", err)
	}
	a, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "A", ParentID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("a: %v", err)
	}
	b, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "B", ParentID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("b: %v", err)
	}

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: a.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close a: %v", err)
	}
	still, err := svc.GetIssue(ctx, p, parent.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if still.StateID == f.Done {
		t.Fatal("parent closed before every child was done")
	}

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: b.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close b: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, parent.ID)
	if err != nil {
		t.Fatalf("get parent: %v", err)
	}
	if got.StateID != f.Done {
		t.Fatal("parent stayed open after every child was done")
	}
}

func TestFamilyClose_ChildrenCloseWhenParentIsDone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	childrenOn := true
	if _, _, err := svc.UpdateTeamArchive(ctx, p, domain.UpdateTeamArchiveInput{
		TeamID: f.TeamID, AutoCloseChildren: &childrenOn,
	}); err != nil {
		t.Fatalf("enable: %v", err)
	}

	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Parent"})
	if err != nil {
		t.Fatalf("parent: %v", err)
	}
	child, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Child", ParentID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("child: %v", err)
	}

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: parent.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close parent: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, child.ID)
	if err != nil {
		t.Fatalf("get child: %v", err)
	}
	if got.StateID != f.Done {
		t.Fatal("child stayed open after its parent was done")
	}
}

func enableArchive(
	t *testing.T, svc *domain.Service, p *authz.Principal, teamID uuid.UUID,
	closeDays, archiveDays int, parent, children bool,
) {
	t.Helper()
	_, _, err := svc.UpdateTeamArchive(context.Background(), p, domain.UpdateTeamArchiveInput{
		TeamID:            teamID,
		AutoCloseDays:     &closeDays,
		AutoArchiveDays:   &archiveDays,
		AutoCloseParent:   &parent,
		AutoCloseChildren: &children,
	})
	if err != nil {
		t.Fatalf("enable archive: %v", err)
	}
}

func projectStatusIn(t *testing.T, svc *domain.Service, p *authz.Principal, category string) uuid.UUID {
	t.Helper()
	statuses, err := svc.ListProjectStatuses(context.Background(), p)
	if err != nil {
		t.Fatalf("statuses: %v", err)
	}
	for _, st := range statuses {
		if st.Category == category {
			return st.ID
		}
	}
	t.Fatalf("no project status in category %s", category)
	return uuid.Nil
}
