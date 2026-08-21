package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestSetProjectSubscription_NotifiesOnCreateIntoTheProjectAndSkipsTheActor(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	project, _, err := svc.CreateProject(ctx, alice, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	sub, _, err := svc.SetProjectSubscription(ctx, alice, domain.SetProjectSubscriptionInput{
		ProjectID: project.ID, IssuesAdded: true, IssuesCompleted: true, Updates: true,
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if !sub.IssuesAdded || !sub.IssuesCompleted || !sub.Updates {
		t.Fatalf("flags: %+v", sub)
	}

	if _, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Alice's", ProjectID: &project.ID,
	}); err != nil {
		t.Fatalf("alice create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyProjectIssueAdded); n != 0 {
		t.Fatalf("alice was notified of her own create %d times", n)
	}

	if _, _, err := svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Bob's", ProjectID: &project.ID,
	}); err != nil {
		t.Fatalf("bob create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyProjectIssueAdded); n != 1 {
		t.Fatalf("alice got %d added notifications, want 1", n)
	}

	other, _, err := svc.CreateProject(ctx, alice, domain.CreateProjectInput{
		Name: "Other", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("other project: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Elsewhere", ProjectID: &other.ID,
	}); err != nil {
		t.Fatalf("other create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyProjectIssueAdded); n != 1 {
		t.Fatalf("an issue in another project notified alice (count %d)", n)
	}
}

func TestSetProjectSubscription_UpdateFiresForWatchers(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	project, _, err := svc.CreateProject(ctx, alice, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if _, _, err := svc.SetProjectSubscription(ctx, alice, domain.SetProjectSubscriptionInput{
		ProjectID: project.ID, Updates: true,
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	if _, _, err := svc.CreateProjectUpdate(ctx, bob, domain.CreateProjectUpdateInput{
		ProjectID: project.ID, Health: model.ProjectUpdateHealthOnTrack, Body: "Shipped",
	}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyProjectUpdate); n != 1 {
		t.Fatalf("alice got %d update notifications, want 1", n)
	}
}

func TestSetInitiativeSubscription_NotifiesOnLinkedProjectIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	project, _, err := svc.CreateProject(ctx, alice, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	init, _, err := svc.CreateInitiative(ctx, alice, domain.CreateInitiativeInput{Name: "Reliability"})
	if err != nil {
		t.Fatalf("create initiative: %v", err)
	}
	if _, _, err := svc.AddInitiativeProject(ctx, alice, init.ID, project.ID); err != nil {
		t.Fatalf("link: %v", err)
	}
	if _, _, err := svc.SetInitiativeSubscription(ctx, alice, domain.SetInitiativeSubscriptionInput{
		InitiativeID: init.ID, IssuesAdded: true, Updates: true,
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	if _, _, err := svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "In the initiative", ProjectID: &project.ID,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyInitiativeIssueAdded); n != 1 {
		t.Fatalf("alice got %d initiative added notifications, want 1", n)
	}

	if _, _, err := svc.CreateInitiativeUpdate(ctx, bob, domain.CreateInitiativeUpdateInput{
		InitiativeID: init.ID, Health: model.ProjectUpdateHealthAtRisk, Body: "Slip",
	}); err != nil {
		t.Fatalf("initiative update: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyInitiativeUpdate); n != 1 {
		t.Fatalf("alice got %d initiative update notifications, want 1", n)
	}
}

func TestSetCustomerSubscription_NotifiesOnRequestAddedAndImportant(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	cust, _, err := svc.CreateCustomer(ctx, alice, domain.CreateCustomerInput{Name: "Acme"})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	if _, _, err := svc.SetCustomerSubscription(ctx, alice, domain.SetCustomerSubscriptionInput{
		CustomerID: cust.ID, RequestAdded: true, RequestImportant: true, RequestCompleted: true,
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, bob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "SSO",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	req, _, err := svc.CreateCustomerRequest(ctx, bob, domain.CreateCustomerRequestInput{
		CustomerID: &cust.ID, IssueID: &issue.ID, Body: "Need SSO",
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyCustomerRequestAdded); n != 1 {
		t.Fatalf("alice got %d request-added notifications, want 1", n)
	}

	important := true
	if _, _, err := svc.UpdateCustomerRequest(ctx, bob, domain.UpdateCustomerRequestInput{
		ID: req.ID, Important: &important,
	}); err != nil {
		t.Fatalf("mark important: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, alice, model.NotifyCustomerRequestImportant); n != 1 {
		t.Fatalf("alice got %d important notifications, want 1", n)
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
	if n := countType(t, svc, alice, model.NotifyCustomerRequestCompleted); n != 1 {
		t.Fatalf("alice got %d completed notifications, want 1", n)
	}
}

func TestSetProjectSubscription_GuestRefusedAndAllFalseUnsubscribes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	project, _, err := svc.CreateProject(ctx, alice, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	guestID := f.NewUser(t, "guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)
	if _, _, err := svc.SetProjectSubscription(ctx, guest, domain.SetProjectSubscriptionInput{
		ProjectID: project.ID, IssuesAdded: true,
	}); platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("guest subscribe: %v", err)
	}

	if _, _, err := svc.SetProjectSubscription(ctx, alice, domain.SetProjectSubscriptionInput{
		ProjectID: project.ID, IssuesAdded: true,
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if _, _, err := svc.SetProjectSubscription(ctx, alice, domain.SetProjectSubscriptionInput{
		ProjectID: project.ID,
	}); err != nil {
		t.Fatalf("unsubscribe: %v", err)
	}
	if _, _, err := svc.SetProjectSubscription(ctx, alice, domain.SetProjectSubscriptionInput{
		ProjectID: project.ID,
	}); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("second unsubscribe: %v", err)
	}
}
