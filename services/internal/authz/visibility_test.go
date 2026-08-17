package authz

import (
	"testing"

	"github.com/google/uuid"
)

// These tests exist before any caller does, because this predicate is the thing that
// stops a private team leaking into someone else's sync stream. Acceptance test 6 in
// docs/07-milestones/00-milestone-0.md depends on it.

func TestVisible_WorkspaceScope(t *testing.T) {
	member := &Principal{UserID: uuid.New(), Role: RoleMember, Teams: NewTeamSet()}
	guest := &Principal{UserID: uuid.New(), Role: RoleGuest, Teams: NewTeamSet()}

	if !Visible(member, WorkspaceScope()) {
		t.Error("a member must see workspace-scoped entities")
	}
	if Visible(guest, WorkspaceScope()) {
		t.Error("a guest must NOT see workspace-scoped entities")
	}
}

func TestVisible_TeamScope(t *testing.T) {
	teamA, teamB := uuid.New(), uuid.New()
	p := &Principal{UserID: uuid.New(), Role: RoleMember, Teams: NewTeamSet(teamA)}

	if !Visible(p, TeamScope(teamA, false)) {
		t.Error("must see a team it belongs to")
	}
	if Visible(p, TeamScope(teamB, false)) {
		t.Error("must NOT see a team it does not belong to")
	}
	// Privacy does not change the answer for a member: membership is the whole test.
	// The Private flag exists so that revoke events can be targeted, not to gate reads.
	if !Visible(p, TeamScope(teamA, true)) {
		t.Error("a member of a private team must still see it")
	}
	if Visible(p, TeamScope(teamB, true)) {
		t.Error("a non-member must NOT see a private team")
	}
}

func TestVisible_ProjectSpansTeams(t *testing.T) {
	mine, theirs := uuid.New(), uuid.New()
	p := &Principal{UserID: uuid.New(), Role: RoleMember, Teams: NewTeamSet(mine)}

	if !Visible(p, ProjectScope([]uuid.UUID{theirs, mine})) {
		t.Error("membership in any one of a project's teams must grant access")
	}
	if Visible(p, ProjectScope([]uuid.UUID{theirs})) {
		t.Error("membership in none of a project's teams must deny access")
	}
}

func TestVisible_IssueSharedWithNamedUser(t *testing.T) {
	me, other := uuid.New(), uuid.New()
	otherTeam := uuid.New()
	p := &Principal{UserID: me, Role: RoleMember, Teams: NewTeamSet()}

	shared := Scope{Kind: ScopeIssueShared, TeamIDs: []uuid.UUID{otherTeam}, SharedWith: []uuid.UUID{me}}
	if !Visible(p, shared) {
		t.Error("an issue shared with me must be visible even out of my teams")
	}

	notShared := Scope{Kind: ScopeIssueShared, TeamIDs: []uuid.UUID{otherTeam}, SharedWith: []uuid.UUID{other}}
	if Visible(p, notShared) {
		t.Error("an issue shared with somebody else must NOT be visible")
	}
}

func TestVisible_UserScopeIsPrivate(t *testing.T) {
	me, other := uuid.New(), uuid.New()
	p := &Principal{UserID: me, Role: RoleAdmin, Teams: NewTeamSet()}

	if !Visible(p, UserScope(me)) {
		t.Error("must see my own notifications")
	}
	// Being an admin does not grant access to another person's notification stream.
	if Visible(p, UserScope(other)) {
		t.Error("an admin must NOT see another user's private entities")
	}
}

func TestVisible_UnknownScopeDenies(t *testing.T) {
	p := &Principal{UserID: uuid.New(), Role: RoleAdmin, Teams: NewTeamSet(uuid.New())}

	// A new entity type that forgets to set a scope must be invisible, not universally
	// visible. Invisible gets reported as a bug on day one; the opposite leaks silently.
	if Visible(p, Scope{Kind: ScopeKind("something_new")}) {
		t.Error("an unrecognised scope kind must deny")
	}
	if Visible(p, Scope{}) {
		t.Error("a zero-value scope must deny")
	}
}

func TestVisible_NilPrincipalDenies(t *testing.T) {
	if Visible(nil, WorkspaceScope()) {
		t.Error("an unauthenticated caller must see nothing")
	}
}

func TestCanInTeam_RequiresMembership(t *testing.T) {
	mine, theirs := uuid.New(), uuid.New()
	p := &Principal{UserID: uuid.New(), Role: RoleMember, Teams: NewTeamSet(mine)}

	if !CanInTeam(p, ActionIssueCreate, mine, false) {
		t.Error("a member must be able to create issues in their own team")
	}
	if CanInTeam(p, ActionIssueCreate, theirs, false) {
		t.Error("a member must NOT be able to create issues in a team they are not in")
	}
}

