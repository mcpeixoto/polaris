package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestUpdateWorkspace_URLKeyChangeReservesTheOldAddress(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	current, err := db.Queries().GetWorkspace(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("current: %v", err)
	}
	old := current.UrlKey
	next := "renamed-" + f.WorkspaceID.String()

	ws, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{URLKey: &next})
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if ws.URLKey != next {
		t.Fatalf("urlKey = %q, want %q", ws.URLKey, next)
	}

	found, err := db.Queries().GetWorkspaceByURLKey(ctx, old)
	if err != nil {
		t.Fatalf("old key should still resolve: %v", err)
	}
	if found.ID != f.WorkspaceID {
		t.Fatalf("old key resolved to %s, want %s", found.ID, f.WorkspaceID)
	}

	_, err = svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Other",
		URLKey:    old,
		UserName:  "Other",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("taking a retired key: %v", err)
	}

	ws, _, err = svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{URLKey: &old})
	if err != nil {
		t.Fatalf("rename back: %v", err)
	}
	if ws.URLKey != old {
		t.Fatalf("urlKey = %q, want the original %q", ws.URLKey, old)
	}
}

func TestUpdateWorkspace_URLKeyValidationAndAuthz(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bad := "no spaces"
	if _, _, err := svc.UpdateWorkspace(ctx, f.Principal(), domain.UpdateWorkspaceInput{URLKey: &bad}); platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("invalid key: %v", err)
	}

	member := f.PrincipalFor(uuid.Must(uuid.NewV7()), authz.RoleMember, f.TeamID)
	next := "stolen-" + f.WorkspaceID.String()
	if _, _, err := svc.UpdateWorkspace(ctx, member, domain.UpdateWorkspaceInput{URLKey: &next}); platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("member rename: %v", err)
	}
}

func TestUpdateWorkspace_URLKeyConflictWithAnotherWorkspace(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	other, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Other",
		URLKey:    "other-" + f.WorkspaceID.String(),
		UserName:  "Other",
	})
	if err != nil {
		t.Fatalf("other: %v", err)
	}

	taken := other.Workspace.URLKey
	if _, _, err := svc.UpdateWorkspace(ctx, f.Principal(), domain.UpdateWorkspaceInput{URLKey: &taken}); platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("taking a live key: %v", err)
	}
}
