package domain_test

import (
	"context"
	"strings"
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

// A mention in a project update reaches whoever it names, follower or not, once, and nobody
// who could not open the project.
func TestProjectUpdateMention(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)
	carolID := f.NewUser(t, "carol", "member", true)
	carol := f.PrincipalFor(carolID, authz.RoleMember, f.TeamID)
	outsiderID := f.NewUser(t, "dan", "member", false)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember)

	project, _, err := svc.CreateProject(ctx, alice, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	// Carol follows and is named: one row, and it says she was mentioned.
	if _, _, err := svc.SetProjectSubscription(ctx, carol, domain.SetProjectSubscriptionInput{
		ProjectID: project.ID, Updates: true,
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	token := func(name string, id uuid.UUID) string { return "@[" + name + "](user:" + id.String() + ")" }
	body := "Ask " + token("bob", bobID) + " and " + token("carol", carolID) + " and " +
		token("dan", outsiderID) + " and " + token("me", alice.UserID)
	update, _, err := svc.CreateProjectUpdate(ctx, alice, domain.CreateProjectUpdateInput{
		ProjectID: project.ID, Health: model.ProjectUpdateHealthOnTrack, Body: body,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}

	if n := countType(t, svc, bob, model.NotifyMention); n != 1 {
		t.Fatalf("bob got %d mentions, want 1", n)
	}
	if n := countType(t, svc, carol, model.NotifyMention); n != 1 {
		t.Fatalf("carol got %d mentions, want 1", n)
	}
	if n := countType(t, svc, carol, model.NotifyProjectUpdate); n != 0 {
		t.Fatalf("carol was told twice about one update (%d follow rows)", n)
	}
	if n := countType(t, svc, outsider, model.NotifyMention); n != 0 {
		t.Fatalf("somebody outside the project's teams got %d mentions", n)
	}
	if n := countType(t, svc, alice, model.NotifyMention); n != 0 {
		t.Fatalf("the author was told about their own typing (%d)", n)
	}

	rows, err := svc.ListNotifications(ctx, bob, true, true, 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 || !strings.Contains(string(rows[0].Payload), project.ID.String()) {
		t.Fatalf("the mention does not say which project it is about: %+v", rows)
	}

	// Correcting the health alone is not a reason to ping everybody again.
	health := model.ProjectUpdateHealthAtRisk
	sameBody := update.Body
	if _, _, err := svc.UpdateProjectUpdate(ctx, alice, domain.UpdateProjectUpdateInput{
		ID: update.ID, Health: &health, Body: &sameBody,
	}); err != nil {
		t.Fatalf("edit health: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, bob, model.NotifyMention); n != 1 {
		t.Fatalf("a health edit re-notified bob (%d mentions)", n)
	}

	// Rewriting the words does, the same as a comment.
	rewritten := "Actually ask " + token("bob", bobID)
	if _, _, err := svc.UpdateProjectUpdate(ctx, alice, domain.UpdateProjectUpdateInput{
		ID: update.ID, Body: &rewritten,
	}); err != nil {
		t.Fatalf("edit body: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n := countType(t, svc, bob, model.NotifyMention); n != 2 {
		t.Fatalf("a rewrite naming bob left him %d mention rows, want 2", n)
	}
	if n := countType(t, svc, carol, model.NotifyProjectUpdate); n != 0 {
		t.Fatalf("an edit told a follower something new (%d rows)", n)
	}
}
