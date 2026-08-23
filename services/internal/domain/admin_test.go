package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestRemoveUser_RefusesToRemoveTheWorkspacesLastOwner(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// The fixture's admin is the only one. Leaving is otherwise allowed, so this is the
	// rule that stops leaving being a way to strand a workspace with nobody who can invite,
	// change a role or manage billing — a state whose only repair is a support ticket.
	_, _, err := svc.RemoveUser(ctx, f.Principal(), f.UserID)
	if code := platform.CodeOf(err); code != platform.CodeConflict {
		t.Fatalf("code = %s, want %s (err = %v)", code, platform.CodeConflict, err)
	}
	if !strings.Contains(err.Error(), "last owner") {
		t.Errorf("the refusal must say why: %v", err)
	}

	// And the refusal is not partial: the user is still there and still an admin.
	user, err := db.Queries().GetUser(ctx, f.UserID)
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if user.ArchivedAt != nil || user.Status != "active" {
		t.Errorf("a refused removal must leave the row untouched; got status=%s archived=%v",
			user.Status, user.ArchivedAt)
	}
}

func TestLeaveWorkspace_AMemberCanLeaveWithoutAskingAnAdmin(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, pBob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Bob's leftover",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	left, _, err := svc.LeaveWorkspace(ctx, pBob)
	if err != nil {
		t.Fatalf("leave: %v", err)
	}
	if left != bob {
		t.Errorf("left = %s, want %s", left, bob)
	}

	row, err := db.Queries().GetUser(ctx, bob)
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if row.ArchivedAt == nil || row.Status != "suspended" {
		t.Errorf("status=%s archived=%v, want suspended and archived", row.Status, row.ArchivedAt)
	}

	after, err := svc.GetIssue(ctx, f.Principal(), issue.ID)
	if err != nil {
		t.Fatalf("get issue: %v", err)
	}
	if after.CreatorID == nil || *after.CreatorID != bob {
		t.Errorf("creator = %v, want %s — leaving must not unattribute work", after.CreatorID, bob)
	}

	if row.AccountID == nil {
		t.Fatal("a human member must have an account, or the switcher has nothing to query")
	}
	listed, err := svc.ListWorkspacesForAccount(ctx, *row.AccountID)
	if err != nil {
		t.Fatalf("list workspaces: %v", err)
	}
	for _, ws := range listed {
		if ws.ID == f.WorkspaceID {
			t.Fatal("the workspace they left must not appear in the switcher")
		}
	}
}

func TestLeaveWorkspace_TheLastOwnerCannot(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	_, _, err := svc.LeaveWorkspace(context.Background(), f.Principal())
	if code := platform.CodeOf(err); code != platform.CodeConflict {
		t.Fatalf("code = %s, want %s (err = %v)", code, platform.CodeConflict, err)
	}
	if !strings.Contains(err.Error(), "last owner") {
		t.Errorf("the refusal must say why: %v", err)
	}
}

func TestLeaveWorkspace_AnAppUserCannot(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	p := f.Principal()
	p.ActorType = authz.ActorAppUser
	_, _, err := svc.LeaveWorkspace(context.Background(), p)
	if code := platform.CodeOf(err); code != platform.CodeForbidden {
		t.Fatalf("code = %s, want %s (err = %v)", code, platform.CodeForbidden, err)
	}
}

