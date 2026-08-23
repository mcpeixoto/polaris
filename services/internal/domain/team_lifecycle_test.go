package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestRetireTeam_BlocksWritesAndUnretires(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	team, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "LEG", Name: "Legacy"})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}

	retired, _, err := svc.RetireTeam(ctx, p, team.ID)
	if err != nil {
		t.Fatalf("retire: %v", err)
	}
	if retired.RetiredAt == nil {
		t.Fatal("retiredAt not set")
	}

	renamed := "Renamed"
	if _, _, err := svc.UpdateTeam(ctx, p, domain.UpdateTeamInput{ID: team.ID, Name: &renamed}); err == nil {
		t.Fatal("update on retired team should fail")
	} else if platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("update code = %s, want CONFLICT (%v)", platform.CodeOf(err), err)
	}

	active, _, err := svc.UnretireTeam(ctx, p, team.ID)
	if err != nil {
		t.Fatalf("unretire: %v", err)
	}
	if active.RetiredAt != nil {
		t.Fatal("retiredAt should be cleared")
	}

	again := "Renamed"
	if _, _, err := svc.UpdateTeam(ctx, p, domain.UpdateTeamInput{ID: team.ID, Name: &again}); err != nil {
		t.Fatalf("update after unretire: %v", err)
	}
}

func TestDeleteTeam_RestoresInsideTheWindow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	team, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "TMP", Name: "Temporary"})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: team.ID, Title: "Gone soon"})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	if _, err := svc.DeleteTeam(ctx, p, team.ID); err != nil {
		t.Fatalf("delete team: %v", err)
	}
	if _, err := db.Queries().GetTeam(ctx, team.ID); err == nil {
		t.Fatal("deleted team should not be readable via GetTeam")
	}

	restored, _, err := svc.RestoreTeam(ctx, p, team.ID)
	if err != nil {
		t.Fatalf("restore team: %v", err)
	}
	if restored.Key != "TMP" {
		t.Fatalf("restored key = %q, want TMP", restored.Key)
	}

	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("restored issue: %v", err)
	}
	if got.Title != "Gone soon" {
		t.Fatalf("issue title = %q", got.Title)
	}
}

func TestDeleteTeam_RefusesWithChildTeams(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "PAR", Name: "Parent"})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	child, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "SUB", Name: "Sub"})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `UPDATE team SET parent_team_id = $1 WHERE id = $2`, parent.ID, child.ID); err != nil {
		t.Fatalf("link child: %v", err)
	}

	if _, err := svc.DeleteTeam(ctx, p, parent.ID); err == nil {
		t.Fatal("delete with child should fail")
	} else if platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("code = %s, want CONFLICT (%v)", platform.CodeOf(err), err)
	}
}

func TestUpdateProject_ReadOnlyWhenOnlyRetiredTeamsLinked(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	team, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "RTD", Name: "Retired team"})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Frozen", TeamIDs: []uuid.UUID{team.ID},
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if _, _, err := svc.RetireTeam(ctx, p, team.ID); err != nil {
		t.Fatalf("retire: %v", err)
	}

	failName := "Should fail"
	if _, _, err := svc.UpdateProject(ctx, p, domain.UpdateProjectInput{
		ID: project.ID, Name: &failName,
	}); err == nil {
		t.Fatal("update should fail when only retired teams are linked")
	} else if platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("code = %s, want CONFLICT (%v)", platform.CodeOf(err), err)
	}
}

func TestListDeletedTeams_ScopedToOwners(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	owned, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{Key: "OWN", Name: "Owned"})
	if err != nil {
		t.Fatalf("create owned: %v", err)
	}
	other, _, err := svc.CreateTeam(ctx, admin, domain.CreateTeamInput{Key: "OTH", Name: "Other"})
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	member := f.NewUser(t, "member", "member", true)
	memberP := f.PrincipalFor(member, authz.RoleMember, f.TeamID)

	if _, err := svc.DeleteTeam(ctx, admin, owned.ID); err != nil {
		t.Fatalf("delete owned: %v", err)
	}
	if _, err := svc.DeleteTeam(ctx, admin, other.ID); err != nil {
		t.Fatalf("delete other: %v", err)
	}

	adminList, err := svc.ListDeletedTeams(ctx, admin)
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if len(adminList) != 2 {
		t.Fatalf("admin sees %d deleted teams, want 2", len(adminList))
	}

	memberList, err := svc.ListDeletedTeams(ctx, memberP)
	if err != nil {
		t.Fatalf("member list: %v", err)
	}
	if len(memberList) != 0 {
		t.Fatalf("non-owner member sees %d deleted teams, want 0", len(memberList))
	}
}

// Deleting a team frees its key, because the uniqueness index skips deleted rows. A
// workspace that then spends the key has to be told what stands in the way of the restore,
// rather than being handed the word "internal error" on the recently-deleted screen.
func TestRestoreTeam_RefusesWhenTheKeyWasTakenAgain(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	team, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "TMP", Name: "Temporary"})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}
	if _, err := svc.DeleteTeam(ctx, p, team.ID); err != nil {
		t.Fatalf("delete team: %v", err)
	}

	successor, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "TMP", Name: "Temporary II"})
	if err != nil {
		t.Fatalf("the key should be free once the team holding it is deleted: %v", err)
	}

	_, _, err = svc.RestoreTeam(ctx, p, team.ID)
	if err == nil {
		t.Fatal("restore into a key another team holds should fail")
	}
	if platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("restore code = %s, want CONFLICT (%v)", platform.CodeOf(err), err)
	}
	if !strings.Contains(err.Error(), "key") {
		t.Fatalf("refusal should name the key: %q", err.Error())
	}

	// Freeing the key again makes the restore work, which is the advice the message gives.
	freed := "FREE"
	if _, _, err := svc.UpdateTeam(ctx, p, domain.UpdateTeamInput{ID: successor.ID, Key: &freed}); err != nil {
		t.Fatalf("rename successor: %v", err)
	}
	restored, _, err := svc.RestoreTeam(ctx, p, team.ID)
	if err != nil {
		t.Fatalf("restore after the key was freed: %v", err)
	}
	if restored.Key != "TMP" {
		t.Fatalf("restored key = %q, want TMP", restored.Key)
	}
}
