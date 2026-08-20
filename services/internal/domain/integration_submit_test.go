package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestSubmitIntegration_StoresAProposalMembersCanList(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	got, err := svc.SubmitIntegration(ctx, p, domain.SubmitIntegrationInput{
		Name: "Zapier", Website: "https://zapier.com", Summary: "No-code actions over the public API.",
	})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if got.Name != "Zapier" || got.Website != "https://zapier.com" || got.SubmittedBy != p.UserID {
		t.Fatalf("row %+v is not the proposal this viewer just filed", got)
	}

	listed, err := svc.ListIntegrationSubmissions(ctx, p)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != got.ID {
		t.Fatalf("list = %+v, want the one submission", listed)
	}
}

func TestSubmitIntegration_GuestsAreRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	guestID := f.NewUser(t, "greta", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	_, err := svc.SubmitIntegration(context.Background(), guest, domain.SubmitIntegrationInput{
		Name: "Zapier", Website: "https://zapier.com", Summary: "No-code.",
	})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("guest submit: %v", err)
	}
	if _, err := svc.ListIntegrationSubmissions(context.Background(), guest); platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("guest list: %v", err)
	}
}

func TestSubmitIntegration_WebsiteMustBeHTTPS(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, err := svc.SubmitIntegration(ctx, p, domain.SubmitIntegrationInput{
		Name: "Zapier", Website: "http://zapier.com", Summary: "No-code.",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("http website: %v", err)
	}

	_, err = svc.SubmitIntegration(ctx, p, domain.SubmitIntegrationInput{
		Name: " ", Website: "https://zapier.com", Summary: "No-code.",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("blank name: %v", err)
	}

	_, err = svc.SubmitIntegration(ctx, p, domain.SubmitIntegrationInput{
		Name: "Zapier", Website: "https://zapier.com", Summary: strings.Repeat("x", 281),
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("long summary: %v", err)
	}
}
