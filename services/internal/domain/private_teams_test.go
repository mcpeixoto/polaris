package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateTeam_RefusesPrivateWithoutEntitlement(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	f.SetPlan(t, entitlement.PlanFree)

	_, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "HR", Name: "Human Resources", Private: true,
	})
	if platform.CodeOf(err) != platform.CodeEntitlement {
		t.Fatalf("code = %s, want ENTITLEMENT (%v)", platform.CodeOf(err), err)
	}
}

func TestUpdateTeam_PrivatizingClearsExternalAssigneesAndUnsubscribes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanPro)

	admin := f.Principal()
	outsider := f.NewUser(t, "pat", "member", true)
	outPrincipal := f.PrincipalFor(outsider, authz.RoleMember, f.TeamID)

	openTeam, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "OPS", Name: "Operations", Private: false,
	})
	if err != nil {
		t.Fatalf("create open team: %v", err)
	}
	openIssue, _, err := svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID: openTeam.ID, Title: "Rollout checklist",
	})
	if err != nil {
		t.Fatalf("open issue: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, admin, domain.UpdateIssueInput{
		ID: openIssue.ID, AssigneeID: &outsider,
	}); err != nil {
		t.Fatalf("assign outsider: %v", err)
	}
	// Public teams reach every workspace member once the principal is resolved.
	outPrincipal.Teams[openTeam.ID] = struct{}{}
	if _, _, err := svc.SetIssueSubscription(ctx, outPrincipal, openIssue.ID, true); err != nil {
		t.Fatalf("subscribe outsider: %v", err)
	}

	if _, _, err := svc.UpdateTeam(ctx, admin, domain.UpdateTeamInput{
		ID: openTeam.ID, Private: ptr(true),
	}); err != nil {
		t.Fatalf("privatize: %v", err)
	}

	got, err := svc.GetIssue(ctx, admin, openIssue.ID)
	if err != nil {
		t.Fatalf("reload issue: %v", err)
	}
	if got.AssigneeID != nil {
		t.Fatalf("external assignee = %v, want cleared", got.AssigneeID)
	}

	subs, err := svc.ListSubscribersForIssues(ctx, admin, []uuid.UUID{openIssue.ID})
	if err != nil {
		t.Fatalf("subs: %v", err)
	}
	for _, row := range subs[openIssue.ID] {
		if row.UserID == outsider && !row.Unsubscribed {
			t.Fatalf("outsider still subscribed: %+v", row)
		}
	}
}

func TestListInitiativeProjects_OmitsProjectsTheCallerCannotSee(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanPro)

	admin := f.Principal()

	privateTeam, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "HR", Name: "Human Resources", Private: true,
	})
	if err != nil {
		t.Fatalf("private team: %v", err)
	}

	initiative, _, err := svc.CreateInitiative(ctx, admin, domain.CreateInitiativeInput{
		Name: "Grow headcount",
	})
	if err != nil {
		t.Fatalf("initiative: %v", err)
	}

	publicProject, _, err := svc.CreateProject(ctx, admin, domain.CreateProjectInput{
		Name: "Public rollout", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("public project: %v", err)
	}
	privateProject, _, err := svc.CreateProject(ctx, admin, domain.CreateProjectInput{
		Name: "HR roadmap", TeamIDs: []uuid.UUID{privateTeam.ID},
	})
	if err != nil {
		t.Fatalf("private project: %v", err)
	}

	if _, _, err := svc.AddInitiativeProject(ctx, admin, initiative.ID, publicProject.ID); err != nil {
		t.Fatalf("link public: %v", err)
	}
	if _, _, err := svc.AddInitiativeProject(ctx, admin, initiative.ID, privateProject.ID); err != nil {
		t.Fatalf("link private: %v", err)
	}

	outsider := f.NewUser(t, "pat", "member", true)
	outPrincipal := f.PrincipalFor(outsider, authz.RoleMember, f.TeamID)

	links, err := svc.ListInitiativeProjects(ctx, outPrincipal, initiative.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(links) != 1 || links[0].ProjectID != publicProject.ID {
		t.Fatalf("outsider links = %+v, want only the public project", links)
	}

	adminLinks, err := svc.ListInitiativeProjects(ctx, admin, initiative.ID)
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if len(adminLinks) != 2 {
		t.Fatalf("admin links = %+v, want both projects", adminLinks)
	}
}

func TestListTeams_IncludesPrivateTeamsForAdmin(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanPro)

	admin := f.Principal()

	privateTeam, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "HR", Name: "Human Resources", Private: true,
	})
	if err != nil {
		t.Fatalf("private team: %v", err)
	}

	outsider := f.NewUser(t, "pat", "member", true)
	outPrincipal := f.PrincipalFor(outsider, authz.RoleMember, f.TeamID)

	outTeams, err := svc.ListTeams(ctx, outPrincipal)
	if err != nil {
		t.Fatalf("outsider list: %v", err)
	}
	for _, team := range outTeams {
		if team.ID == privateTeam.ID {
			t.Fatal("outsider must not list a private team they are not in")
		}
	}

	adminTeams, err := svc.ListTeams(ctx, admin)
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	found := false
	for _, team := range adminTeams {
		if team.ID == privateTeam.ID {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("admin must list private teams for settings discovery")
	}
}

func ptr(b bool) *bool { return &b }
