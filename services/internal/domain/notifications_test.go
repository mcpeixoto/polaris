package domain_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The fan-out against a real Postgres. The rules themselves are tested without one in
// internal/notify; what these prove is the part that only a database can: that the unique
// index coalesces, that a replayed pass changes nothing, and that the engine reading its own
// output does not spiral.

// inbox is everything in somebody's inbox, read and snoozed included, so a test cannot pass
// because a row was filtered out of the default view.
func inbox(t *testing.T, svc *domain.Service, p *authz.Principal) []model.Notification {
	t.Helper()
	rows, err := svc.ListNotifications(context.Background(), p, true, true, 500)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	return rows
}

// notificationChanges is every change row the engine emitted for an inbox row.
func notificationChanges(t *testing.T, db *store.DB, workspaceID uuid.UUID) []store.ChangeLog {
	t.Helper()
	rows, err := db.Queries().ReadChangesSince(context.Background(), store.ReadChangesSinceParams{
		WorkspaceID: workspaceID, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 5000,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	var out []store.ChangeLog
	for _, r := range rows {
		if r.EntityType == "notification" {
			out = append(out, r)
		}
	}
	return out
}

// TestFanOut_AssignmentNotifiesOnlyTheAssignee is M1 acceptance test 3.
func TestFanOut_AssignmentNotifiesOnlyTheAssignee(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)
	carolID := f.NewUser(t, "carol", "member", true)
	carol := f.PrincipalFor(carolID, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	// Carol is watching. A watcher hearing about somebody else's assignment is the "none
	// for anybody else" half of the acceptance test, and the half that is easy to fail.
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

	got := inbox(t, svc, bob)
	if len(got) != 1 {
		t.Fatalf("the assignee has %d notifications, want exactly 1: %+v", len(got), got)
	}
	if got[0].Type != model.NotifyIssueAssigned {
		t.Errorf("expected %q, got %q", model.NotifyIssueAssigned, got[0].Type)
	}
	if got[0].IssueID == nil || *got[0].IssueID != issue.ID {
		t.Errorf("the notification does not point at the issue: %+v", got[0])
	}
	if got[0].Count != 1 {
		t.Errorf("one assignment should count once, got %d", got[0].Count)
	}

	// Nobody else. Not the actor, who would notice within the hour, and not the watcher,
	// who would take a week to work out why her inbox is full of other people's work.
	if n := len(inbox(t, svc, alice)); n != 0 {
		t.Errorf("the actor was notified about their own assignment (%d rows)", n)
	}
	if n := len(inbox(t, svc, carol)); n != 0 {
		t.Errorf("a subscriber was notified about somebody else's assignment (%d rows)", n)
	}
}

// TestFanOut_BulkEditCoalescesIntoOneRowPerSubscriber is M1 acceptance test 8: two hundred
// issues moved in one action produce one inbox row per person, carrying a count.
func TestFanOut_BulkEditCoalescesIntoOneRowPerSubscriber(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	const issues = 200
	ids := seedSubscribedIssues(t, f, bobID, issues)

	// The real path, not a hand-rolled emit: one call, one version block, one batch key.
	// That block is what the group key is derived from, so a change to how bulk edits emit
	// shows up here as two hundred inbox rows.
	_, skipped, _, err := svc.BulkUpdateIssues(ctx, alice, domain.BulkUpdateIssuesInput{
		IDs: ids, StateID: &f.InProgress,
	})
	if err != nil {
		t.Fatalf("bulk update: %v", err)
	}
	if len(skipped) != 0 {
		t.Fatalf("the edit skipped %d issues: %+v", len(skipped), skipped)
	}

	start := time.Now()
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	// The other half of acceptance test 8. A wall-clock assertion is usually a bad idea in a
	// test, and this one earns its place because the budget is roughly forty times what the
	// pass actually costs: it cannot fail because a machine was busy, only because somebody
	// put a query back inside the per-issue loop — which is a hundredfold regression, not a
	// ten-percent one.
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("fanning out %d issues took %s, over the 2s budget", issues, elapsed)
	}

	got := inbox(t, svc, bob)
	if len(got) != 1 {
		t.Fatalf("a subscriber to %d issues edited at once got %d inbox rows, want 1", issues, len(got))
	}
	if got[0].Type != model.NotifyIssueStatusChanged {
		t.Errorf("expected %q, got %q", model.NotifyIssueStatusChanged, got[0].Type)
	}
	if got[0].Count != issues {
		t.Errorf("the row should carry a count of %d, got %d", issues, got[0].Count)
	}

	// And one delta, not two hundred. Coalescing that still emits a change row per event
	// moves the cost the feature removes onto the sync stream instead of removing it.
	if n := len(notificationChanges(t, db, f.WorkspaceID)); n != 1 {
		t.Errorf("one coalesced inbox row produced %d change rows, want 1", n)
	}
}

func TestFanOut_UnsubscribedUserIsNotNotifiedEvenWhenMentioned(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Noisy thread",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	// Bob says: not this one.
	if _, _, err := svc.SetIssueSubscription(ctx, bob, issue.ID, false); err != nil {
		t.Fatalf("unsubscribe: %v", err)
	}

	if _, _, err := svc.CreateComment(ctx, alice, domain.CreateCommentInput{
		IssueID: issue.ID,
		Body:    fmt.Sprintf("any thoughts @[Bob](user:%s)?", bobID),
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}

	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	if got := inbox(t, svc, bob); len(got) != 0 {
		t.Fatalf("an unsubscribed user was notified: %+v", got)
	}

	// And the mention did not quietly put him back on the list. Auto-subscribe resurrecting
	// an explicit unsubscribe is the bug that makes the button work for four minutes.
	sub, err := db.Queries().GetIssueSubscription(ctx, store.GetIssueSubscriptionParams{
		IssueID: issue.ID, UserID: bobID,
	})
	if err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	if !sub.Unsubscribed {
		t.Error("being mentioned re-subscribed a user who had unsubscribed")
	}
}

func TestFanOut_ReplayDeliversNothingTwice(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Something to watch",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.SetIssueSubscription(ctx, bob, issue.ID, true); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{
		ID: issue.ID, StateID: &f.InProgress,
	}); err != nil {
		t.Fatalf("move status: %v", err)
	}

	delivered, err := svc.FanOut(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("first pass: %v", err)
	}
	if delivered != 1 {
		t.Fatalf("first pass delivered %d, want 1", delivered)
	}

	// Rewind the watermark, which is the state a worker killed between writing its rows and
	// committing its cursor leaves behind. Written straight to the table because the
	// query deliberately cannot do it — AdvanceNotificationCursor is guarded so that two
	// workers racing cannot move it backwards.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE notification_cursor SET version = 0 WHERE workspace_id = $1`, f.WorkspaceID); err != nil {
		t.Fatalf("rewind cursor: %v", err)
	}

	if delivered, err = svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("replayed pass: %v", err)
	}
	if delivered != 0 {
		t.Errorf("a replayed pass delivered %d rows; the guard on (user_id, group_key) did not hold", delivered)
	}

	got := inbox(t, svc, bob)
	if len(got) != 1 {
		t.Fatalf("after a replay the inbox has %d rows, want 1", len(got))
	}
	if got[0].Count != 1 {
		t.Errorf("a replay inflated the count to %d", got[0].Count)
	}
}

