package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestIssueTemplate_SubIssuesAreFiledWithTheParent(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	tpl, _, err := svc.CreateIssueTemplate(ctx, admin, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID,
		Name:   "Incident",
		SubIssues: []model.TemplateSubIssue{
			{Title: "Write the repro"},
			{Title: "Add a regression test"},
		},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if len(tpl.SubIssues) != 2 {
		t.Fatalf("template came back with %d sub-issues, want 2", len(tpl.SubIssues))
	}

	parent, _, err := svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID:     f.TeamID,
		Title:      "Prod is down",
		TemplateID: &tpl.ID,
	})
	if err != nil {
		t.Fatalf("create from template: %v", err)
	}

	issues, err := svc.ListIssuesForTeam(ctx, admin, f.TeamID)
	if err != nil {
		t.Fatalf("list team issues: %v", err)
	}
	got := map[string]bool{}
	for _, issue := range issues {
		if issue.ParentID != nil && *issue.ParentID == parent.ID {
			got[issue.Title] = true
		}
	}
	for _, title := range []string{"Write the repro", "Add a regression test"} {
		if !got[title] {
			t.Fatalf("missing child %q; filed %v", title, got)
		}
	}
	if len(got) != 2 {
		t.Fatalf("parent has %d children %v, want 2", len(got), got)
	}
}

func TestIssueTemplate_SubIssuesAreRefusedOnASubIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	parent, _, err := svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID: f.TeamID,
		Title:  "Epic",
	})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	tpl, _, err := svc.CreateIssueTemplate(ctx, admin, domain.CreateIssueTemplateInput{
		TeamID:    &f.TeamID,
		Name:      "Nested",
		SubIssues: []model.TemplateSubIssue{{Title: "Too deep"}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	_, _, err = svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID:     f.TeamID,
		Title:      "Child",
		ParentID:   &parent.ID,
		TemplateID: &tpl.ID,
	})
	if err == nil {
		t.Fatal("filing a sub-issue from a template that itself has sub-issues should be refused")
	}
}

func TestUnwrapPlaceholders_LeavesThePromptText(t *testing.T) {
	got := domain.UnwrapPlaceholders("## Impact\n\n⟦What broke⟧\n")
	want := "## Impact\n\nWhat broke\n"
	if got != want {
		t.Fatalf("unwrapped %q, want %q", got, want)
	}
}
