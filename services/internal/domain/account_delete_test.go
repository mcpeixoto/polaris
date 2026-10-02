package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestDeleteAccount_SoleOwnerIsErasedAndCannotSignIn(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	issueID := f.NewIssue(t, "kept")

	if _, _, err := svc.DeleteAccount(ctx, f.Principal()); err != nil {
		t.Fatalf("delete: %v", err)
	}

	if _, err := db.Queries().GetAccount(ctx, f.AccountID); !store.IsNotFound(err) {
		t.Fatalf("account err = %v, want not found", err)
	}
	user, err := db.Queries().GetUser(ctx, f.UserID)
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if user.AccountID != nil {
		t.Fatal("the membership still points at an account")
	}
	if user.DisplayName != "Deleted user" || user.ArchivedAt == nil || user.Status != "suspended" {
		t.Fatalf("user = name %q status %s archived %v", user.DisplayName, user.Status, user.ArchivedAt)
	}
	issue, err := db.Queries().GetIssue(ctx, issueID)
	if err != nil {
		t.Fatalf("get issue: %v", err)
	}
	if issue.CreatorID == nil || *issue.CreatorID != f.UserID {
		t.Fatalf("creator = %v, want the erased user still attributed", issue.CreatorID)
	}
}

func TestDeleteAccount_MemberOfASharedWorkspaceCanLeave(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	row, err := db.Queries().GetUser(ctx, bob)
	if err != nil {
		t.Fatalf("get bob: %v", err)
	}
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)
	pBob.AccountID = *row.AccountID

	if _, _, err := svc.DeleteAccount(ctx, pBob); err != nil {
		t.Fatalf("delete: %v", err)
	}
	owner, err := db.Queries().GetUser(ctx, f.UserID)
	if err != nil {
		t.Fatalf("get owner: %v", err)
	}
	if owner.ArchivedAt != nil || owner.Status != "active" {
		t.Fatalf("the other admin was touched: status %s archived %v", owner.Status, owner.ArchivedAt)
	}
}

func TestDeleteAccount_LastOwnerOfASharedWorkspaceIsRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	f.NewUser(t, "bob", "member", true)

	_, _, err := svc.DeleteAccount(ctx, f.Principal())
	if code := platform.CodeOf(err); code != platform.CodeConflict {
		t.Fatalf("code = %s, want %s (err = %v)", code, platform.CodeConflict, err)
	}
	if !strings.Contains(err.Error(), "last owner") {
		t.Fatalf("the refusal must say why: %v", err)
	}
	if _, err := db.Queries().GetAccount(ctx, f.AccountID); err != nil {
		t.Fatalf("a refused deletion removed the account: %v", err)
	}
}