func TestFanOut_DoesNotNotifyAboutItsOwnNotifications(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Watch me",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.SetIssueSubscription(ctx, bob, issue.ID, true); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, alice, domain.CreateCommentInput{
		IssueID: issue.ID, Body: "first",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}

	// Every pass emits change rows for the inbox rows it writes, and the next pass reads
	// them. Without the skip in internal/notify this converges on nothing and the third
	// pass is notifying people about being notified about being notified.
	for pass := range 3 {
		if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
			t.Fatalf("pass %d: %v", pass, err)
		}
	}

	got := inbox(t, svc, bob)
	if len(got) != 1 || got[0].Type != model.NotifyComment {
		t.Fatalf("expected exactly one comment notification after three passes, got %+v", got)
	}
	if got[0].Count != 1 {
		t.Errorf("repeated passes inflated the count to %d", got[0].Count)
	}
}

func TestNotificationOwnership_HasNoAdminOverride(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// Alice is the workspace owner, which is as much authority as this product has.
	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	if _, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Mine", AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	got := inbox(t, svc, bob)
	if len(got) != 1 {
		t.Fatalf("expected one notification for the assignee, got %d", len(got))
	}

	// An admin needs to be able to delete an abusive comment. An admin has no business in
	// somebody's inbox, and not-found rather than forbidden is the answer because whether
	// the row exists is itself none of their business.
	for _, tc := range []struct {
		name string
		do   func() error
	}{
		{"read", func() error {
			_, _, err := svc.MarkNotificationRead(ctx, alice, got[0].ID, true)
			return err
		}},
		{"snooze", func() error {
			_, _, err := svc.SnoozeNotification(ctx, alice, got[0].ID, nil)
			return err
		}},
		{"delete", func() error {
			_, _, err := svc.DeleteNotification(ctx, alice, got[0].ID)
			return err
		}},
	} {
		err := tc.do()
		if err == nil {
			t.Fatalf("an owner could %s somebody else's notification", tc.name)
		}
		if code := platform.CodeOf(err); code != platform.CodeNotFound {
			t.Errorf("%s: expected %s, got %s (%v)", tc.name, platform.CodeNotFound, code, err)
		}
	}

	// Bob's own inbox still works, and the badge follows it.
	if _, _, err := svc.MarkNotificationRead(ctx, bob, got[0].ID, true); err != nil {
		t.Fatalf("bob could not read his own notification: %v", err)
	}
	unread, err := svc.UnreadNotificationCount(ctx, bob)
	if err != nil {
		t.Fatalf("unread count: %v", err)
	}
	if unread != 0 {
		t.Errorf("badge says %d after reading the only notification", unread)
	}
}