func TestCanInTeam_TeamOwnerConfiguresOwnTeamOnly(t *testing.T) {
	mine, theirs := uuid.New(), uuid.New()
	p := &Principal{UserID: uuid.New(), Role: RoleMember, Teams: NewTeamSet(mine)}

	if !CanInTeam(p, ActionWorkflowStateManage, mine, true) {
		t.Error("a team owner must be able to manage their own team's statuses")
	}
	if CanInTeam(p, ActionWorkflowStateManage, theirs, true) {
		t.Error("team ownership must not carry into another team")
	}
	if CanInTeam(p, ActionWorkflowStateManage, mine, false) {
		t.Error("a plain member must not manage statuses")
	}
}

func TestRoleLadder(t *testing.T) {
	if !RoleOwner.AtLeast(RoleAdmin) || !RoleAdmin.AtLeast(RoleMember) {
		t.Error("role ladder is inverted")
	}
	if RoleGuest.AtLeast(RoleMember) {
		t.Error("a guest must not outrank a member")
	}
	if RoleGuest.IsAdmin() || RoleMember.IsAdmin() {
		t.Error("only owner and admin are admins")
	}
}

func TestScopeRoundTripsThroughJSONB(t *testing.T) {
	// The scope is written to change_log as jsonb and read back by the sync hub. If it
	// does not survive the round trip, every delta after a privacy change is misjudged.
	team := uuid.New()
	orig := TeamScope(team, true)

	raw, err := orig.MarshalJSONB()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	back, err := ParseScope(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if back.Kind != ScopeTeam || !back.Private || len(back.TeamIDs) != 1 || back.TeamIDs[0] != team {
		t.Fatalf("round trip lost information: %+v", back)
	}
}

func TestParseScope_EmptyDefaultsToWorkspace(t *testing.T) {
	s, err := ParseScope(nil)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if s.Kind != ScopeWorkspace {
		t.Errorf("empty scope should default to workspace, got %q", s.Kind)
	}
}

func TestCan_DeniesTeamScopedActions(t *testing.T) {
	// A team-scoped action asked without a team must always be denied, even for an
	// admin. The alternative — answering "yes, in principle" — is how a caller ends up
	// skipping the membership check entirely.
	admin := &Principal{UserID: uuid.New(), Role: RoleAdmin, Teams: NewTeamSet(uuid.New())}
	for _, a := range []Action{
		ActionIssueCreate, ActionIssueUpdate, ActionIssueDelete, ActionIssueArchive,
		ActionCommentCreate, ActionCommentUpdate, ActionCommentDelete,
		ActionTeamUpdate, ActionTeamDelete, ActionWorkflowStateManage,
	} {
		if Can(admin, a) {
			t.Errorf("Can(%q) must deny: it is team-scoped and needs CanInTeam", a)
		}
	}
}

func TestCanInTeam_DeniesWorkspaceScopedActions(t *testing.T) {
	team := uuid.New()
	admin := &Principal{UserID: uuid.New(), Role: RoleAdmin, Teams: NewTeamSet(team)}
	for _, a := range []Action{ActionMemberInvite, ActionWorkspaceDelete, ActionTeamCreate} {
		if CanInTeam(admin, a, team, true) {
			t.Errorf("CanInTeam(%q) must deny: it is workspace-scoped and needs Can", a)
		}
	}
}

func TestCan_AdminOnlyWorkspaceActions(t *testing.T) {
	member := &Principal{UserID: uuid.New(), Role: RoleMember, Teams: NewTeamSet()}
	admin := &Principal{UserID: uuid.New(), Role: RoleAdmin, Teams: NewTeamSet()}

	if Can(member, ActionMemberInvite) {
		t.Error("a plain member must not invite")
	}
	if !Can(admin, ActionMemberInvite) {
		t.Error("an admin must be able to invite")
	}
	if Can(member, ActionTeamCreate) {
		t.Error("a plain member must not create teams")
	}
}

func TestCan_GuestCannotJoinTeams(t *testing.T) {
	guest := &Principal{UserID: uuid.New(), Role: RoleGuest, Teams: NewTeamSet()}
	member := &Principal{UserID: uuid.New(), Role: RoleMember, Teams: NewTeamSet()}

	if Can(guest, ActionTeamJoin) {
		t.Error("a guest must be added to a team by an admin, not join one")
	}
	if !Can(member, ActionTeamJoin) {
		t.Error("a member must be able to join a public team")
	}
}

func TestCanEditOwnContent(t *testing.T) {
	me, other := uuid.New(), uuid.New()
	member := &Principal{UserID: me, Role: RoleMember, Teams: NewTeamSet()}
	admin := &Principal{UserID: other, Role: RoleAdmin, Teams: NewTeamSet()}

	if !CanEditOwnContent(member, &me) {
		t.Error("I must be able to edit my own comment")
	}
	if CanEditOwnContent(member, &other) {
		t.Error("a member must not edit somebody else's comment")
	}
	if !CanEditOwnContent(admin, &me) {
		t.Error("an admin must be able to remove another user's comment")
	}
	if CanEditOwnContent(nil, &me) {
		t.Error("an unauthenticated caller must edit nothing")
	}
}