func TestRemoveUser_TakesTheirAccessAndLeavesTheirWork(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, pBob, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Bob's issue",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	_, token, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{Name: "bob's key"})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}

	before, err := svc.WorkspaceVersion(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("version: %v", err)
	}

	removed, version, err := svc.RemoveUser(ctx, f.Principal(), bob)
	if err != nil {
		t.Fatalf("remove user: %v", err)
	}
	if removed != bob {
		t.Errorf("removed = %s, want %s", removed, bob)
	}
	if version <= before {
		t.Errorf("version = %d, want something past %d — the removal is on the sync stream", version, before)
	}

	// The work stays, and stays theirs. Deleting the row would have set creator_id to NULL
	// and silently unattributed everything they ever wrote.
	after, err := svc.GetIssue(ctx, f.Principal(), issue.ID)
	if err != nil {
		t.Fatalf("get issue: %v", err)
	}
	if after.CreatorID == nil || *after.CreatorID != bob {
		t.Errorf("creator = %v, want %s — removing somebody must not unattribute their work",
			after.CreatorID, bob)
	}

	// The access goes.
	row, err := db.Queries().GetUser(ctx, bob)
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if row.ArchivedAt == nil {
		t.Error("a removed user must be archived, or they stay in the directory and the seat count")
	}
	if row.Status != "suspended" {
		t.Errorf("status = %s, want suspended — otherwise ResolvePrincipal lets them keep working", row.Status)
	}
	if _, err := svc.AuthenticateApiKey(ctx, token); err == nil {
		t.Error("a removed person's API key must stop working — an account that is gone while its access path is not is invisible")
	}
	member, err := db.Queries().IsTeamMember(ctx, store.IsTeamMemberParams{TeamID: f.TeamID, UserID: bob})
	if err != nil {
		t.Fatalf("is team member: %v", err)
	}
	if member {
		t.Error("a removed user must lose their team memberships")
	}

	// They are out of the directory the pickers are built from.
	users, err := svc.ListUsers(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	for _, u := range users {
		if u.ID == bob {
			t.Error("a removed user must not appear in the workspace listing")
		}
	}

	// On the stream: an upsert of the archived row rather than a delete, so every client
	// keeps the name that renders on the issues they left behind.
	rows, err := db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID: f.WorkspaceID, AfterVersion: before, ThroughVersion: 1 << 40, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	var sawUserUpsert, sawMembershipDelete bool
	for _, r := range rows {
		switch {
		case r.EntityType == "user" && r.EntityID == bob:
			if r.Op != string(domain.OpUpsert) {
				t.Errorf("user change op = %s, want upsert: a delete leaves every issue they created rendering a blank name", r.Op)
			}
			if !strings.Contains(string(r.Payload), "archivedAt") {
				t.Errorf("the payload must carry archivedAt so clients drop them from pickers: %s", r.Payload)
			}
			sawUserUpsert = true
		case r.EntityType == "teamMembership" && r.Op == string(domain.OpDelete):
			sawMembershipDelete = true
		}
	}
	if !sawUserUpsert {
		t.Error("no user change was emitted; clients would keep showing a member who has left")
	}
	if !sawMembershipDelete {
		t.Error("no membership delete was emitted; the team's member list would keep showing them")
	}
}

func TestRemoveUser_OnlyAdminsCanRemovePeople(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	mallory := f.NewUser(t, "mallory", "member", true)
	pMallory := f.PrincipalFor(mallory, authz.RoleMember, f.TeamID)

	_, _, err := svc.RemoveUser(ctx, pMallory, bob)
	if code := platform.CodeOf(err); code != platform.CodeForbidden {
		t.Fatalf("code = %s, want %s", code, platform.CodeForbidden)
	}
}

// newNeighbouringWorkspace builds a second, unrelated workspace and returns an admin
// principal inside it.
//
// Deliberately not a second testutil fixture: the fixture derives its account address from
// the first eight characters of a v7 uuid, which are a millisecond timestamp, so two
// fixtures built in the same millisecond collide on account_email_lower_key.
func newNeighbouringWorkspace(t *testing.T, db *store.DB, svc *domain.Service) *authz.Principal {
	t.Helper()
	ctx := context.Background()

	accountID := uuid.Must(uuid.NewV7())
	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := q.CreateAccount(ctx, store.CreateAccountParams{
			ID: accountID, Email: "neighbour+" + accountID.String() + "@example.com",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create neighbouring account: %v", err)
	}

	res, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID:     accountID,
		Name:          "Neighbour",
		URLKey:        "neighbour-" + accountID.String(),
		UserName:      "Neighbour Admin",
		FirstTeamKey:  "NBR",
		FirstTeamName: "Neighbour",
	})
	if err != nil {
		t.Fatalf("create neighbouring workspace: %v", err)
	}

	p, err := svc.ResolvePrincipal(ctx, accountID, res.Workspace.ID)
	if err != nil {
		t.Fatalf("resolve neighbouring principal: %v", err)
	}
	return p
}