func TestUpdateNotificationPrefs_MutesOnlyTheOwnersDeliveries(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)
	carolID := f.NewUser(t, "carol", "member", true)
	carol := f.PrincipalFor(carolID, authz.RoleMember, f.TeamID)

	user, _, err := svc.UpdateNotificationPrefs(ctx, bob,
		// The array the client writes. This fixture used to be an object, matching a decoder
		// that only ever agreed with itself — the client's array failed to unmarshal and muted
		// nothing, and this test passed throughout. See notification_prefs_test.go.
		json.RawMessage(`{"muted":["issue_status_changed"]}`))
	if err != nil {
		t.Fatalf("update prefs: %v", err)
	}
	if len(user.NotificationPrefs) == 0 {
		t.Error("the caller's own preferences should come back on their user")
	}

	// The bag is personal, so its change is scoped to one person. A workspace-scoped user
	// payload carrying it would put everybody's delivery settings in everybody's replica.
	scope := userChangeScope(t, db, f.WorkspaceID, bobID)
	if scope.Kind != authz.ScopeUser || scope.UserID == nil || *scope.UserID != bobID {
		t.Errorf("preferences changed under scope %+v; expected a user scope for the owner", scope)
	}

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Moves about"})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	for _, p := range []*authz.Principal{bob, carol} {
		if _, _, err := svc.SetIssueSubscription(ctx, p, issue.ID, true); err != nil {
			t.Fatalf("subscribe: %v", err)
		}
	}
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{ID: issue.ID, StateID: &f.InProgress}); err != nil {
		t.Fatalf("move status: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	if got := inbox(t, svc, bob); len(got) != 0 {
		t.Errorf("a muted type was delivered anyway: %+v", got)
	}
	if got := inbox(t, svc, carol); len(got) != 1 {
		t.Errorf("one person's mute silenced somebody else: %d rows", len(got))
	}
}

func TestMyIssues_IsScopedToTheCallerAndTheirTeams(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	mine, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "For bob", AssigneeID: &bobID,
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "For nobody",
	}); err != nil {
		t.Fatalf("create issue: %v", err)
	}

	got, err := svc.MyIssues(ctx, bob, false)
	if err != nil {
		t.Fatalf("my issues: %v", err)
	}
	if len(got) != 1 || got[0].ID != mine.ID {
		t.Fatalf("expected only the issue assigned to bob, got %+v", got)
	}
	// Derived from the team key rather than stored, so a list that forgets to resolve it
	// hands the client a bare number.
	if got[0].Identifier != model.Identifier(f.TeamKey, got[0].Number) {
		t.Errorf("identifier is %q, want %q", got[0].Identifier, model.Identifier(f.TeamKey, got[0].Number))
	}

	// Completed work leaves the list unless it is asked for: My Issues is what is left to
	// do, not what has ever been done.
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{ID: mine.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if open, err := svc.MyIssues(ctx, bob, false); err != nil || len(open) != 0 {
		t.Fatalf("completed work is still on the open list (%d, err %v)", len(open), err)
	}
	if all, err := svc.MyIssues(ctx, bob, true); err != nil || len(all) != 1 {
		t.Fatalf("completed work is missing when asked for (%d, err %v)", len(all), err)
	}
}

// seedSubscribedIssues creates n issues in the fixture's team with one subscriber, in a
// single transaction.
//
// Written against the store rather than the domain layer for the reason testutil gives:
// a bulk-edit test that built its two hundred issues through the code under test would fail
// for two hundred unrelated reasons the day issue creation breaks.
func seedSubscribedIssues(t *testing.T, f *testutil.Fixture, subscriber uuid.UUID, n int) []uuid.UUID {
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
				SortOrder:   fmt.Sprintf("b%04d", i),
			}); err != nil {
				return err
			}
			if _, err := q.EnsureIssueSubscription(ctx, store.EnsureIssueSubscriptionParams{
				ID:          uuid.Must(uuid.NewV7()),
				WorkspaceID: f.WorkspaceID,
				IssueID:     id,
				UserID:      subscriber,
				Reason:      model.SubscribedManual,
			}); err != nil {
				return err
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

// userChangeScope returns the scope of the last change emitted for a user row.
func userChangeScope(t *testing.T, db *store.DB, workspaceID, userID uuid.UUID) authz.Scope {
	t.Helper()
	rows, err := db.Queries().ReadChangesSince(context.Background(), store.ReadChangesSinceParams{
		WorkspaceID: workspaceID, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 5000,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	var scope authz.Scope
	found := false
	for _, r := range rows {
		if r.EntityType != "user" || r.EntityID != userID {
			continue
		}
		s, err := authz.ParseScope(r.Scope)
		if err != nil {
			t.Fatalf("parse scope: %v", err)
		}
		scope, found = s, true
	}
	if !found {
		t.Fatal("no change row was emitted for the user")
	}
	return scope
}
