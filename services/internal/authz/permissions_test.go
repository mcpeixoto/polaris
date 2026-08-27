package authz

import (
	"testing"

	"github.com/google/uuid"
)

var (
	teamA = uuid.MustParse("01900000-0000-7000-8000-0000000000a1")
	teamB = uuid.MustParse("01900000-0000-7000-8000-0000000000a2")
)

func principal(role Role, teams ...uuid.UUID) *Principal {
	return &Principal{
		UserID: uuid.MustParse("01900000-0000-7000-8000-000000000091"),
		Role:   role,
		Teams:  NewTeamSet(teams...),
	}
}

// Every action must be answerable by exactly one of Can and CanInTeam.
//
// This is the structural test, and it exists because of how the failure looks when it is
// missing: an action added without being classified is denied by Can's default branch and
// by CanInTeam's teamScoped guard, so the feature simply does not work for anybody, with
// no error message pointing anywhere near this file. The count assertion is what forces
// somebody adding an action to come back and classify it rather than only appending to
// the const block.
func TestEveryActionIsClassified(t *testing.T) {
	const want = 37
	if len(AllActions) != want {
		t.Fatalf("AllActions has %d entries, expected %d — a new action must be added to "+
			"AllActions and to teamScoped if it is team-scoped", len(AllActions), want)
	}

	seen := make(map[Action]bool, len(AllActions))
	for _, a := range AllActions {
		if seen[a] {
			t.Errorf("%s appears twice in AllActions", a)
		}
		seen[a] = true
	}

	// An owner of the workspace who owns team A: the most permissive principal there is.
	// If even they cannot perform an action through either entry point, it is unreachable.
	owner := principal(RoleOwner, teamA)
	for _, a := range AllActions {
		workspaceLevel := Can(owner, a)
		teamLevel := CanInTeam(owner, a, teamA, true)
		switch {
		case !workspaceLevel && !teamLevel:
			t.Errorf("%s is unreachable: neither Can nor CanInTeam grants it to a workspace owner", a)
		case workspaceLevel && teamLevel:
			t.Errorf("%s is answered by both Can and CanInTeam; the two must stay disjoint", a)
		}
	}
}

// The bug this file was first written with: gating CanInTeam behind Can rejected a team
// owner before the team-ownership branch could run, because Can had already demanded
// workspace admin.
func TestTeamOwnerCanConfigureTheirOwnTeam(t *testing.T) {
	teamOwner := principal(RoleMember, teamA)

	for _, a := range []Action{ActionTeamUpdate, ActionWorkflowStateManage} {
		if !CanInTeam(teamOwner, a, teamA, true) {
			t.Errorf("a team owner must be able to %s in their own team", a)
		}
		// ...and nowhere else. Team ownership is not a workspace role.
		if CanInTeam(teamOwner, a, teamB, true) {
			t.Errorf("team ownership of A must not grant %s in B", a)
		}
	}
}

func TestLabelScopesAreSeparateActions(t *testing.T) {
	member := principal(RoleMember, teamA)
	admin := principal(RoleAdmin, teamA)

	// A member may curate their own team's labels...
	if !CanInTeam(member, ActionTeamLabelManage, teamA, false) {
		t.Error("a team member must be able to manage their team's labels")
	}
	// ...but a workspace-wide label lands in everybody's picker, so it needs an admin.
	if Can(member, ActionWorkspaceLabelManage) {
		t.Error("a plain member must not create workspace-wide labels")
	}
	if !Can(admin, ActionWorkspaceLabelManage) {
		t.Error("an admin must be able to create workspace-wide labels")
	}
	// The team action must be unreachable through the workspace entry point, which is
	// what stops a caller from getting a yes by forgetting to pass the team.
	if Can(member, ActionTeamLabelManage) || Can(admin, ActionTeamLabelManage) {
		t.Error("ActionTeamLabelManage must never be answered by Can")
	}
	// A member of A has no say over B's labels.
	if CanInTeam(member, ActionTeamLabelManage, teamB, false) {
		t.Error("a member of A must not manage B's labels")
	}
}

func TestGuestsAreScopedNotWeakened(t *testing.T) {
	guest := principal(RoleGuest, teamA)

	// Inside a team they were added to, a guest works normally. Their constraint is which
	// teams they can reach, not what they may do once inside one.
	if !CanInTeam(guest, ActionIssueCreate, teamA, false) {
		t.Error("a guest must be able to file issues in a team they belong to")
	}
	if CanInTeam(guest, ActionIssueCreate, teamB, false) {
		t.Error("a guest must not reach a team they do not belong to")
	}
	// A key acts as its owner and outlives the session, which is the opposite of what a
	// guest's access is meant to be.
	if Can(guest, ActionAPIKeyManage) {
		t.Error("a guest must not mint API keys")
	}
	if Can(guest, ActionWebhookManage) {
		t.Error("a guest must not create webhooks — they push workspace data to a URL")
	}
	if Can(guest, ActionOauthClientManage) {
		t.Error("a guest must not create OAuth applications")
	}
	if Can(guest, ActionTeamJoin) {
		t.Error("a guest must not add themselves to teams")
	}
}

// A relation is visible from both ends, so creating one from a team you can reach into a
// team you cannot would let you learn that an issue exists, and its identifier, purely by
// linking to it.
func TestRelatingIssuesRequiresBothTeams(t *testing.T) {
	inAOnly := principal(RoleMember, teamA)
	inBoth := principal(RoleMember, teamA, teamB)

	if CanRelateIssues(inAOnly, teamA, teamB) {
		t.Error("relating into a team the caller cannot see must be refused")
	}
	if CanRelateIssues(inAOnly, teamB, teamA) {
		t.Error("the check must not depend on the argument order")
	}
	if !CanRelateIssues(inBoth, teamA, teamB) {
		t.Error("a member of both teams must be able to relate their issues")
	}
	// An admin is not automatically a member. Admins can configure teams they are not in;
	// that is not the same as being able to read their issues.
	adminOutside := principal(RoleAdmin)
	if CanRelateIssues(adminOutside, teamA, teamB) {
		t.Error("being an admin does not grant read access to a private team's issues")
	}
}

// OwnsResource has no admin override, unlike CanEditOwnContent, and the difference is
// deliberate: an admin needs to delete an abusive comment, and has no business in
// somebody's inbox.
func TestOwnershipHasNoAdminOverride(t *testing.T) {
	admin := principal(RoleAdmin)
	somebodyElse := uuid.MustParse("01900000-0000-7000-8000-000000000092")

	if OwnsResource(admin, somebodyElse) {
		t.Error("an admin must not own another user's notifications, favourites or keys")
	}
	if !OwnsResource(admin, admin.UserID) {
		t.Error("a user owns their own rows")
	}
	if OwnsResource(nil, somebodyElse) {
		t.Error("a nil principal owns nothing")
	}

	// The contrast, restated so a future edit that "unifies" the two functions fails here.
	if !CanEditOwnContent(admin, &somebodyElse) {
		t.Error("an admin must be able to remove another user's comment")
	}
}

func TestNilPrincipalIsDeniedEverything(t *testing.T) {
	for _, a := range AllActions {
		if Can(nil, a) {
			t.Errorf("Can(nil, %s) granted", a)
		}
		if CanInTeam(nil, a, teamA, true) {
			t.Errorf("CanInTeam(nil, %s) granted", a)
		}
	}
}
