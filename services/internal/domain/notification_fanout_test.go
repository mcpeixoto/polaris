package domain_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 8 in docs/07-milestones/01-milestone-1.md:
//
//	The notification fan-out for a bulk update of 200 issues completes in < 2 s and
//	produces one row per affected subscriber, not per issue per subscriber.
//
// Only this level can prove it, and only with more than one subscriber. The existing
// TestFanOut_BulkEditCoalescesIntoOneRowPerSubscriber in notifications_test.go seeds
// exactly one, which settles half the criterion — one row rather than two hundred is the
// "not per issue per subscriber" half — and leaves the other half untestable by
// construction. With one recipient there is no difference between "one row per subscriber"
// and "one row in the table", so a group key that had lost its `user_id`, or a delivery
// pass that stopped after the first recipient, would pass that test unchanged while every
// person on the team except one heard nothing.
//
// Three subscribers with deliberately different relationships to the batch is what
// separates those cases: one watching all two hundred, one watching a subset, and one
// watching none.
func TestFanOut_BulkEditGivesEachSubscriberExactlyOneRow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	const issues = 200
	const partial = 40

	bobID := f.NewUser(t, "bob", "member", true)
	carolID := f.NewUser(t, "carol", "member", true)
	danID := f.NewUser(t, "dan", "member", true)
	bob := f.PrincipalFor(bobID, "member", f.TeamID)
	carol := f.PrincipalFor(carolID, "member", f.TeamID)
	dan := f.PrincipalFor(danID, "member", f.TeamID)

	// Bob watches everything, Carol watches the first forty, Dan watches nothing. Dan is
	// the control: a fan-out that notified team members rather than subscribers would be
	// invisible without somebody in the team who asked for none of it.
	ids := seedIssuesWithSubscribers(t, f, issues, func(i int) []uuid.UUID {
		if i < partial {
			return []uuid.UUID{bobID, carolID}
		}
		return []uuid.UUID{bobID}
	})

	// Both halves are timed. The criterion's two seconds is a budget for what happens when
	// somebody selects two hundred issues and presses a key, and the fan-out is only the
	// second half of that — timing it alone would let the edit itself regress to thirty
	// seconds with the budget still reported as met.
	start := time.Now()
	_, skipped, _, err := svc.BulkUpdateIssues(ctx, alice, domain.BulkUpdateIssuesInput{
		IDs: ids, StateID: &f.InProgress,
	})
	if err != nil {
		t.Fatalf("bulk update: %v", err)
	}
	if len(skipped) != 0 {
		t.Fatalf("the edit skipped %d issues: %+v", len(skipped), skipped)
	}
	edited := time.Since(start)

	delivered, err := svc.FanOut(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("fan out: %v", err)
	}
	total := time.Since(start)

	t.Logf("bulk edit of %d issues took %s; fan-out to %d subscribers took %s; total %s (budget 2s); %d deliveries",
		issues, edited, 2, total-edited, total, delivered)

	if total > 2*time.Second {
		t.Errorf("editing %d issues and fanning out took %s, over the 2s budget "+
			"(edit %s, fan-out %s)", issues, total, edited, total-edited)
	}

	// The criterion itself, one recipient at a time.
	assertOneCoalescedRow(t, svc, bob, "bob", issues)
	assertOneCoalescedRow(t, svc, carol, "carol", partial)

	if n := len(inbox(t, svc, dan)); n != 0 {
		t.Errorf("dan subscribed to none of the %d issues and got %d inbox rows", issues, n)
	}
	// Not the person who did it, however many issues they touched.
	if n := len(inbox(t, svc, alice)); n != 0 {
		t.Errorf("the actor was notified about their own bulk edit (%d rows)", n)
	}

	// And exactly two rows exist in total. The per-recipient assertions above cannot see a
	// row addressed to somebody outside the fixture, and "none for anybody else" is the
	// half of the criterion that a table-wide count is the only honest way to make.
	if got := notificationRowCount(t, db, f.WorkspaceID); got != 2 {
		t.Errorf("the workspace holds %d notification rows after one bulk edit, want 2 — "+
			"one for each of the two subscribers", got)
	}

	// One change row per inbox row, not per issue per subscriber. Coalescing that still
	// emitted a change per event would move the cost onto the sync stream rather than
	// removing it, and every client in the workspace would wake up four hundred times.
	if n := len(notificationChanges(t, db, f.WorkspaceID)); n != 2 {
		t.Errorf("two coalesced inbox rows produced %d change rows, want 2", n)
	}
}

