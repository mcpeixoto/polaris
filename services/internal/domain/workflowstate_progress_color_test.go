package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Written out, not read back from the seed. A test that imports the constant it checks
// passes whatever that constant was last edited to.
const (
	inProgressBlue = "#56b6d8"
	inReviewYellow = "#f2c94c"
)

// In Progress and In Review are both started, so the menu can only tell them apart by the
// colour stored on the row. In Progress is the light blue; In Review keeps the amber.
func TestSeededInProgressIsLightBlueAndInReviewIsYellow(t *testing.T) {
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

	rows, err := db.Pool().Query(ctx,
		`SELECT name, color, category FROM workflow_state
		  WHERE team_id = $1 AND name IN ('In Progress', 'In Review')
		  ORDER BY position`,
		team.ID)
	if err != nil {
		t.Fatalf("query states: %v", err)
	}
	defer rows.Close()

	got := map[string]struct{ color, category string }{}
	var order []string
	for rows.Next() {
		var name, color, category string
		if err := rows.Scan(&name, &color, &category); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got[name] = struct{ color, category string }{color, category}
		order = append(order, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}

	progress, ok := got["In Progress"]
	if !ok {
		t.Fatal("a newly seeded team has no In Progress state")
	}
	if !strings.EqualFold(progress.color, inProgressBlue) || progress.category != domain.CategoryStarted {
		t.Errorf("In Progress is %s/%s, want %s/started", progress.color, progress.category, inProgressBlue)
	}
	review, ok := got["In Review"]
	if !ok {
		t.Fatal("a newly seeded team has no In Review state")
	}
	if !strings.EqualFold(review.color, inReviewYellow) || review.category != domain.CategoryStarted {
		t.Errorf("In Review is %s/%s, want %s/started", review.color, review.category, inReviewYellow)
	}
	if len(order) != 2 || order[0] != "In Progress" || order[1] != "In Review" {
		t.Errorf("order = %v, want In Progress then In Review", order)
	}
}

// A project's In Progress draws the same pie as an issue's. Two blues that are not the
// same blue is the bug this is here to catch.
func TestSeededProjectInProgressIsLightBlue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	out, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID: f.AccountID,
		Name:      "Colours",
		URLKey:    "colours-" + f.WorkspaceID.String(),
		UserName:  "Founder",
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	var color string
	err = db.Pool().QueryRow(ctx,
		`SELECT color FROM project_status
		  WHERE workspace_id = $1 AND name = 'In Progress'`,
		out.Workspace.ID).Scan(&color)
	if err != nil {
		t.Fatalf("query project status: %v", err)
	}
	if !strings.EqualFold(color, inProgressBlue) {
		t.Errorf("project In Progress is %s, want %s", color, inProgressBlue)
	}
}
