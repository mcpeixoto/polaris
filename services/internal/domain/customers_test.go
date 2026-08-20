package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateCustomer_LandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	row, version, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{
		Name:    "Acme",
		Domains: []string{"https://Acme.com", "acme.io"},
		Status:  model.CustomerStatusProspect,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("a customer must land on the sync stream")
	}
	if row.Status != model.CustomerStatusProspect {
		t.Fatalf("status = %q", row.Status)
	}
	if len(row.Domains) != 2 || row.Domains[0] != "acme.com" || row.Domains[1] != "acme.io" {
		t.Fatalf("domains = %#v", row.Domains)
	}
}

func TestCreateCustomer_RefusesAnEmptyName(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{Name: "   "})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestCreateCustomer_RefusesADuplicateDomain(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{
		Name: "Acme", Domains: []string{"acme.com"},
	}); err != nil {
		t.Fatalf("first: %v", err)
	}
	_, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{
		Name: "Acme West", Domains: []string{"ACME.com"},
	})
	if platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("got %v, want conflict", err)
	}
}

func TestCreateCustomer_GuestsAreRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	guestID := f.NewUser(t, "guest", "guest", false)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	_, _, err := svc.CreateCustomer(ctx, guest, domain.CreateCustomerInput{Name: "Acme"})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("got %v, want forbidden", err)
	}
}

func TestCreateCustomerRequest_AttachesToAnIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	customer, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{Name: "Acme"})
	if err != nil {
		t.Fatalf("customer: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Login is slow",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	req, version, err := svc.CreateCustomerRequest(ctx, p, domain.CreateCustomerRequestInput{
		CustomerID: &customer.ID,
		IssueID:    &issue.ID,
		Body:       "We lose a minute on every sign-in.",
		Important:  true,
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if version == 0 {
		t.Fatal("a request must land on the sync stream")
	}
	if !req.Important || req.Body == "" {
		t.Fatalf("request = %#v", req)
	}
}

func TestCreateCustomerRequest_RequiresATarget(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, err := svc.CreateCustomerRequest(ctx, p, domain.CreateCustomerRequestInput{
		Body: "no target",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestDeleteCustomer_RemovesItsRequests(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	customer, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{Name: "Acme"})
	if err != nil {
		t.Fatalf("customer: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Feedback",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	req, _, err := svc.CreateCustomerRequest(ctx, p, domain.CreateCustomerRequestInput{
		CustomerID: &customer.ID, IssueID: &issue.ID, Body: "Need SSO",
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}

	if _, err := svc.DeleteCustomer(ctx, p, customer.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.GetCustomerRequest(ctx, p, req.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("request survived: %v", err)
	}
}