func TestRemoveUser_AnotherWorkspacesUserIsNotFound(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	neighbour := newNeighbouringWorkspace(t, db, svc)

	// Not-found and not forbidden: confirming that an id exists in a workspace the caller
	// has nothing to do with is itself a leak.
	_, _, err := svc.RemoveUser(ctx, f.Principal(), neighbour.UserID)
	if code := platform.CodeOf(err); code != platform.CodeNotFound {
		t.Fatalf("code = %s, want %s", code, platform.CodeNotFound)
	}
	_, _, err = svc.RemoveUser(ctx, f.Principal(), uuid.Must(uuid.NewV7()))
	if code := platform.CodeOf(err); code != platform.CodeNotFound {
		t.Fatalf("unknown id gave %s, want %s — it must answer exactly as a foreign id does",
			code, platform.CodeNotFound)
	}
}

func TestRevokeInvite_CannotReachAnotherWorkspacesInvitation(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	neighbour := newNeighbouringWorkspace(t, db, svc)

	invite, err := svc.InviteToWorkspace(ctx, neighbour, domain.InviteInput{
		Email: "newcomer@example.com",
	})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}

	_, _, err = svc.RevokeInvite(ctx, f.Principal(), invite.ID)
	if code := platform.CodeOf(err); code != platform.CodeNotFound {
		t.Fatalf("code = %s, want %s — an admin of one workspace must not reach into another",
			code, platform.CodeNotFound)
	}

	// And it really is still pending, rather than having been revoked before the error.
	pending, err := svc.ListInvites(ctx, neighbour)
	if err != nil {
		t.Fatalf("list invites: %v", err)
	}
	if len(pending) != 1 || pending[0].ID != invite.ID {
		t.Fatalf("the invitation must survive a foreign revoke; got %+v", pending)
	}
}

func TestRevokeInvite_RemovesItFromThePendingList(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	invite, err := svc.InviteToWorkspace(ctx, f.Principal(), domain.InviteInput{
		Email: "newcomer@example.com",
	})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}

	id, _, err := svc.RevokeInvite(ctx, f.Principal(), invite.ID)
	if err != nil {
		t.Fatalf("revoke invite: %v", err)
	}
	if id != invite.ID {
		t.Errorf("id = %s, want %s", id, invite.ID)
	}

	pending, err := svc.ListInvites(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list invites: %v", err)
	}
	if len(pending) != 0 {
		t.Errorf("a revoked invitation is still pending: %+v", pending)
	}

	// Revoking twice is not a silent success: the second call has nothing to revoke, and
	// answering success either way would hide an id that was never an invitation at all.
	if _, _, err := svc.RevokeInvite(ctx, f.Principal(), invite.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Errorf("second revoke gave %v, want not-found", err)
	}
}

func TestListInvites_IsAdminsOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	if _, err := svc.InviteToWorkspace(ctx, f.Principal(), domain.InviteInput{
		Email: "newcomer@example.com",
	}); err != nil {
		t.Fatalf("invite: %v", err)
	}

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)

	// The list is a set of addresses of people who do not work here yet.
	if _, err := svc.ListInvites(ctx, pBob); platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("a member listing invitations got %v, want forbidden", err)
	}

	pending, err := svc.ListInvites(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list invites: %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("expected one pending invitation, got %d", len(pending))
	}
	// The token went out in the email and exists nowhere else, including here.
	if strings.Contains(strings.ToLower(pending[0].Email), "token") {
		t.Fatal("unexpected token-shaped data on the invite")
	}
}

