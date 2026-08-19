package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func enableTriage(t *testing.T, svc *domain.Service, p *authz.Principal, teamID uuid.UUID, requirePriority bool) {
	t.Helper()
	enabled := true
	team, _, err := svc.UpdateTeamTriage(context.Background(), p, domain.UpdateTeamTriageInput{
		TeamID:          teamID,
		Enabled:         &enabled,
		RequirePriority: &requirePriority,
	})
	if err != nil {
		t.Fatalf("enable triage: %v", err)
	}
	if !team.TriageEnabled {
		t.Fatal("triage stayed off")
	}
}

func stateByCategory(t *testing.T, svc *domain.Service, p *authz.Principal, teamID uuid.UUID, category string) uuid.UUID {
	t.Helper()
	states, err := svc.ListWorkflowStates(context.Background(), p, teamID)
	if err != nil {
		t.Fatalf("list states: %v", err)
	}
	for _, st := range states {
		if st.Category == category {
			return st.ID
		}
	}
	t.Fatalf("no %s status", category)
	return uuid.Nil
}

func TestUpdateTeamTriage_EnableCreatesTriageAndDuplicateStatuses(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)

	states, err := svc.ListWorkflowStates(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var triage, dup bool
	for _, st := range states {
		switch st.Category {
		case domain.CategoryTriage:
			triage = true
			if st.IsSystem {
				t.Fatal("triage is a status the team can rename, not a system row")
			}
		case domain.CategoryDuplicate:
			dup = true
			if !st.IsSystem {
				t.Fatal("duplicate must be the reserved system status")
			}
		}
	}
	if !triage || !dup {
		t.Fatalf("enable did not seed both statuses (triage=%v duplicate=%v)", triage, dup)
	}

	// Re-enable is a no-op on the statuses: the unique index forbids a second pair.
	enableTriage(t, svc, p, f.TeamID, true)
	again, err := svc.ListWorkflowStates(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list after re-enable: %v", err)
	}
	if len(again) != len(states) {
		t.Fatalf("re-enable created extra statuses: %d then %d", len(states), len(again))
	}
}

func TestUpdateTeamTriage_DisableLeavesStatuses(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)
	off := false
	team, _, err := svc.UpdateTeamTriage(ctx, p, domain.UpdateTeamTriageInput{
		TeamID: f.TeamID, Enabled: &off,
	})
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if team.TriageEnabled {
		t.Fatal("triage stayed on")
	}
	if stateByCategory(t, svc, p, f.TeamID, domain.CategoryTriage) == uuid.Nil {
		t.Fatal("disable deleted the triage status")
	}
}

func TestCreateIssue_OutsiderLandsInTriageWhenEnabled(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)
	triageID := stateByCategory(t, svc, p, f.TeamID, domain.CategoryTriage)

	// Visible on the public team (as ResolvePrincipal would be) but not a member.
	pat := f.NewUser(t, "pat", "member", false)
	outsider := f.PrincipalFor(pat, authz.RoleMember, f.TeamID)

	issue, _, err := svc.CreateIssue(ctx, outsider, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "From another team",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.StateID != triageID {
		t.Fatalf("state = %s, want triage %s", issue.StateID, triageID)
	}
}

func TestCreateIssue_FromTriageViewLandsInTriage(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)
	triageID := stateByCategory(t, svc, p, f.TeamID, domain.CategoryTriage)

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Filed in the inbox", FromTriage: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.StateID != triageID {
		t.Fatalf("state = %s, want triage %s", issue.StateID, triageID)
	}
}

func TestCreateIssue_MemberWithoutTriageFlagUsesDefault(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Normal work",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.StateID != f.Backlog {
		t.Fatalf("state = %s, want default backlog %s", issue.StateID, f.Backlog)
	}
}

func TestAcceptTriageIssue_MovesToDefaultAndRequiresPriority(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, true)
	filed, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Incoming", FromTriage: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, _, err := svc.AcceptTriageIssue(ctx, p, filed.ID); err == nil {
		t.Fatal("accepted an unprioritised issue while the team requires priority")
	}

	priority := 2
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: filed.ID, Priority: &priority}); err != nil {
		t.Fatalf("set priority: %v", err)
	}
	accepted, _, err := svc.AcceptTriageIssue(ctx, p, filed.ID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if accepted.StateID != f.Backlog {
		t.Fatalf("accepted into %s, want default %s", accepted.StateID, f.Backlog)
	}
	if accepted.SnoozedUntil != nil {
		t.Fatal("accept left a snooze standing")
	}
}

func TestDeclineTriageIssue_MovesToCanceled(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)
	filed, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Not for us", FromTriage: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	declined, _, err := svc.DeclineTriageIssue(ctx, p, filed.ID)
	if err != nil {
		t.Fatalf("decline: %v", err)
	}
	if declined.StateID != f.Canceled {
		t.Fatalf("declined into %s, want canceled %s", declined.StateID, f.Canceled)
	}
}

func TestMarkIssueDuplicate_SetsReservedStatusAndRelation(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)
	dupID := stateByCategory(t, svc, p, f.TeamID, domain.CategoryDuplicate)

	canonical, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The real one",
	})
	if err != nil {
		t.Fatalf("canonical: %v", err)
	}
	copy, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "A copy", FromTriage: true,
	})
	if err != nil {
		t.Fatalf("copy: %v", err)
	}

	marked, _, err := svc.MarkIssueDuplicate(ctx, p, copy.ID, canonical.ID)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	if marked.StateID != dupID {
		t.Fatalf("state = %s, want duplicate %s", marked.StateID, dupID)
	}

	rels, err := svc.ListIssueRelations(ctx, p, copy.ID)
	if err != nil {
		t.Fatalf("relations: %v", err)
	}
	if len(rels) != 1 || rels[0].Type != "duplicate" || rels[0].RelatedIssueID != canonical.ID {
		t.Fatalf("relation = %+v, want duplicate of %s", rels, canonical.ID)
	}
}

func TestSnoozeIssue_HidesUntilTimeOrActivity(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)
	filed, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Later", FromTriage: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	until := time.Now().Add(2 * time.Hour).UTC().Truncate(time.Second)
	snoozed, _, err := svc.SnoozeIssue(ctx, p, filed.ID, until)
	if err != nil {
		t.Fatalf("snooze: %v", err)
	}
	if snoozed.SnoozedUntil == nil || !snoozed.SnoozedUntil.Equal(until) {
		t.Fatalf("snoozedUntil = %v, want %s", snoozed.SnoozedUntil, until)
	}

	title := "Later, with a note"
	woken, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: filed.ID, Title: &title})
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if woken.SnoozedUntil != nil {
		t.Fatal("editing a snoozed issue left the snooze standing")
	}

	again, _, err := svc.SnoozeIssue(ctx, p, filed.ID, until)
	if err != nil {
		t.Fatalf("re-snooze: %v", err)
	}
	if again.SnoozedUntil == nil {
		t.Fatal("re-snooze did not stick")
	}
	if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID: filed.ID, Body: "new activity",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, filed.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.SnoozedUntil != nil {
		t.Fatal("a comment left the snooze standing")
	}
}

func TestUpdateIssue_LeavingTriageRequiresPriority(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, true)
	filed, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Needs a number", FromTriage: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: filed.ID, StateID: &f.Todo}); err == nil {
		t.Fatal("left triage without a priority")
	}
}
