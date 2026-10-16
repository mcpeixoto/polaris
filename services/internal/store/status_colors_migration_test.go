package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Migration 000093 is the half of the colour change a palette edit cannot do. Clients
// prefer the colour stored on the row, so a workspace whose In Progress is still the old
// amber keeps drawing a yellow pie until the row moves.
//
// The part that must not happen is the other half of the same WHERE clause: a team that
// chose a colour, or that already had an In Review, keeps that choice. Recolouring every
// started row, or inserting a second In Review, is how a customer's palette disappears.
func TestMigration093_RecoloursOnlyTheUntouchedDefault(t *testing.T) {
	const (
		legacy = "#f2c94c"
		blue   = "#56b6d8"
		custom = "#ff00aa"
		purple = "#5e6ad2"
	)

	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	ctx := context.Background()

	// The fixture is already on the new blue. Put this workspace back where a deploy of
	// this migration would find it, then add the rows the WHERE clauses have to spare.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE workflow_state SET color = $1
		  WHERE workspace_id = $2 AND name = 'In Progress'`,
		legacy, f.WorkspaceID); err != nil {
		t.Fatalf("rewind workflow colour: %v", err)
	}
	if _, err := db.Pool().Exec(ctx,
		`UPDATE project_status SET color = $1
		  WHERE workspace_id = $2 AND name = 'In Progress'`,
		legacy, f.WorkspaceID); err != nil {
		t.Fatalf("rewind project colour: %v", err)
	}
	if _, err := db.Pool().Exec(ctx,
		`INSERT INTO workflow_state (id, workspace_id, team_id, name, color, category, position)
		 VALUES ($1, $2, $3, 'Holding', $4, 'started', 'zhold')`,
		uuid.Must(uuid.NewV7()), f.WorkspaceID, f.TeamID, legacy); err != nil {
		t.Fatalf("insert holding: %v", err)
	}
	if _, err := db.Pool().Exec(ctx,
		`INSERT INTO workflow_state (id, workspace_id, team_id, name, color, category, position)
		 VALUES ($1, $2, $3, 'In Review', $4, 'started', 'zrev')`,
		uuid.Must(uuid.NewV7()), f.WorkspaceID, f.TeamID, purple); err != nil {
		t.Fatalf("insert review: %v", err)
	}

	other := uuid.Must(uuid.NewV7())
	if _, err := db.Pool().Exec(ctx,
		`INSERT INTO team (id, workspace_id, key, name) VALUES ($1, $2, 'OPS', 'Operations')`,
		other, f.WorkspaceID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if _, err := db.Pool().Exec(ctx,
		`INSERT INTO workflow_state (id, workspace_id, team_id, name, color, category, position)
		 VALUES ($1, $2, $3, 'In Progress', $4, 'started', 'a2')`,
		uuid.Must(uuid.NewV7()), f.WorkspaceID, other, custom); err != nil {
		t.Fatalf("insert custom progress: %v", err)
	}

	up := readMigration(t, "000093_status_colors.up.sql")
	if _, err := db.Pool().Exec(ctx, up); err != nil {
		t.Fatalf("up migration: %v", err)
	}

	assertTeamStateColor(t, db, f.TeamID, "In Progress", blue)
	assertProjectStatusColor(t, db, f.WorkspaceID, "In Progress", blue)
	assertTeamStateColor(t, db, f.TeamID, "Holding", legacy)
	assertTeamStateColor(t, db, f.TeamID, "In Review", purple)

	var customColor string
	if err := db.Pool().QueryRow(ctx,
		`SELECT color FROM workflow_state WHERE team_id = $1 AND name = 'In Progress'`,
		other).Scan(&customColor); err != nil {
		t.Fatalf("read custom: %v", err)
	}
	if customColor != custom {
		t.Errorf("a chosen In Progress colour moved from %s to %s", custom, customColor)
	}

	var reviews int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM workflow_state
		  WHERE team_id = $1 AND archived_at IS NULL AND lower(name) = 'in review'`,
		other).Scan(&reviews); err != nil {
		t.Fatalf("count reviews: %v", err)
	}
	if reviews != 1 {
		t.Errorf("team without a review status has %d, want the one this migration inserts", reviews)
	}
	var reviewColor string
	if err := db.Pool().QueryRow(ctx,
		`SELECT color FROM workflow_state WHERE team_id = $1 AND name = 'In Review'`,
		other).Scan(&reviewColor); err != nil {
		t.Fatalf("read inserted review: %v", err)
	}
	if reviewColor != legacy {
		t.Errorf("inserted In Review is %s, want %s", reviewColor, legacy)
	}

	if _, err := db.Pool().Exec(ctx, up); err != nil {
		t.Fatalf("second up: %v", err)
	}
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM workflow_state
		  WHERE team_id = $1 AND archived_at IS NULL AND lower(name) = 'in review'`,
		other).Scan(&reviews); err != nil {
		t.Fatalf("recount: %v", err)
	}
	if reviews != 1 {
		t.Errorf("running the migration twice left %d In Review rows", reviews)
	}

	down := readMigration(t, "000093_status_colors.down.sql")
	if _, err := db.Pool().Exec(ctx, down); err != nil {
		t.Fatalf("down migration: %v", err)
	}
	assertTeamStateColor(t, db, f.TeamID, "In Progress", legacy)
	assertProjectStatusColor(t, db, f.WorkspaceID, "In Progress", legacy)
	assertTeamStateColor(t, db, f.TeamID, "Holding", legacy)
	assertTeamStateColor(t, db, f.TeamID, "In Review", purple)
	if err := db.Pool().QueryRow(ctx,
		`SELECT color FROM workflow_state WHERE team_id = $1 AND name = 'In Progress'`,
		other).Scan(&customColor); err != nil {
		t.Fatalf("read custom after down: %v", err)
	}
	if customColor != custom {
		t.Errorf("down rewrote a chosen colour to %s", customColor)
	}
}

func assertTeamStateColor(t *testing.T, db *store.DB, teamID uuid.UUID, name, want string) {
	t.Helper()
	var got string
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT color FROM workflow_state WHERE team_id = $1 AND name = $2`,
		teamID, name,
	).Scan(&got); err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if got != want {
		t.Errorf("workflow_state %q is %s, want %s", name, got, want)
	}
}