func TestEntitlements_CountsSeatsAsActiveHumansOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	f.NewUser(t, "carol", "member", true)

	// An agent installation. Charging for an integration's identity would make every
	// integration a purchasing decision, so app users are not seats.
	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := q.CreateUser(ctx, store.CreateUserParams{
			ID:          uuid.Must(uuid.NewV7()),
			WorkspaceID: f.WorkspaceID,
			Name:        "Deploy bot",
			DisplayName: "deploybot",
			Timezone:    "UTC",
			Role:        "member",
			Kind:        "app",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create app user: %v", err)
	}

	// Suspending is how an admin frees a seat, so a suspended member is not counted.
	if _, _, err := svc.SuspendUser(ctx, f.Principal(), bob, true); err != nil {
		t.Fatalf("suspend: %v", err)
	}

	set, err := svc.EntitlementSet(ctx, f.Principal())
	if err != nil {
		t.Fatalf("entitlements: %v", err)
	}
	if set.SeatsUsed() != 2 {
		t.Errorf("seatsUsed = %d, want 2 (the admin and carol; not the bot, not the suspended member)",
			set.SeatsUsed())
	}

	// Named, not inherited. The fixture is self-hosted — unlimited, which is what this
	// repository's product is — and the matrix assertion below is about the cloud's starter
	// tier, so this test has to say which one it means.
	f.SetPlan(t, entitlement.PlanFree)

	features, err := svc.Entitlements(ctx, f.Principal())
	if err != nil {
		t.Fatalf("entitlements: %v", err)
	}
	if features.SeatLimit != 5 || !features.APIKeys || features.SSO {
		t.Errorf("free plan resolved to %+v, want the free row of the matrix", features)
	}
}

func TestEntitlements_HonourASeatOverrideAndReportALapseWithoutHidingThePlan(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// The facts a billing job writes: a negotiated seat count, and a plan that has lapsed.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE workspace SET plan = 'pro', seat_limit = 3, plan_lapsed_at = now() WHERE id = $1`,
		f.WorkspaceID,
	); err != nil {
		t.Fatalf("set plan facts: %v", err)
	}

	set, err := svc.EntitlementSet(ctx, f.Principal())
	if err != nil {
		t.Fatalf("entitlements: %v", err)
	}
	if set.Plan() != entitlement.PlanPro {
		t.Errorf("plan = %s, want pro", set.Plan())
	}
	if !set.Lapsed() {
		t.Error("plan_lapsed_at must be reported, or the client sends a paying customer to an upgrade screen")
	}

	features, err := svc.Entitlements(ctx, f.Principal())
	if err != nil {
		t.Fatalf("entitlements: %v", err)
	}
	// The override replaces the plan's unlimited seats, and the lapse is reported alongside
	// rather than folded into the numbers: a workspace whose card failed sees what it is
	// paying for, not free-tier limits it never bought.
	if features.SeatLimit != 3 {
		t.Errorf("seatLimit = %d, want the negotiated 3", features.SeatLimit)
	}
	if features.SSO {
		t.Error("Pro does not include SSO")
	}

	// Reads keep working and so do the writes the free tier includes — locking people out
	// of their own data over a failed card is not a business model.
	if _, _, _, err := svc.CreateApiKey(ctx, f.Principal(), domain.CreateApiKeyInput{
		Name: "still works",
	}); err != nil {
		t.Errorf("a lapsed workspace must keep the features the free tier includes: %v", err)
	}
}

