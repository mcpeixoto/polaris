package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateCustomer_RefusedWhenDisabled(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	off := false
	if _, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{
		CustomerRequestsEnabled: &off,
	}); err != nil {
		t.Fatalf("disable: %v", err)
	}

	_, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{Name: "Acme"})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestUpdateWorkspace_CustomerTiersAndDefaultTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{
		CustomerTiers:    []string{"Enterprise", "enterprise"},
		SetCustomerTiers: true,
	}); platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("duplicate tiers: %v", err)
	}

	unit := "USD"
	ws, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{
		CustomerDefaultTeamID: &f.TeamID,
		CustomerRevenueUnit:   &unit,
		CustomerTiers:         []string{"Enterprise", "Pro"},
		SetCustomerTiers:      true,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if ws.CustomerDefaultTeamID == nil || *ws.CustomerDefaultTeamID != f.TeamID {
		t.Fatalf("default team = %#v", ws.CustomerDefaultTeamID)
	}
	if ws.CustomerRevenueUnit != "USD" {
		t.Fatalf("unit = %q", ws.CustomerRevenueUnit)
	}
	if len(ws.CustomerTiers) != 2 || ws.CustomerTiers[0] != "Enterprise" {
		t.Fatalf("tiers = %#v", ws.CustomerTiers)
	}
}

func TestMergeCustomers_MovesDomainsAndRequests(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	into, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{
		Name: "Acme", Domains: []string{"acme.com"},
	})
	if err != nil {
		t.Fatalf("into: %v", err)
	}
	revenue := int32(9000)
	source, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{
		Name: "Acme West", Domains: []string{"west.acme.com"}, Revenue: &revenue,
	})
	if err != nil {
		t.Fatalf("source: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "SSO",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	req, _, err := svc.CreateCustomerRequest(ctx, p, domain.CreateCustomerRequestInput{
		CustomerID: &source.ID, IssueID: &issue.ID, Body: "Need SSO",
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}

	survived, version, err := svc.MergeCustomers(ctx, p, source.ID, into.ID)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if version == 0 {
		t.Fatal("merge must land on the stream")
	}
	if survived.ID != into.ID {
		t.Fatalf("survivor = %s", survived.ID)
	}
	if len(survived.Domains) != 2 {
		t.Fatalf("domains = %#v", survived.Domains)
	}
	if survived.Revenue == nil || *survived.Revenue != 9000 {
		t.Fatalf("revenue did not fill from source: %#v", survived.Revenue)
	}

	moved, err := svc.GetCustomerRequest(ctx, p, req.ID)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if moved.CustomerID == nil || *moved.CustomerID != into.ID {
		t.Fatalf("request customer = %#v", moved.CustomerID)
	}

	archived, err := svc.GetCustomer(ctx, p, source.ID)
	if err != nil {
		t.Fatalf("source: %v", err)
	}
	if archived.ArchivedAt == nil {
		t.Fatal("source should be archived")
	}
}

func TestMergeCustomers_RefusesSelf(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	row, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{Name: "Acme"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := svc.MergeCustomers(ctx, p, row.ID, row.ID); platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}
