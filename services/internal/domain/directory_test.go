package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The workspace directory is workspace-scoped, and a guest does not receive it.
//
// `sync.go` withholds `user` from a guest's bootstrap for that reason, so a guest's
// replica holds no directory at all — while `Query.users` handed the same guest every
// person in the workspace. On a real install that is the staff list, reachable by anybody
// invited to one team. The two answers now agree.
func TestListDirectory_GuestsGetOnlyThemselves(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	guestID := f.NewUser(t, "guest", "guest", false)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	users, err := svc.ListDirectory(ctx, guest)
	if err != nil {
		t.Fatalf("list directory: %v", err)
	}
	if len(users) != 1 || users[0].ID != guestID {
		got := make([]string, 0, len(users))
		for _, u := range users {
			got = append(got, u.Name)
		}
		t.Fatalf("a guest received %d rows (%v); want their own row and nothing else", len(users), got)
	}
}

// And the hydration source stays wide, because it is not the directory: an issue in the
// guest's own team still has to render the name of whoever it is assigned to.
func TestListUsers_StaysWideForHydration(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	guestID := f.NewUser(t, "guest", "guest", false)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	users, err := svc.ListUsers(ctx, guest)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) < 2 {
		t.Fatalf("hydration saw %d users; assignees and creators resolve through this list", len(users))
	}
}

func TestListDirectory_MembersStillGetEverybody(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "mabel", "member", false)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)

	users, err := svc.ListDirectory(ctx, member)
	if err != nil {
		t.Fatalf("list directory: %v", err)
	}
	if len(users) < 2 {
		t.Fatalf("a member received %d rows; the directory is theirs to read", len(users))
	}
}
