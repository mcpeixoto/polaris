package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreatePulseFeed_IsPersonalAndNamesTheProjects(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}

	feed, version, err := svc.CreatePulseFeed(ctx, p, domain.CreatePulseFeedInput{
		Name: " Shipping ", ProjectIDs: []uuid.UUID{project.ID},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if feed.Name != "Shipping" {
		t.Fatalf("name %q, want trimmed Shipping", feed.Name)
	}
	if len(feed.ProjectIDs) != 1 || feed.ProjectIDs[0] != project.ID {
		t.Fatalf("projects %v", feed.ProjectIDs)
	}
	if version < 1 {
		t.Fatalf("version %d", version)
	}

	scope, err := authz.ParseScope(changesForEntity(t, db, f.WorkspaceID, "pulseFeed")[0].Scope)
	if err != nil {
		t.Fatalf("parse scope: %v", err)
	}
	if scope.Kind != authz.ScopeUser || scope.UserID == nil || *scope.UserID != p.UserID {
		t.Fatalf("scope %+v, want the owner", scope)
	}
}

func TestCreatePulseFeed_RefusesAGuestAndAnEmptySet(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}

	guestID := f.NewUser(t, "guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)
	if _, _, err := svc.CreatePulseFeed(ctx, guest, domain.CreatePulseFeedInput{
		Name: "Mine", ProjectIDs: []uuid.UUID{project.ID},
	}); err == nil {
		t.Fatal("a guest created a Pulse feed")
	}

	if _, _, err := svc.CreatePulseFeed(ctx, p, domain.CreatePulseFeedInput{
		Name: "Empty", ProjectIDs: nil,
	}); err == nil {
		t.Fatal("an empty project list was accepted")
	}
	if _, _, err := svc.CreatePulseFeed(ctx, p, domain.CreatePulseFeedInput{
		Name: "   ", ProjectIDs: []uuid.UUID{project.ID},
	}); err == nil {
		t.Fatal("a blank name was accepted")
	}
}

func TestUpdateAndDeletePulseFeed_StayWithTheOwner(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	other, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Other", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("other project: %v", err)
	}
	feed, _, err := svc.CreatePulseFeed(ctx, p, domain.CreatePulseFeedInput{
		Name: "Launch", ProjectIDs: []uuid.UUID{project.ID},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	name := "Renamed"
	updated, _, err := svc.UpdatePulseFeed(ctx, p, domain.UpdatePulseFeedInput{
		ID: feed.ID, Name: &name, ProjectIDs: []uuid.UUID{other.ID},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Renamed" || len(updated.ProjectIDs) != 1 || updated.ProjectIDs[0] != other.ID {
		t.Fatalf("updated %+v", updated)
	}

	otherUser := f.NewUser(t, "other", "member", false)
	otherP := f.PrincipalFor(otherUser, authz.RoleMember)
	if _, _, err := svc.UpdatePulseFeed(ctx, otherP, domain.UpdatePulseFeedInput{
		ID: feed.ID, Name: &name,
	}); err == nil {
		t.Fatal("somebody else renamed a feed they do not own")
	}

	if _, err := svc.DeletePulseFeed(ctx, p, feed.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.DeletePulseFeed(ctx, p, feed.ID); err == nil {
		t.Fatal("deleting twice succeeded")
	}
}
