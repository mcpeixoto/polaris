package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A workspace comes with its built-in agent when a model is configured, so the Delegate
// picker has somebody in it on day one.
func TestEnsureAgentIdentities_MintsTheBuiltinAgentOnceWhenEnabled(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.SetAgentEnabled(true)
	ctx := context.Background()

	// The fixture's workspace predates the mint; the backfill gives it one, once.
	n, err := svc.EnsureAgentIdentities(ctx)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if n < 1 {
		t.Fatalf("backfill minted %d, want the fixture workspace", n)
	}
	id, err := db.Queries().GetAgentIdentity(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("agent identity: %v", err)
	}
	u, err := db.Queries().GetUser(ctx, id)
	if err != nil || u.Kind != "app" || u.Name != domain.AgentDisplayName {
		t.Fatalf("agent user = %+v (%v), want an app user named %q", u, err, domain.AgentDisplayName)
	}
	if again, err := svc.EnsureAgentIdentities(ctx); err != nil {
		t.Fatalf("second backfill: %v", err)
	} else {
		// Other test workspaces may share the database; ours must not be minted twice.
		if _, err := db.Queries().GetAgentIdentity(ctx, f.WorkspaceID); err != nil {
			t.Fatalf("identity lost after %d more: %v", again, err)
		}
	}
	var users int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM "user" WHERE workspace_id = $1 AND kind = 'app' AND name = $2`,
		f.WorkspaceID, domain.AgentDisplayName).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("agent users = %d, want exactly 1", users)
	}
}

func TestEnsureAgentIdentities_DoesNothingWhenTheAgentIsOff(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	if n, err := svc.EnsureAgentIdentities(ctx); err != nil || n != 0 {
		t.Fatalf("backfill with the agent off = %d, %v; want 0, nil", n, err)
	}
	if _, err := db.Queries().GetAgentIdentity(ctx, f.WorkspaceID); err == nil {
		t.Fatal("an agent was minted on an install with no model configured")
	}
}
