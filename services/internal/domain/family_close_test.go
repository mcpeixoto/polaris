package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// family creates a parent with one open child, on the team's default settings.
func family(
	t *testing.T, svc *domain.Service, f *testutil.Fixture,
) (parent, child model.Issue) {
	t.Helper()
	ctx := context.Background()
	p := f.Principal()
	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Parent"})
	if err != nil {
		t.Fatalf("parent: %v", err)
	}
	child, _, err = svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Child", ParentID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("child: %v", err)
	}
	return parent, child
}

func stateOf(t *testing.T, svc *domain.Service, f *testutil.Fixture, id uuid.UUID) uuid.UUID {
	t.Helper()
	got, err := svc.GetIssue(context.Background(), f.Principal(), id)
	if err != nil {
		t.Fatalf("get issue: %v", err)
	}
	return got.StateID
}

// The default is the point: a team nobody has configured is what MI-315 was reported on.
func TestFamilyClose_OnByDefaultForANewTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	parent, child := family(t, svc, f)

	if _, _, err := svc.UpdateIssue(context.Background(), f.Principal(), domain.UpdateIssueInput{
		ID: parent.ID, StateID: &f.Done,
	}); err != nil {
		t.Fatalf("close parent: %v", err)
	}
	if stateOf(t, svc, f, child.ID) != f.Done {
		t.Fatal("child stayed open after its parent was done, on default team settings")
	}
}

func TestFamilyClose_ATeamCanTurnItOff(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	off := false
	if _, _, err := svc.UpdateTeamArchive(ctx, p, domain.UpdateTeamArchiveInput{
		TeamID: f.TeamID, AutoCloseChildren: &off,
	}); err != nil {
		t.Fatalf("disable: %v", err)
	}
	parent, child := family(t, svc, f)

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: parent.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close parent: %v", err)
	}
	if stateOf(t, svc, f, child.ID) == f.Done {
		t.Fatal("child closed although the team turned the cascade off")
	}
}

func TestFamilyClose_ACanceledParentCancelsItsChildren(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	parent, child := family(t, svc, f)

	if _, _, err := svc.UpdateIssue(context.Background(), f.Principal(), domain.UpdateIssueInput{
		ID: parent.ID, StateID: &f.Canceled,
	}); err != nil {
		t.Fatalf("cancel parent: %v", err)
	}
	if got := stateOf(t, svc, f, child.ID); got != f.Canceled {
		t.Fatalf("child state = %v, want Canceled: a canceled parent must not count as finished work", got)
	}
}

func TestFamilyClose_ReachesEveryLevel(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	parent, child := family(t, svc, f)
	grandchild, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Grandchild", ParentID: &child.ID,
	})
	if err != nil {
		t.Fatalf("grandchild: %v", err)
	}

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: parent.ID, StateID: &f.Canceled}); err != nil {
		t.Fatalf("cancel parent: %v", err)
	}
	if got := stateOf(t, svc, f, grandchild.ID); got != f.Canceled {
		t.Fatalf("grandchild state = %v, want Canceled", got)
	}
}

// A child that was already closed keeps the word somebody chose for it.
func TestFamilyClose_LeavesAClosedChildAlone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	parent, child := family(t, svc, f)
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: child.ID, StateID: &f.Canceled}); err != nil {
		t.Fatalf("cancel child: %v", err)
	}

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: parent.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("close parent: %v", err)
	}
	if got := stateOf(t, svc, f, child.ID); got != f.Canceled {
		t.Fatalf("child state = %v, want it left Canceled", got)
	}
}

func TestFamilyClose_ABulkEditCascadesToo(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	parent, child := family(t, svc, f)

	if _, _, _, err := svc.BulkUpdateIssues(context.Background(), f.Principal(), domain.BulkUpdateIssuesInput{
		IDs: []uuid.UUID{parent.ID}, StateID: &f.Done,
	}); err != nil {
		t.Fatalf("bulk close: %v", err)
	}
	if stateOf(t, svc, f, child.ID) != f.Done {
		t.Fatal("child stayed open after a bulk edit closed its parent")
	}
}

// Selected together, the child moves with the bulk statement and the cascade finds it already
// closed, so a selection spanning a family still lands in the status that was chosen.
func TestFamilyClose_ABulkEditOnAWholeFamilyKeepsTheChosenStatus(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	parent, child := family(t, svc, f)

	if _, _, _, err := svc.BulkUpdateIssues(context.Background(), f.Principal(), domain.BulkUpdateIssuesInput{
		IDs: []uuid.UUID{parent.ID, child.ID}, StateID: &f.Canceled,
	}); err != nil {
		t.Fatalf("bulk cancel: %v", err)
	}
	if got := stateOf(t, svc, f, child.ID); got != f.Canceled {
		t.Fatalf("child state = %v, want Canceled", got)
	}
}
