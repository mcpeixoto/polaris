package domain

import (
	"context"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/integrations/apple"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestApplyAppStoreTransaction_GrantsPro(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	f.SetPlan(t, entitlement.PlanFree)
	svc := NewService(db)
	svc.parseApple = activeAppleTransaction

	ws, _, err := svc.ApplyAppStoreTransaction(context.Background(), f.Principal(), "signed")
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if ws.Plan != string(entitlement.PlanPro) {
		t.Fatalf("plan = %s, want pro", ws.Plan)
	}
}

func TestApplyAppStoreTransaction_DoesNotReplaceALiveStripeSubscription(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := NewService(db)
	ctx := context.Background()

	period := time.Now().Add(10 * 24 * time.Hour)
	subID := "sub_stripe"
	if _, _, err := svc.ApplySubscription(ctx, SubscriptionState{
		WorkspaceID:      f.WorkspaceID,
		Provider:         "stripe",
		CustomerID:       "cus_stripe",
		SubscriptionID:   &subID,
		Status:           SubscriptionActive,
		CurrentPeriodEnd: &period,
		Plan:             entitlement.PlanPro,
	}); err != nil {
		t.Fatalf("stripe: %v", err)
	}

	svc.parseApple = activeAppleTransaction
	if _, _, err := svc.ApplyAppStoreTransaction(ctx, f.Principal(), "signed"); err != nil {
		t.Fatalf("apply: %v", err)
	}
	row, err := db.Queries().GetSubscription(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("get subscription: %v", err)
	}
	if row.Provider != "stripe" || row.ProviderCustomerID != "cus_stripe" {
		t.Fatalf("provider = %s customer %s, want the stripe row left in place", row.Provider, row.ProviderCustomerID)
	}
}

func TestApplyAppStoreTransaction_RejectsAMember(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := NewService(db)
	svc.parseApple = activeAppleTransaction

	bob := f.NewUser(t, "bob", "member", true)
	_, _, err := svc.ApplyAppStoreTransaction(context.Background(), f.PrincipalFor(bob, authz.RoleMember, f.TeamID), "signed")
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("code = %s, want forbidden (%v)", platform.CodeOf(err), err)
	}
}

func TestSweepLapsedPlans_ExpiresAnAppleSubscriptionWhosePeriodHasEnded(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := NewService(db)
	ctx := context.Background()

	past := time.Now().Add(-time.Hour)
	subID := "apple-1"
	if _, _, err := svc.ApplySubscription(ctx, SubscriptionState{
		WorkspaceID:      f.WorkspaceID,
		Provider:         "apple",
		CustomerID:       subID,
		SubscriptionID:   &subID,
		Status:           SubscriptionActive,
		CurrentPeriodEnd: &past,
		Plan:             entitlement.PlanPro,
	}); err != nil {
		t.Fatalf("apply: %v", err)
	}

	n, err := svc.SweepLapsedPlans(ctx, time.Now())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("the sweep changed %d workspaces, want 1", n)
	}
	ws, err := db.Queries().GetWorkspace(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	if ws.Plan != string(entitlement.PlanFree) {
		t.Fatalf("plan = %s, want free", ws.Plan)
	}
	row, err := db.Queries().GetSubscription(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("subscription: %v", err)
	}
	if row.Status != string(SubscriptionCanceled) {
		t.Fatalf("status = %s, want canceled", row.Status)
	}
	if n, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil || n != 0 {
		t.Fatalf("a second sweep changed %d workspaces (err %v), want 0", n, err)
	}
}

func activeAppleTransaction(string) (apple.Transaction, error) {
	return apple.Transaction{
		BundleID:              apple.BundleID,
		ProductID:             apple.ProductMonthly,
		OriginalTransactionID: "2000000000000001",
		Environment:           "Sandbox",
		ExpiresAt:             time.Now().Add(30 * 24 * time.Hour),
	}, nil
}
