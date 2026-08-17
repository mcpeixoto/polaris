package domain_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The plan limits, at the call sites that spend them.
//
// internal/entitlement decides the boundaries and tests them exhaustively without a
// database. What it cannot test is whether anybody asks — and for a long time nobody did:
// `CanAddSeat` and `CanAddTeam` had no caller outside their own package, so a workspace on
// the five-seat tier could hold fifty people and a settings screen quoted a limit that
// existed only in the matrix. These tests are about the asking.

// fillSeats adds people until the workspace has `want` active humans, so a test can stand
// exactly at a limit rather than near it.
func fillSeats(t *testing.T, f *testutil.Fixture, want int) {
	t.Helper()
	used := activeSeats(t, f)
	for i := used; i < want; i++ {
		f.NewUser(t, fmt.Sprintf("seat%d", i), "member", false)
	}
	if got := activeSeats(t, f); got != want {
		t.Fatalf("wanted %d seats used, have %d", want, got)
	}
}

func activeSeats(t *testing.T, f *testutil.Fixture) int {
	t.Helper()
	n, err := f.DB.Queries().CountWorkspaceSeats(context.Background(), f.WorkspaceID)
	if err != nil {
		t.Fatalf("count seats: %v", err)
	}
	return int(n)
}

// requireEntitlementRefusal fails unless the error is a plan refusal.
//
// The code matters more than the sentence: GraphQL presents PLAN_LIMIT and REST answers
// 402 from it, and a paywall that has only a message to work with becomes a paywall that
// string-matches one. An ordinary Forbidden or Validation here would render as a bug rather
// than as an upsell.
func requireEntitlementRefusal(t *testing.T, err error, what string) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s was allowed past the plan limit", what)
	}
	if code := platform.CodeOf(err); code != platform.CodeEntitlement {
		t.Fatalf("%s was refused as %s, want %s — the client cannot tell a paywall from a "+
			"fault: %v", what, code, platform.CodeEntitlement, err)
	}
}

func TestCreateTeam_IsRefusedAtThePlansTeamLimit(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// Free includes two teams, and the fixture already has one.
	f.SetPlan(t, entitlement.PlanFree)

	if _, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "DES", Name: "Design",
	}); err != nil {
		t.Fatalf("the second team is inside the limit and was refused: %v", err)
	}

	_, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "OPS", Name: "Operations",
	})
	requireEntitlementRefusal(t, err, "a third team on the free plan")
}

func TestCreateTeam_HasNoLimitWhenSelfHosted(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// The plan this repository's product runs on. A self-hoster meeting a team cap would be
	// meeting a cap that exists for billing reasons on a deployment they are not part of —
	// see the comment on PlanSelfHosted, and the README's promise.
	for _, key := range []string{"DES", "OPS", "SEC", "DOC"} {
		if _, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
			Key: key, Name: key,
		}); err != nil {
			t.Fatalf("self-hosted refused team %s: %v", key, err)
		}
	}
}

func TestCreateTeam_DoesNotCountArchivedTeamsAgainstTheLimit(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanFree)

	second, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "DES", Name: "Design",
	})
	if err != nil {
		t.Fatalf("second team: %v", err)
	}

	// Archiving is the way back under a limit. Without it the only route is deleting work,
	// which is not a thing to ask of somebody who has just changed their mind about a team.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE team SET archived_at = now() WHERE id = $1`, second.ID,
	); err != nil {
		t.Fatalf("archive: %v", err)
	}

	if _, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "OPS", Name: "Operations",
	}); err != nil {
		t.Fatalf("an archived team is still occupying its slot: %v", err)
	}
}

func TestInviteToWorkspace_IsRefusedWhenThereIsNoSeatLeft(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanFree)
	fillSeats(t, f, 5)

	// Refused at the moment somebody can still do something about it. The alternative is an
	// admin who learns about the cap from a colleague whose link did not work.
	_, err := svc.InviteToWorkspace(ctx, f.Principal(), domain.InviteInput{Email: "new@example.com"})
	requireEntitlementRefusal(t, err, "an invitation sent into a full workspace")
}

func TestAcceptInvite_IsRefusedWhenTheSeatWentWhileTheInvitationSat(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanFree)
	fillSeats(t, f, 4)

	// Sent while there was room.
	invite, err := svc.InviteToWorkspace(ctx, f.Principal(), domain.InviteInput{Email: "new@example.com"})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}

	// And redeemed after somebody else took the last one. This is why the check at send
	// time cannot replace the one at acceptance: days pass between them.
	fillSeats(t, f, 5)

	accountID := newAccount(t, db, "new@example.com")
	_, _, err = svc.AcceptInvite(ctx, accountID, invite.Token, "New Person")
	requireEntitlementRefusal(t, err, "an invitation redeemed into a full workspace")
}

func TestAcceptInvite_ChargesNoSeatToSomebodyWhoIsAlreadyAMember(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanFree)
	fillSeats(t, f, 4)

	accountID := newAccount(t, db, "new@example.com")
	invite, err := svc.InviteToWorkspace(ctx, f.Principal(), domain.InviteInput{Email: "new@example.com"})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}

	// They join by another route while the invitation is still outstanding, and the last
	// seat goes with them. `applyInvite` puts the seat check BELOW its already-a-member
	// branch precisely for this: they occupy the seat they already occupy, and refusing the
	// click would be a paywall on a link that grants nothing.
	if _, err := db.Queries().CreateUser(ctx, store.CreateUserParams{
		ID:          uuid.Must(uuid.NewV7()),
		WorkspaceID: f.WorkspaceID,
		AccountID:   &accountID,
		Name:        "New Person",
		DisplayName: "new",
		Timezone:    "UTC",
		Role:        "member",
		Kind:        "human",
	}); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if got := activeSeats(t, f); got != 5 {
		t.Fatalf("the workspace should now be full, %d seats used", got)
	}

	if _, _, err := svc.AcceptInvite(ctx, accountID, invite.Token, "New Person"); err != nil {
		t.Fatalf("an existing member's invitation was refused on entitlement grounds: %v", err)
	}
}

func TestSuspendUser_UnsuspendingIsRefusedWhenTheSeatIsGone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.SetPlan(t, entitlement.PlanFree)
	fillSeats(t, f, 5)

	// Suspension frees a seat — that is what makes it the answer to "we are full".
	suspended := f.NewUser(t, "leaving", "member", false)
	if _, _, err := svc.SuspendUser(ctx, f.Principal(), suspended, true); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if got := activeSeats(t, f); got != 5 {
		t.Fatalf("suspending did not free the seat: %d active", got)
	}

	// Somebody else takes it.
	fillSeats(t, f, 5)
	extra := f.NewUser(t, "arriving", "member", false)
	_ = extra

	// So bringing the suspended person back would put the workspace over its limit.
	_, _, err := svc.SuspendUser(ctx, f.Principal(), suspended, false)
	requireEntitlementRefusal(t, err, "un-suspending past the seat limit")

	// Suspending is always allowed, whatever the count: a workspace over its limit has to
	// be able to get under it.
	if _, _, err := svc.SuspendUser(ctx, f.Principal(), extra, true); err != nil {
		t.Fatalf("suspending was refused while over the limit: %v", err)
	}
}

// newAccount inserts a bare account, the way registration does before any workspace exists.
func newAccount(t *testing.T, db *store.DB, email string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := db.Queries().CreateAccount(context.Background(), store.CreateAccountParams{
		ID: id, Email: email,
	}); err != nil {
		t.Fatalf("create account %s: %v", email, err)
	}
	return id
}
