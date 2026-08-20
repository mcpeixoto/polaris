package domain_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestSetViewSubscription_NotifiesOnCreateIntoTheViewAndSkipsTheActor(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	view, _, err := svc.CreateView(ctx, alice, domain.CreateViewInput{
		Name:   "Urgent",
		Filter: json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
	})
	if err != nil {
		t.Fatalf("create view: %v", err)
	}

	sub, _, err := svc.SetViewSubscription(ctx, alice, domain.SetViewSubscriptionInput{
		ViewID: view.ID, Added: true, Completed: true,
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if !sub.Added || !sub.Completed {
		t.Fatalf("subscription flags: added=%v completed=%v", sub.Added, sub.Completed)
	}

	// Alice files an urgent issue herself: the fan-out must not tell her about her own create.
	if _, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Alice's P1", Priority: 1,
	}); err != nil {
		t.Fatalf("alice create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyViewIssueAdded); n != 0 {
		t.Fatalf("alice was notified of her own create %d times", n)
	}

	if _, _, err := svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Bob's P1", Priority: 1,
	}); err != nil {
		t.Fatalf("bob create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyViewIssueAdded); n != 1 {
		t.Fatalf("alice got %d added notifications, want 1", n)
	}

	// A matching issue that is not urgent must not fire.
	if _, _, err := svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Bob's P4", Priority: 4,
	}); err != nil {
		t.Fatalf("bob low-priority create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyViewIssueAdded); n != 1 {
		t.Fatalf("a non-matching create notified alice (count %d)", n)
	}
}

func TestSetViewSubscription_CompletedFiresWhenAMatchingIssueFinishes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	view, _, err := svc.CreateView(ctx, alice, domain.CreateViewInput{
		Name:   "Everything",
		Filter: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("create view: %v", err)
	}
	if _, _, err := svc.SetViewSubscription(ctx, alice, domain.SetViewSubscriptionInput{
		ViewID: view.ID, Added: false, Completed: true,
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Finish me",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyViewIssueCompleted); n != 0 {
		t.Fatalf("create notified as completed (%d)", n)
	}

	done := f.Done
	if _, _, err := svc.UpdateIssue(ctx, bob, domain.UpdateIssueInput{
		ID: issue.ID, StateID: &done,
	}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyViewIssueCompleted); n != 1 {
		t.Fatalf("alice got %d completed notifications, want 1", n)
	}
}

func TestSetViewSubscription_GuestCannotSubscribe(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	view, _, err := svc.CreateView(ctx, admin, domain.CreateViewInput{
		Name: "Open", Filter: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("create view: %v", err)
	}

	guestID := f.NewUser(t, "guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)
	_, _, err = svc.SetViewSubscription(ctx, guest, domain.SetViewSubscriptionInput{
		ViewID: view.ID, Added: true,
	})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("guest subscribe: %v", err)
	}
}

func TestSetViewSubscription_BothFalseUnsubscribes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	view, _, err := svc.CreateView(ctx, p, domain.CreateViewInput{
		Name: "Watch", Filter: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("create view: %v", err)
	}
	if _, _, err := svc.SetViewSubscription(ctx, p, domain.SetViewSubscriptionInput{
		ViewID: view.ID, Added: true,
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if _, _, err := svc.SetViewSubscription(ctx, p, domain.SetViewSubscriptionInput{
		ViewID: view.ID,
	}); err != nil {
		t.Fatalf("unsubscribe: %v", err)
	}
	if _, _, err := svc.SetViewSubscription(ctx, p, domain.SetViewSubscriptionInput{
		ViewID: view.ID,
	}); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("second unsubscribe: %v", err)
	}
}

func countType(t *testing.T, svc *domain.Service, p *authz.Principal, typ string) int {
	t.Helper()
	rows, err := svc.ListNotifications(context.Background(), p, true, true, 500)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	n := 0
	for _, row := range rows {
		if row.Type == typ {
			n++
		}
	}
	return n
}