// Acceptance test 3 in docs/07-milestones/01-milestone-1.md:
//
//	An issue is assigned -> exactly one notification row exists for the assignee, and none
//	for anybody else.
//
// TestFanOut_AssignmentNotifiesOnlyTheAssignee in notifications_test.go already establishes
// this and does it well: it subscribes a watcher before the assignment specifically to cover
// the negative, and checks all three users the fixture holds. What it cannot do is say
// "none for anybody else" about anybody it does not name — its negatives are three
// per-recipient reads, so the claim is exactly as exhaustive as the reader's knowledge that
// the fixture has three users, which is a fact about the fixture rather than about the code.
// Add a fourth user to testutil and the test keeps passing while covering less.
//
// This states the same criterion as a count over the table, which is the only phrasing that
// stays true as the fixture grows.
func TestFanOut_AssignmentPutsExactlyOneRowInTheWholeWorkspace(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	bobID := f.NewUser(t, "bob", "member", true)
	carolID := f.NewUser(t, "carol", "member", true)
	// A fourth member, in the team and subscribed to nothing, who exists only to be
	// somebody the per-recipient assertions next door would not have thought to check.
	f.NewUser(t, "erin", "member", true)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Needs an owner",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	// Carol watches it first. A watcher hearing about somebody else's assignment is the
	// half of the criterion that is easy to fail.
	carol := f.PrincipalFor(carolID, authz.RoleMember, f.TeamID)
	if _, _, err := svc.SetIssueSubscription(ctx, carol, issue.ID, true); err != nil {
		t.Fatalf("subscribe carol: %v", err)
	}

	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{
		ID: issue.ID, AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)
	got := inbox(t, svc, bob)
	if len(got) != 1 {
		t.Fatalf("the assignee has %d notifications, want exactly 1: %+v", len(got), got)
	}
	if got[0].Type != model.NotifyIssueAssigned {
		t.Errorf("the assignee got a %q notification, want %q", got[0].Type, model.NotifyIssueAssigned)
	}

	// The whole criterion in one number. Anybody the workspace holds — the actor, the
	// watcher, the member nobody thought about — is covered by this and by nothing else.
	if n := notificationRowCount(t, db, f.WorkspaceID); n != 1 {
		t.Errorf("one assignment produced %d notification rows across the workspace, want 1. "+
			"Exactly one person was assigned, so every row beyond the first is somebody being "+
			"told about work that is not theirs.", n)
	}
}

// assertOneCoalescedRow checks that a subscriber got exactly one row carrying the whole
// batch, which is the shape the criterion asks for rather than merely a small number.
func assertOneCoalescedRow(t *testing.T, svc *domain.Service, p *authz.Principal, who string, count int) {
	t.Helper()

	got := inbox(t, svc, p)
	if len(got) != 1 {
		t.Errorf("%s watched %d issues in one batch and got %d inbox rows, want 1: %+v",
			who, count, len(got), got)
		return
	}
	if got[0].Type != model.NotifyIssueStatusChanged {
		t.Errorf("%s got a %q notification, want %q", who, got[0].Type, model.NotifyIssueStatusChanged)
	}
	// The count is what makes one row an honest summary of many events rather than a
	// silent drop of all but the first.
	if got[0].Count != count {
		t.Errorf("%s's row carries a count of %d, want %d — the other %d events were lost "+
			"rather than coalesced", who, got[0].Count, count, count-got[0].Count)
	}
}

// notificationRowCount counts every inbox row in the workspace, for whoever it is addressed
// to.
func notificationRowCount(t *testing.T, db *store.DB, workspaceID uuid.UUID) int {
	t.Helper()
	var n int
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT count(*) FROM notification WHERE workspace_id = $1`, workspaceID,
	).Scan(&n); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	return n
}

// seedIssuesWithSubscribers creates n issues, asking `subscribers` who watches each.
//
// Written against the store rather than the domain layer for the reason testutil gives: a
// fan-out test that built its two hundred issues through the code under test would fail for
// two hundred unrelated reasons the day issue creation breaks.
func seedIssuesWithSubscribers(
	t *testing.T, f *testutil.Fixture, n int, subscribers func(i int) []uuid.UUID,
) []uuid.UUID {
	t.Helper()
	ctx := context.Background()

	ids := make([]uuid.UUID, 0, n)
	err := f.DB.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		for i := range n {
			number, err := q.AllocateIssueNumber(ctx, f.TeamID)
			if err != nil {
				return err
			}
			id := uuid.Must(uuid.NewV7())
			if _, err := q.CreateIssue(ctx, store.CreateIssueParams{
				ID:          id,
				WorkspaceID: f.WorkspaceID,
				TeamID:      f.TeamID,
				Number:      number,
				Title:       fmt.Sprintf("Bulk issue %d", i),
				StateID:     f.Todo,
				CreatorID:   &f.UserID,
				SortOrder:   fmt.Sprintf("c%04d", i),
			}); err != nil {
				return err
			}
			for _, userID := range subscribers(i) {
				if _, err := q.EnsureIssueSubscription(ctx, store.EnsureIssueSubscriptionParams{
					ID:          uuid.Must(uuid.NewV7()),
					WorkspaceID: f.WorkspaceID,
					IssueID:     id,
					UserID:      userID,
					Reason:      model.SubscribedManual,
				}); err != nil {
					return err
				}
			}
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed issues: %v", err)
	}
	return ids
}
