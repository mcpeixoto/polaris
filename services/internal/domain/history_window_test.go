package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The free plan's 90-day activity window, which was a number in the matrix that the API
// returned and nothing read. The pricing page sold it; every plan kept every entry forever.
//
// Both reads are asserted because there are two of them: the issue detail pane calls
// ListIssueHistory and a hydrated page calls ListIssueHistoryForIssues through the loader. A
// window on one and not the other is a cap that depends on which query the client sent.
func TestIssueHistory_TheFreePlansWindowHidesOlderActivity(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	old, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Filed last year"})
	if err != nil {
		t.Fatalf("create the old issue: %v", err)
	}
	recent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Filed this week"})
	if err != nil {
		t.Fatalf("create the recent issue: %v", err)
	}

	// issue_history has no update trigger — it is append-only by design — so ageing a row
	// is a plain UPDATE rather than the trigger dance ListDrafts' test needs.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE issue_history SET created_at = $1 WHERE issue_id = $2`,
		time.Now().AddDate(0, 0, -200), old.ID); err != nil {
		t.Fatalf("age the old issue's history: %v", err)
	}

	// The fixture is self-hosted, which keeps everything. Both feeds are visible before the
	// plan changes, so a later empty result is the window and not a broken query.
	if got, err := svc.ListIssueHistory(ctx, p, old.ID); err != nil || len(got) == 0 {
		t.Fatalf("self-hosted must keep every entry: %d entries, err %v", len(got), err)
	}

	if _, err := db.Pool().Exec(ctx, `UPDATE workspace SET plan = 'free' WHERE id = $1`, f.WorkspaceID); err != nil {
		t.Fatalf("put the workspace on the free plan: %v", err)
	}

	if got, err := svc.ListIssueHistory(ctx, p, old.ID); err != nil {
		t.Fatalf("list the old issue's history: %v", err)
	} else if len(got) != 0 {
		t.Errorf("a free workspace read %d history entries from 200 days ago; the plan "+
			"advertises 90 days and the entries are hidden, not deleted", len(got))
	}

	if got, err := svc.ListIssueHistory(ctx, p, recent.ID); err != nil {
		t.Fatalf("list the recent issue's history: %v", err)
	} else if len(got) == 0 {
		t.Error("the window swallowed activity from today, so free workspaces have no " +
			"activity feed at all rather than ninety days of one")
	}

	batched, err := svc.ListIssueHistoryForIssues(ctx, p, []uuid.UUID{old.ID, recent.ID})
	if err != nil {
		t.Fatalf("hydrate both issues: %v", err)
	}
	if len(batched[old.ID]) != 0 {
		t.Errorf("the loader returned %d aged entries the detail pane hides: the same cap "+
			"has to hold whichever read the client sends", len(batched[old.ID]))
	}
	if len(batched[recent.ID]) == 0 {
		t.Error("the loader hid today's activity")
	}
}

// Upgrading brings the whole feed back, because the window hides rather than deletes. That
// is what makes it a packaging decision rather than a retention policy, and it is the
// difference between this and change_log's physical 30-day retention.
func TestIssueHistory_UpgradingRestoresTheHiddenActivity(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Long-running"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := db.Pool().Exec(ctx,
		`UPDATE issue_history SET created_at = $1 WHERE issue_id = $2`,
		time.Now().AddDate(0, 0, -200), issue.ID); err != nil {
		t.Fatalf("age the history: %v", err)
	}

	if _, err := db.Pool().Exec(ctx, `UPDATE workspace SET plan = 'free' WHERE id = $1`, f.WorkspaceID); err != nil {
		t.Fatalf("free plan: %v", err)
	}
	hidden, err := svc.ListIssueHistory(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list on free: %v", err)
	}
	if len(hidden) != 0 {
		t.Fatalf("the free window did not apply; the rest of this test proves nothing")
	}

	if _, err := db.Pool().Exec(ctx, `UPDATE workspace SET plan = 'pro' WHERE id = $1`, f.WorkspaceID); err != nil {
		t.Fatalf("pro plan: %v", err)
	}
	if got, err := svc.ListIssueHistory(ctx, p, issue.ID); err != nil {
		t.Fatalf("list on pro: %v", err)
	} else if len(got) == 0 {
		t.Error("upgrading did not restore the hidden activity, so the window deleted " +
			"something instead of hiding it")
	}
}
