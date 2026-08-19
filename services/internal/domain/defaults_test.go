package domain_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateIssue_AppliesMemberDefaultWhenTemplateOmitted(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	priority := 2
	props, err := json.Marshal(map[string]any{"priority": priority})
	if err != nil {
		t.Fatal(err)
	}
	title := "Incident: "
	tpl, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID:     &f.TeamID,
		Name:       "Incident",
		Title:      &title,
		Properties: props,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if _, _, err := svc.UpdateTeamTemplates(ctx, p, domain.UpdateTeamTemplatesInput{
		TeamID:                      f.TeamID,
		DefaultTemplateForMembersID: &tpl.ID,
	}); err != nil {
		t.Fatalf("set default: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Login is down",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.TemplateID == nil || *issue.TemplateID != tpl.ID {
		t.Fatalf("templateId = %v, want the member default %s", issue.TemplateID, tpl.ID)
	}
	if issue.Priority != priority {
		t.Fatalf("priority = %d, want %d from the default", issue.Priority, priority)
	}
}

func TestCreateIssue_SkipDefaultTemplateLeavesTheIssueBlank(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	props, err := json.Marshal(map[string]any{"priority": 1})
	if err != nil {
		t.Fatal(err)
	}
	tpl, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID, Name: "Urgent", Properties: props,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if _, _, err := svc.UpdateTeamTemplates(ctx, p, domain.UpdateTeamTemplatesInput{
		TeamID:                      f.TeamID,
		DefaultTemplateForMembersID: &tpl.ID,
	}); err != nil {
		t.Fatalf("set default: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Blank on purpose", SkipDefaultTemplate: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.TemplateID != nil {
		t.Fatalf("templateId = %s, want none — skipDefaultTemplate was set", *issue.TemplateID)
	}
	if issue.Priority != 0 {
		t.Fatalf("priority = %d, want 0: the default must not come back after a clear", issue.Priority)
	}
}

func TestCreateIssue_NonMemberDefaultIsNotTheMemberOne(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	memberProps, err := json.Marshal(map[string]any{"priority": 2})
	if err != nil {
		t.Fatal(err)
	}
	nonMemberProps, err := json.Marshal(map[string]any{"priority": 1})
	if err != nil {
		t.Fatal(err)
	}
	members, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID, Name: "For us", Properties: memberProps,
	})
	if err != nil {
		t.Fatalf("member template: %v", err)
	}
	outsiders, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID, Name: "For them", Properties: nonMemberProps,
	})
	if err != nil {
		t.Fatalf("non-member template: %v", err)
	}
	if _, _, err := svc.UpdateTeamTemplates(ctx, p, domain.UpdateTeamTemplatesInput{
		TeamID:                         f.TeamID,
		DefaultTemplateForMembersID:    &members.ID,
		DefaultTemplateForNonMembersID: &outsiders.ID,
	}); err != nil {
		t.Fatalf("set defaults: %v", err)
	}

	pat := f.NewUser(t, "pat", "member", false)
	outsider := f.PrincipalFor(pat, authz.RoleMember, f.TeamID)

	theirs, _, err := svc.CreateIssue(ctx, outsider, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "From outside",
	})
	if err != nil {
		t.Fatalf("outsider create: %v", err)
	}
	if theirs.TemplateID == nil || *theirs.TemplateID != outsiders.ID {
		t.Fatalf("outsider templateId = %v, want the non-member default", theirs.TemplateID)
	}
	if theirs.Priority != 1 {
		t.Fatalf("outsider priority = %d, want 1", theirs.Priority)
	}

	ours, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "From inside",
	})
	if err != nil {
		t.Fatalf("member create: %v", err)
	}
	if ours.TemplateID == nil || *ours.TemplateID != members.ID {
		t.Fatalf("member templateId = %v, want the member default", ours.TemplateID)
	}
}

func TestArchiveIssueTemplate_ClearsTeamDefaultsThatPointedAtIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	tpl, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID, Name: "Soon gone",
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if _, _, err := svc.UpdateTeamTemplates(ctx, p, domain.UpdateTeamTemplatesInput{
		TeamID:                         f.TeamID,
		DefaultTemplateForMembersID:    &tpl.ID,
		DefaultTemplateForNonMembersID: &tpl.ID,
	}); err != nil {
		t.Fatalf("set defaults: %v", err)
	}

	if _, _, err := svc.ArchiveIssueTemplate(ctx, p, tpl.ID, true); err != nil {
		t.Fatalf("archive: %v", err)
	}

	teams, err := svc.ListTeams(ctx, p)
	if err != nil {
		t.Fatalf("list teams: %v", err)
	}
	for _, row := range teams {
		if row.ID != f.TeamID {
			continue
		}
		if row.DefaultTemplateForMembersID != nil || row.DefaultTemplateForNonMembersID != nil {
			t.Fatalf("defaults still point at the archived template: members=%v non-members=%v",
				row.DefaultTemplateForMembersID, row.DefaultTemplateForNonMembersID)
		}
		return
	}
	t.Fatal("fixture team missing from listing")
}

func TestCreateIssue_TemplateStateOverridesAutoTriage(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)

	props, err := json.Marshal(map[string]any{"stateId": f.Backlog.String()})
	if err != nil {
		t.Fatal(err)
	}
	tpl, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID, Name: "Skip triage", Properties: props,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if _, _, err := svc.UpdateTeamTemplates(ctx, p, domain.UpdateTeamTemplatesInput{
		TeamID:                         f.TeamID,
		DefaultTemplateForNonMembersID: &tpl.ID,
	}); err != nil {
		t.Fatalf("set default: %v", err)
	}

	pat := f.NewUser(t, "pat", "member", false)
	outsider := f.PrincipalFor(pat, authz.RoleMember, f.TeamID)
	issue, _, err := svc.CreateIssue(ctx, outsider, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Should skip triage",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.StateID != f.Backlog {
		t.Fatalf("state = %s, want backlog %s — the default supplied a stateId", issue.StateID, f.Backlog)
	}
}
