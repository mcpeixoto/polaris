package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/push"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Push delivery against a real Postgres and a sender that never leaves the process.
// What has to hold is the filtering: a phone registered after a row was written does not
// receive the backlog, a type the default leaves off is not sent, a second pass does not
// send again, and a device the push service has forgotten is deleted.

type fakePush struct {
	err    error
	bodies [][]byte
}

func (f *fakePush) Send(_ context.Context, _ push.Subscription, payload []byte) error {
	f.bodies = append(f.bodies, append([]byte(nil), payload...))
	return f.err
}

func TestDeliverPushes_SkipsTheBacklogAndDoesNotRepeat(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	// Written before any phone exists. Registering afterwards must not dump it onto the
	// lock screen; the inbox already has it.
	early := mustIssue(t, svc, alice, f, "Already happened")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: early, AssigneeID: &bobID})
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	if err := svc.RegisterPushSubscription(ctx, bob, "https://push.example/bob", "p256dh-key", "auth-key"); err != nil {
		t.Fatalf("register: %v", err)
	}

	sender := &fakePush{}
	if n, err := svc.DeliverPushes(ctx, sender); err != nil || n != 0 || len(sender.bodies) != 0 {
		t.Fatalf("backlog was pushed: n=%d err=%v bodies=%d", n, err, len(sender.bodies))
	}

	later := mustIssue(t, svc, alice, f, "Fresh")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: later, AssigneeID: &bobID})
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	n, err := svc.DeliverPushes(ctx, sender)
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if n != 1 || len(sender.bodies) != 1 {
		t.Fatalf("sent %d (bodies %d), want 1", n, len(sender.bodies))
	}
	var msg struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	}
	if err := json.Unmarshal(sender.bodies[0], &msg); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if !strings.HasSuffix(msg.Title, " assigned to you") {
		t.Fatalf("title = %q, want an assignment", msg.Title)
	}
	if msg.URL == "/" || msg.URL == "" {
		t.Fatalf("url = %q, want the issue", msg.URL)
	}

	n, err = svc.DeliverPushes(ctx, sender)
	if err != nil || n != 0 || len(sender.bodies) != 1 {
		t.Fatalf("second pass sent again: n=%d err=%v bodies=%d", n, err, len(sender.bodies))
	}
}

func TestDeliverPushes_DefaultLeavesStatusChangesAlone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	if err := svc.RegisterPushSubscription(ctx, bob, "https://push.example/bob", "p256dh-key", "auth-key"); err != nil {
		t.Fatalf("register: %v", err)
	}

	issue := mustIssue(t, svc, alice, f, "Moving")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: issue, AssigneeID: &bobID})
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	sender := &fakePush{}
	if _, err := svc.DeliverPushes(ctx, sender); err != nil {
		t.Fatalf("deliver assignment: %v", err)
	}
	if len(sender.bodies) != 1 {
		t.Fatalf("assignment was not pushed, bodies=%d", len(sender.bodies))
	}

	// A later status change is a new inbox row. The phone's default does not include it.
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: issue, StateID: &f.InProgress})
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out status: %v", err)
	}
	n, err := svc.DeliverPushes(ctx, sender)
	if err != nil {
		t.Fatalf("deliver status: %v", err)
	}
	if n != 0 || len(sender.bodies) != 1 {
		t.Fatalf("a status change was pushed: n=%d bodies=%d", n, len(sender.bodies))
	}
}

func TestDeliverPushes_GoneSubscriptionIsForgotten(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	if err := svc.RegisterPushSubscription(ctx, bob, "https://push.example/gone", "p256dh-key", "auth-key"); err != nil {
		t.Fatalf("register: %v", err)
	}

	issue := mustIssue(t, svc, alice, f, "Once")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: issue, AssigneeID: &bobID})
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	sender := &fakePush{err: push.ErrGone}
	if _, err := svc.DeliverPushes(ctx, sender); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if len(sender.bodies) != 1 {
		t.Fatalf("the gone device was not attempted, bodies=%d", len(sender.bodies))
	}

	again := mustIssue(t, svc, alice, f, "After")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: again, AssigneeID: &bobID})
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	sender.err = nil
	n, err := svc.DeliverPushes(ctx, sender)
	if err != nil {
		t.Fatalf("second deliver: %v", err)
	}
	if n != 0 || len(sender.bodies) != 1 {
		t.Fatalf("a forgotten device was pushed again: n=%d bodies=%d", n, len(sender.bodies))
	}
}

func TestRegisterPushSubscription_RejectsAPlainHTTPEndpoint(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	err := svc.RegisterPushSubscription(context.Background(), f.Principal(), "http://push.example/x", "k", "a")
	if err == nil {
		t.Fatal("an http endpoint was accepted")
	}
}
