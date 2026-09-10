package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
	"github.com/peixotolabs/polaris/services/migrations"
)

// Migration 000088 recolours the completed states that existing workspaces were seeded
// with, and it is the half of "Done is green" that palette changes cannot do: both clients
// prefer a state's *stored* colour over the category token, so a workspace whose Done row
// still holds the old accent keeps drawing an indigo disc no matter what the tokens say.
//
// What makes it worth a test rather than an eyeball is the part it must NOT do. A team that
// opened team settings and chose a colour made a decision, and a migration that recoloured
// every completed row would silently discard it. The equality check on the legacy default
// is the whole mechanism, and it is one WHERE clause away from being wrong in a way nobody
// would notice until a customer asked where their palette went.
func TestMigration088_RecoloursOnlyTheUntouchedDefault(t *testing.T) {
	const (
		legacy = "#5e6ad2"
		green  = "#188a55"
		custom = "#ff00aa"
	)

	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	ctx := context.Background()

	up := readMigration(t, "000088_done_state_green.up.sql")
	down := readMigration(t, "000088_done_state_green.down.sql")

	// name → (category, colour before the migration).
	states := []struct{ name, category, color string }{
		{"Shipped", "completed", legacy},
		// The same default, as a workspace that round-tripped it through a colour picker
		// that upper-cases. The migration matches on lower(color) for exactly this.
		{"Released", "completed", "#5E6AD2"},
		{"Verified", "completed", custom},
		// Right colour, wrong category: an "In Review" that a team deliberately painted the
		// accent is not a completed state and must not move.
		{"In Review", "started", legacy},
	}
	for _, s := range states {
		if _, err := db.Pool().Exec(ctx,
			`INSERT INTO workflow_state (id, workspace_id, team_id, name, color, category, position)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			uuid.Must(uuid.NewV7()), f.WorkspaceID, f.TeamID, s.name, s.color, s.category, "z"+s.name,
		); err != nil {
			t.Fatalf("insert %s: %v", s.name, err)
		}
	}
	if _, err := db.Pool().Exec(ctx,
		`INSERT INTO project_status (id, workspace_id, name, color, category, position, is_default)
		 VALUES ($1, $2, 'Shipped', $3, 'completed', 'z0', false)`,
		uuid.Must(uuid.NewV7()), f.WorkspaceID, legacy,
	); err != nil {
		t.Fatalf("insert project status: %v", err)
	}

	if _, err := db.Pool().Exec(ctx, up); err != nil {
		t.Fatalf("up migration: %v", err)
	}

	assertStateColor(t, db, f.WorkspaceID, "Shipped", green)
	assertStateColor(t, db, f.WorkspaceID, "Released", green)
	assertStateColor(t, db, f.WorkspaceID, "Verified", custom)
	assertStateColor(t, db, f.WorkspaceID, "In Review", legacy)
	assertProjectStatusColor(t, db, f.WorkspaceID, "Shipped", green)

	// Down puts back exactly the set up moved, and nothing else. A deliberate colour that
	// survived the up migration has to survive the down one too — a rollback that eats a
	// customer's palette is worse than the bug it is rolling back.
	if _, err := db.Pool().Exec(ctx, down); err != nil {
		t.Fatalf("down migration: %v", err)
	}

	assertStateColor(t, db, f.WorkspaceID, "Shipped", legacy)
	assertStateColor(t, db, f.WorkspaceID, "Released", legacy)
	assertStateColor(t, db, f.WorkspaceID, "Verified", custom)
	assertStateColor(t, db, f.WorkspaceID, "In Review", legacy)
	assertProjectStatusColor(t, db, f.WorkspaceID, "Shipped", legacy)
}

// Running it twice must be a no-op the second time: a migration that is not idempotent over
// its own output cannot be re-run after a partial failure.
func TestMigration088_IsIdempotent(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	ctx := context.Background()

	up := readMigration(t, "000088_done_state_green.up.sql")
	for range 2 {
		if _, err := db.Pool().Exec(ctx, up); err != nil {
			t.Fatalf("up migration: %v", err)
		}
	}
	// The fixture seeds Done at the value the seed now uses, so the assertion is that
	// re-running left it alone rather than that it moved.
	assertStateColor(t, db, f.WorkspaceID, "Done", "#188a55")
}

func readMigration(t *testing.T, name string) string {
	t.Helper()
	b, err := migrations.FS.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(b)
}

func assertStateColor(t *testing.T, db *store.DB, workspaceID uuid.UUID, name, want string) {
	t.Helper()
	var got string
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT color FROM workflow_state WHERE workspace_id = $1 AND name = $2`,
		workspaceID, name,
	).Scan(&got); err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if got != want {
		t.Errorf("workflow_state %q is %s, want %s", name, got, want)
	}
}

func assertProjectStatusColor(t *testing.T, db *store.DB, workspaceID uuid.UUID, name, want string) {
	t.Helper()
	var got string
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT color FROM project_status WHERE workspace_id = $1 AND name = $2`,
		workspaceID, name,
	).Scan(&got); err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if got != want {
		t.Errorf("project_status %q is %s, want %s", name, got, want)
	}
}
