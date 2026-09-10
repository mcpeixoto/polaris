package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// doneGreen is the one hex four places have to agree on: the seeds in this package,
// migration 000088, --color-green-500 in web/src/styles/tokens.css, and Palette.green500 on
// iOS. It is written out here rather than read from the package under test on purpose — a
// test that reads the constant it is checking passes whatever that constant was last
// edited to.
const doneGreen = "#188a55"

// The colour of "done" is the one thing on an issue row a reader finds without reading, and
// it used to be the accent — the same indigo as the selected row, the focused field and the
// primary button, which is to say the one hue that cannot single anything out.
func TestSeededDoneStateIsGreen(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	team, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "OPS", Name: "Operations",
	})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}

	// Read the seeded rows rather than list them through the service: the admin who created
	// the team is not a member of it, and team membership is what ListWorkflowStates checks.
	rows, err := db.Pool().Query(ctx,
		`SELECT name, color FROM workflow_state WHERE team_id = $1 AND category = 'completed'`,
		team.ID)
	if err != nil {
		t.Fatalf("query states: %v", err)
	}
	defer rows.Close()

	var found bool
	for rows.Next() {
		var name, color string
		if err := rows.Scan(&name, &color); err != nil {
			t.Fatalf("scan: %v", err)
		}
		found = true
		if !strings.EqualFold(color, doneGreen) {
			t.Errorf("a newly seeded %q is %s, want %s — completed is the state that has to "+
				"read as done at a glance", name, color, doneGreen)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if !found {
		t.Fatal("a newly seeded team has no completed state at all")
	}
}

// A project's "Completed" status draws the same disc and check StateIcon draws for an
// issue's Done, from the same category token. Two colours for one mark on one screen is
// what this covers.
func TestSeededCompletedProjectStatusIsGreen(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	out, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Second",
		URLKey:    "second-" + f.WorkspaceID.String(),
		UserName:  "Founder",
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	rows, err := db.Pool().Query(ctx,
		`SELECT name, color FROM project_status WHERE workspace_id = $1 AND category = 'completed'`,
		out.Workspace.ID)
	if err != nil {
		t.Fatalf("query project statuses: %v", err)
	}
	defer rows.Close()

	var found bool
	for rows.Next() {
		var name, color string
		if err := rows.Scan(&name, &color); err != nil {
			t.Fatalf("scan: %v", err)
		}
		found = true
		if !strings.EqualFold(color, doneGreen) {
			t.Errorf("a newly seeded project status %q is %s, want %s", name, color, doneGreen)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if !found {
		t.Fatal("a newly seeded workspace has no completed project status at all")
	}
}

// The workflow states a fresh workspace gets come from the same seed a fresh team gets, and
// the signup path is the one that produces most of them.
func TestCreateWorkspaceSeedsAGreenDone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	out, err := svc.CreateWorkspace(context.Background(), domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Third",
		URLKey:    "third-" + f.WorkspaceID.String(),
		UserName:  "Founder",
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	var found bool
	for _, st := range out.States {
		if st.Category != domain.CategoryCompleted {
			continue
		}
		found = true
		if !strings.EqualFold(st.Color, doneGreen) {
			t.Errorf("signup seeded %q as %s, want %s", st.Name, st.Color, doneGreen)
		}
	}
	if !found {
		t.Fatal("signup seeded no completed state at all")
	}
}
