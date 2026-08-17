package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The half of the fan-out that has no workspace: what the worker actually calls.
//
// FanOut takes a workspace id, and the job that runs it has none — so between a complete,
// tested notification engine and an inbox that fills up there is a query that answers "where
// is there work" and a loop. That gap is where this feature spent its life: `FanOut` had no
// caller outside its own tests, every test named a workspace explicitly, and so the entire
// suite passed against a product whose `notification` table stayed empty forever.
//
// These tests drive FanOutAll and never name a workspace, which is the only way to exercise
// the part that was missing.

// TestFanOutAll_DeliversWithoutBeingToldWhichWorkspace is the whole defect in one assertion.
func TestFanOutAll_DeliversWithoutBeingToldWhichWorkspace(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{
		ID: issue.ID, AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("assign: %v", err)
	}

	delivered, err := svc.FanOutAll(ctx)
	if err != nil {
		t.Fatalf("fan out all: %v", err)
	}
	if delivered == 0 {
		t.Fatal("FanOutAll delivered nothing. Either the driving query does not find a " +
			"workspace with changes above its cursor, or it found it and the pass did not run " +
			"— and both are the same outcome for the person waiting to hear they were assigned " +
			"an issue: an inbox that never fills.")
	}
	if n := len(inbox(t, svc, bob)); n != 1 {
		t.Errorf("the assignee has %d notifications, want exactly 1", n)
	}
}

// TestFanOutAll_DoesNothingWhenThereIsNothingToDo pins the other half of the driving query.
//
// This is the ordinary case — the job runs every five seconds, and on an install where
// nobody is typing every one of those passes must find nothing. A query that returned every
// workspace regardless would still deliver the right rows, so the assertion here is not
// about correctness of the inbox: it is that a caught-up workspace is not reprocessed, which
// is what keeps an idle install from opening a transaction per workspace per tick.
func TestFanOutAll_DoesNothingWhenThereIsNothingToDo(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{
		ID: issue.ID, AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("assign: %v", err)
	}

	// Two passes, because the first one emits change rows of its own — the notification
	// upserts — and those sit above the watermark it just set. So the second pass has real
	// work to do and must still deliver nobody anything, and only the third is genuinely
	// idle. Asserting on the second would have hidden the engine notifying people about
	// being notified, which is the failure internal/notify's entity-type skip prevents.
	for pass := 1; pass <= 2; pass++ {
		if _, err := svc.FanOutAll(ctx); err != nil {
			t.Fatalf("pass %d: %v", pass, err)
		}
	}

	before := len(inbox(t, svc, f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)))

	delivered, err := svc.FanOutAll(ctx)
	if err != nil {
		t.Fatalf("idle pass: %v", err)
	}
	if delivered != 0 {
		t.Errorf("a caught-up workspace delivered %d more notifications", delivered)
	}
	if after := len(inbox(t, svc, f.PrincipalFor(bobID, authz.RoleMember, f.TeamID))); after != before {
		t.Errorf("an idle pass changed the inbox from %d rows to %d", before, after)
	}
}

// TestFanOutAll_FindsAWorkspaceThatHasNeverBeenFannedOut covers the LEFT JOIN.
//
// A workspace has no `notification_cursor` row until its first pass writes one, so the
// driving query has to treat "no row" as version 0 rather than dropping the workspace. An
// inner join here would be invisible in every other test — they all call FanOut directly,
// which reads the cursor with its own coalesce — and would mean a brand new workspace was
// the one workspace the scheduler never looked at.
func TestFanOutAll_FindsAWorkspaceThatHasNeverBeenFannedOut(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	cursor, err := db.Queries().GetNotificationCursor(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("read cursor: %v", err)
	}
	if cursor != 0 {
		t.Fatalf("the fixture arrived with a cursor at %d; this test needs one that has "+
			"never been fanned out", cursor)
	}

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{
		ID: issue.ID, AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("assign: %v", err)
	}

	pending, err := db.Queries().ListWorkspacesWithPendingNotifications(ctx)
	if err != nil {
		t.Fatalf("list pending: %v", err)
	}
	found := false
	for _, id := range pending {
		if id == f.WorkspaceID {
			found = true
		}
	}
	if !found {
		t.Error("a workspace with changes and no cursor row at all is not in the fan-out's " +
			"work list, so it would never be fanned out — see the LEFT JOIN in " +
			"ListWorkspacesWithPendingNotifications")
	}
}
