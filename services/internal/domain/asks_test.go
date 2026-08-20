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

func TestCreateAskForm_LandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	row, version, err := svc.CreateAskForm(ctx, p, domain.CreateAskFormInput{
		TeamID:      f.TeamID,
		Name:        "IT requests",
		Description: "Laptops, access, the usual.",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("an ask form must land on the sync stream")
	}
	if row.Name != "IT requests" || row.TeamID != f.TeamID || row.Token == "" {
		t.Fatalf("form = %#v", row)
	}
}

func TestCreateAskForm_RefusesAnEmptyName(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	_, _, err := svc.CreateAskForm(context.Background(), f.Principal(), domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "   ",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestCreateAskForm_GuestsAreRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	guestID := f.NewUser(t, "guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	_, _, err := svc.CreateAskForm(context.Background(), guest, domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "Secret intake",
	})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("got %v, want forbidden", err)
	}
}

func TestSubmitAsk_CreatesATriageIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)

	form, _, err := svc.CreateAskForm(ctx, p, domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "Bugs",
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.SubmitAsk(ctx, domain.SubmitAskInput{
		Token:          form.Token,
		Title:          "The printer is on fire",
		Description:    "Third floor.",
		RequesterName:  "Ada",
		RequesterEmail: "ada@example.com",
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}

	issues, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 {
		t.Fatalf("got %d issues, want 1", len(issues))
	}
	issue := issues[0]
	if issue.Title != "The printer is on fire" {
		t.Fatalf("title = %q", issue.Title)
	}
	if !strings.Contains(issue.Description, "Ada") || !strings.Contains(issue.Description, "ada@example.com") {
		t.Fatalf("description is missing the requester: %q", issue.Description)
	}
	if !strings.Contains(issue.Description, "Third floor.") {
		t.Fatalf("description is missing the body: %q", issue.Description)
	}
	if issue.CreatorID != nil {
		t.Fatalf("creator = %v, want none — the submitter has no account", issue.CreatorID)
	}
	triage := stateByCategory(t, svc, p, f.TeamID, domain.CategoryTriage)
	if issue.StateID != triage {
		t.Fatalf("state = %s, want triage %s", issue.StateID, triage)
	}
}

func TestSubmitAsk_UnknownTokenIsNotFound(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	err := svc.SubmitAsk(context.Background(), domain.SubmitAskInput{
		Token:          "deadbeef",
		Title:          "Hello",
		RequesterName:  "Ada",
		RequesterEmail: "ada@example.com",
	})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not found", err)
	}
	_ = f
}

func TestSubmitAsk_RefusesAMissingName(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	form, _, err := svc.CreateAskForm(ctx, f.Principal(), domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "Bugs",
	})
	if err != nil {
		t.Fatal(err)
	}

	err = svc.SubmitAsk(ctx, domain.SubmitAskInput{
		Token: form.Token, Title: "Hello", RequesterEmail: "ada@example.com",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestGetPublicAskForm_NamesTheTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	form, _, err := svc.CreateAskForm(ctx, f.Principal(), domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "IT", Description: "Access requests.",
	})
	if err != nil {
		t.Fatal(err)
	}

	pub, err := svc.GetPublicAskForm(ctx, form.Token)
	if err != nil {
		t.Fatal(err)
	}
	if pub.Name != "IT" || pub.Description != "Access requests." || pub.TeamName == "" {
		t.Fatalf("public = %#v", pub)
	}
}

func TestDeleteAskForm_DropsThePublicLink(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	form, _, err := svc.CreateAskForm(ctx, p, domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "IT",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeleteAskForm(ctx, p, form.ID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.GetPublicAskForm(ctx, form.Token)
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not found", err)
	}
}
