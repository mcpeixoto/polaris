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

// A revoke has to reach the people who lost access, and only them.
//
// The failure this covers is silent and permanent. A team-scoped revoke is judged by the
// reader's team set, and a team set is resolved when a client connects — so the revoke for a
// team that has just gone private was delivered only to sessions that happened to be open at
// that instant, and filtered out for anybody who reconnected afterwards, because by then the
// team was no longer theirs to see. A person whose tab was shut during the flip came back,
// resumed from their cursor, and kept the private team and every issue in it in their local
// replica, readable, for good. The same row also landed on team members, whose replicas then
// deleted the team's contents on the strength of a revoke meant for other people.
func TestUpdateTeam_PrivatizingRevokesFromEveryNonMemberAndNoMember(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	f.SetPlan(t, entitlement.PlanPro)

	admin := f.Principal()
	outsider := f.NewUser(t, "pat", "member", true)

	team, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{Key: "OPS", Name: "Operations"})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID: team.ID, Title: "Rollout checklist",
	}); err != nil {
		t.Fatalf("create issue: %v", err)
	}

	before, err := svc.WorkspaceVersion(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	if _, _, err := svc.UpdateTeam(ctx, admin, domain.UpdateTeamInput{
		ID: team.ID, Private: ptr(true),
	}); err != nil {
		t.Fatalf("privatize: %v", err)
	}

	// The outsider as they are AFTER the flip: reconnecting, or arriving for the first
	// time since it happened. Their team set no longer contains the private team, which is
	// precisely why a team-scoped revoke could not reach them.
	stranger := f.PrincipalFor(outsider, authz.RoleMember, f.TeamID)

	revokedForStranger := false
	revokedForAdmin := false
	for _, c := range readChangesAfter(t, svc, f.WorkspaceID, before) {
		if c.EntityType != "team" || c.EntityID != team.ID || c.Op != string(domain.OpRevoke) {
			continue
		}
		if c.Visible(stranger) {
			revokedForStranger = true
		}
		if c.Visible(admin) {
			revokedForAdmin = true
		}
	}
	if !revokedForStranger {
		t.Fatal("no revoke of the newly private team reached a non-member who was not " +
			"connected at the moment of the flip: their replica keeps the team and its issues")
	}
	if revokedForAdmin {
		t.Fatal("the revoke reached a team member, whose replica will now delete the " +
			"private team's issues")
	}
}

// Moving a team under a private parent is the second way to make a team private, and it has
// to do everything the visibility toggle does — including to the sub-tree that comes with it.
func TestMoveTeam_UnderPrivateParentPrivatisesTheWholeSubtreeAndRevokesIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	f.SetPlan(t, entitlement.PlanEnterprise)

	admin := f.Principal()
	outsider := f.NewUser(t, "pat", "member", true)

	parent, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "PVT", Name: "Private Programme", Private: true,
	})
	if err != nil {
		t.Fatalf("create private parent: %v", err)
	}
	top, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{Key: "TOP", Name: "Top"})
	if err != nil {
		t.Fatalf("create top: %v", err)
	}
	kid, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{
		Key: "KID", Name: "Kid", ParentTeamID: &top.ID,
	})
	if err != nil {
		t.Fatalf("create kid: %v", err)
	}

	before, err := svc.WorkspaceVersion(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	moved, _, err := svc.MoveTeam(ctx, admin, top.ID, &parent.ID)
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if !moved.Private {
		t.Fatal("a team moved under a private parent is still public")
	}

	// The sub-tree came along, and a public team under a private ancestor is a hole
	// straight through the boundary — UpdateTeam refuses to create that state on purpose.
	all, err := svc.ListTeams(ctx, admin)
	if err != nil {
		t.Fatalf("list teams: %v", err)
	}
	for _, team := range all {
		if team.ID == kid.ID && !team.Private {
			t.Fatal("the moved team's own sub-team stayed public under a private ancestor")
		}
	}

	stranger := f.PrincipalFor(outsider, authz.RoleMember, f.TeamID)
	revoked := map[uuid.UUID]bool{}
	for _, c := range readChangesAfter(t, svc, f.WorkspaceID, before) {
		if c.EntityType == "team" && c.Op == string(domain.OpRevoke) && c.Visible(stranger) {
			revoked[c.EntityID] = true
		}
	}
	if !revoked[top.ID] {
		t.Error("the moved team was never revoked from non-members")
	}
	if !revoked[kid.ID] {
		t.Error("the moved team's sub-team was never revoked from non-members")
	}
}

func readChangesAfter(
	t *testing.T, svc *domain.Service, workspaceID uuid.UUID, from int64,
) []domain.SyncChange {
	t.Helper()
	changes, err := svc.ReadChanges(context.Background(), workspaceID, from, 1<<40, 5000)
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	return changes
}
