package domain_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/push"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestRegisterPushDevice_UpsertsByToken(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	id1, _, err := svc.RegisterPushDevice(ctx, alice, domain.RegisterPushDeviceInput{
		Token: "tok-1", Platform: "ios", AppBundle: "com.peixotolabs.polaris", Environment: "sandbox",
	})
	if err != nil {
		t.Fatal(err)
	}
	if id1 == uuid.Nil {
		t.Fatal("expected an id")
	}

	// Same token again — moves the row, does not fail.
	_, _, err = svc.RegisterPushDevice(ctx, alice, domain.RegisterPushDeviceInput{
		Token: "tok-1", Platform: "ios", Environment: "sandbox",
	})
	if err != nil {
		t.Fatal(err)
	}

	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, "member", f.TeamID)
	// Bob steals the token: the UNIQUE constraint moves ownership.
	_, _, err = svc.RegisterPushDevice(ctx, bob, domain.RegisterPushDeviceInput{
		Token: "tok-1", Platform: "ios", Environment: "sandbox",
	})
	if err != nil {
		t.Fatal(err)
	}

	devices, err := db.Queries().ListPushDevicesForUser(ctx, alice.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 0 {
		t.Fatalf("alice should have lost the token, still has %d", len(devices))
	}
	devices, err = db.Queries().ListPushDevicesForUser(ctx, bobID)
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].Token != "tok-1" {
		t.Fatalf("bob devices = %+v", devices)
	}
}

func TestDeliverPushNotifications_SendsAndClaims(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, "member", f.TeamID)

	_, _, err := svc.RegisterPushDevice(ctx, alice, domain.RegisterPushDeviceInput{
		Token: "device-token", Platform: "ios", Environment: "sandbox",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Bob assigns an issue to alice so FanOut writes an inbox row (the actor is never notified).
	_, _, err = svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Needs a push", AssigneeID: &alice.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatal(err)
	}

	sender := &push.Recorder{}
	n, err := svc.DeliverPushNotifications(ctx, sender)
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("expected at least one alert")
	}
	if len(sender.Sent) == 0 {
		t.Fatal("sender recorded nothing")
	}
	if sender.Sent[0].Token != "device-token" {
		t.Fatalf("token = %q", sender.Sent[0].Token)
	}
	if sender.Sent[0].Environment != push.Sandbox {
		t.Fatalf("env = %q", sender.Sent[0].Environment)
	}
	if got := sender.Sent[0].Body; got == "" || got == "updated an issue" {
		t.Fatalf("body should name the assignment, got %q", got)
	}

	// Second pass claims nothing — at-most-once.
	sender.Reset()
	n, err = svc.DeliverPushNotifications(ctx, sender)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 || len(sender.Sent) != 0 {
		t.Fatalf("second pass sent %d alerts (%d recorded)", n, len(sender.Sent))
	}
}

func TestDeliverPushNotifications_DropsUnregisteredToken(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	_, _, err := svc.RegisterPushDevice(ctx, alice, domain.RegisterPushDeviceInput{
		Token: "stale", Platform: "ios", Environment: "production",
	})
	if err != nil {
		t.Fatal(err)
	}
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, "member", f.TeamID)
	_, _, err = svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ping", AssigneeID: &alice.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatal(err)
	}

	sender := &push.Recorder{Next: push.Result{Status: http.StatusGone, Reason: "Unregistered"}}
	_, err = svc.DeliverPushNotifications(ctx, sender)
	if err != nil {
		// Gone tokens are handled, not returned as the pass error when nothing else fails.
		t.Log(err)
	}
	devices, err := db.Queries().ListPushDevicesForUser(ctx, alice.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 0 {
		t.Fatalf("stale token should have been deleted, still have %d", len(devices))
	}
}