// A suspended administrator is not one of the administrators the workspace is relying on, so
// none of the three routes out of that state may be refused for taking the last one away.
//
// This is the shape the bug had: an active admin and a suspended one, the count correctly
// reporting a single active administrator, and the guard testing the *target's* role alone —
// so the suspended row could not be demoted, could not be removed, and could not leave, and
// the refusal named them the workspace's last owner while the actual last owner was the
// person pressing the button. The only escape was to restore them, taking a seat back,
// change the role, and suspend them again.
func TestLastAdministratorGuard_IgnoresASuspendedAdmin(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// f's own user is the active admin throughout; these are the ones being acted on.
	demote := f.NewUser(t, "demote", "admin", true)
	remove := f.NewUser(t, "remove", "admin", true)
	leave := f.NewUser(t, "leave", "admin", true)

	for _, id := range []uuid.UUID{demote, remove, leave} {
		if _, _, err := svc.SuspendUser(ctx, f.Principal(), id, true); err != nil {
			t.Fatalf("suspend %s: %v", id, err)
		}
	}

	// One active administrator remains: the fixture's. That is what the count says, and it
	// is what the rule is protecting — none of the three below reduce it.
	admins, err := db.Queries().CountActiveAdminsInWorkspace(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("count admins: %v", err)
	}
	if admins != 1 {
		t.Fatalf("active admins = %d, want 1 — the premise of this test", admins)
	}

	if _, _, err := svc.SetUserRole(ctx, f.Principal(), demote, "member"); err != nil {
		t.Errorf("demoting a suspended admin must be allowed: %v", err)
	}

	if _, _, err := svc.RemoveUser(ctx, f.Principal(), remove); err != nil {
		t.Errorf("removing a suspended admin must be allowed: %v", err)
	}

	pLeave := f.PrincipalFor(leave, authz.RoleAdmin, f.TeamID)
	if _, _, err := svc.LeaveWorkspace(ctx, pLeave); err != nil {
		t.Errorf("a suspended admin must be able to leave: %v", err)
	}

	// And the rule itself is untouched: the one active administrator still cannot go.
	if _, _, err := svc.RemoveUser(ctx, f.Principal(), f.UserID); platform.CodeOf(err) != platform.CodeConflict {
		t.Errorf("code = %s, want %s — the last active admin is still protected (err = %v)",
			platform.CodeOf(err), platform.CodeConflict, err)
	}
}

// Demotion to guest severs the API keys the person minted as a member.
//
// A guest cannot create one — CreateApiKey refuses outright — so leaving the old keys alive
// would make demotion the one route to a guest holding exactly the credential the product
// says a guest may not have, with every unattended script they wired up still running.
func TestSetUserRole_RevokesApiKeysOnConvertToGuest(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	member := f.NewUser(t, "contractor", "member", true)
	pMember := f.PrincipalFor(member, authz.RoleMember, f.TeamID)
	pMember.AccountID = f.AccountID

	_, token, _, err := svc.CreateApiKey(ctx, pMember, domain.CreateApiKeyInput{Name: "member key"})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if _, err := svc.AuthenticateApiKey(ctx, token); err != nil {
		t.Fatalf("the key does not work before the demotion: %v", err)
	}

	if _, _, err := svc.SetUserRole(ctx, f.Principal(), member, "guest"); err != nil {
		t.Fatalf("demote: %v", err)
	}

	if _, err := svc.AuthenticateApiKey(ctx, token); err == nil {
		t.Fatal("the key minted as a member still authenticates after the demotion to guest")
	} else if code := platform.CodeOf(err); code != platform.CodeUnauthorized {
		t.Errorf("code = %s, want %s", code, platform.CodeUnauthorized)
	}
}

// Promotion is not demotion: nothing has been taken away, so nothing is severed.
func TestSetUserRole_KeepsApiKeysOnPromotion(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	member := f.NewUser(t, "engineer", "member", true)
	pMember := f.PrincipalFor(member, authz.RoleMember, f.TeamID)
	pMember.AccountID = f.AccountID

	_, token, _, err := svc.CreateApiKey(ctx, pMember, domain.CreateApiKeyInput{Name: "deploy bot"})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if _, _, err := svc.SetUserRole(ctx, f.Principal(), member, "admin"); err != nil {
		t.Fatalf("promote: %v", err)
	}
	if _, err := svc.AuthenticateApiKey(ctx, token); err != nil {
		t.Fatalf("promotion broke a working key: %v", err)
	}
}
