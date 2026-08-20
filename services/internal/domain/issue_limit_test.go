package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func pinTeamIssueLimit(t *testing.T, n int64) {
	t.Helper()
	previous := domain.TeamIssueLimit
	domain.TeamIssueLimit = n
	t.Cleanup(func() { domain.TeamIssueLimit = previous })
}

func TestCreateIssue_RefusesWhenTheTeamIsAtTheLiveLimit(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	pinTeamIssueLimit(t, 1)

	f.NewIssue(t, "Occupies the only slot")

	_, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "One too many",
	})
	if err == nil {
		t.Fatal("create succeeded at the live-issue limit")
	}
	if code := platform.CodeOf(err); code != platform.CodeConflict {
		t.Fatalf("code = %s, want %s (err = %v)", code, platform.CodeConflict, err)
	}
}

func TestCreateIssue_ArchivedIssuesDoNotCountTowardTheLimit(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	pinTeamIssueLimit(t, 1)

	occupied := f.NewIssue(t, "Soon archived")
	if _, err := svc.ArchiveIssue(ctx, p, occupied, true); err != nil {
		t.Fatalf("archive: %v", err)
	}

	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Fits after the archive",
	}); err != nil {
		t.Fatalf("create after archive: %v", err)
	}
}

func TestCreateIssue_CompletedIssuesStillCountUntilArchived(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	pinTeamIssueLimit(t, 1)

	occupied := f.NewIssue(t, "Done but still live")
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
		ID: occupied, StateID: &f.Done,
	}); err != nil {
		t.Fatalf("complete: %v", err)
	}

	_, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Still blocked by the completed one",
	})
	if err == nil {
		t.Fatal("create succeeded while a completed issue still occupied the slot")
	}
	if code := platform.CodeOf(err); code != platform.CodeConflict {
		t.Fatalf("code = %s, want %s (err = %v)", code, platform.CodeConflict, err)
	}
}
