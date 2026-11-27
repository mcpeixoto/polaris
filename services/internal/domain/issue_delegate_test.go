package domain_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestUpdateIssue_RejectsAHumanDelegate(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	human := f.NewUser(t, "Casey", "member", true)
	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Owned by a person", AssigneeID: &f.UserID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, _, err = svc.UpdateIssue(ctx, f.Principal(), domain.UpdateIssueInput{
		ID: issue.ID, DelegateID: &human,
	})
	if platform.CodeOf(err) != platform.CodeValidation || !strings.Contains(err.Error(), "delegate must be an agent") {
		t.Fatalf("delegating to a person: %v, want a validation error that a delegate must be an agent", err)
	}

	got, err := db.Queries().GetIssue(ctx, issue.ID)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if got.DelegateID != nil {
		t.Fatalf("delegate = %v, want none after the rejection", got.DelegateID)
	}
	if got.AssigneeID == nil || *got.AssigneeID != f.UserID {
		t.Fatalf("assignee = %v, want the owner left in place", got.AssigneeID)
	}
}

func TestUpdateIssue_DelegatingToAnAppUserQueuesARunAndKeepsTheAssignee(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	agent := newAppUser(t, f, "Helper")
	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Needs a hand", AssigneeID: &f.UserID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Property changes in the first minutes after creation are folded into the creation
	// event and never written. The history assertion below is about a later edit.
	if _, err := db.Pool().Exec(ctx, `UPDATE issue SET created_at = now() - interval '1 hour' WHERE id = $1`, issue.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	before := time.Now()
	updated, _, err := svc.UpdateIssue(ctx, f.Principal(), domain.UpdateIssueInput{
		ID: issue.ID, DelegateID: &agent,
	})
	if err != nil {
		t.Fatalf("delegate: %v", err)
	}
	if updated.DelegateID == nil || *updated.DelegateID != agent {
		t.Fatalf("delegate = %v, want %s", updated.DelegateID, agent)
	}
	if updated.AssigneeID == nil || *updated.AssigneeID != f.UserID {
		t.Fatalf("assignee = %v, want the owner kept", updated.AssigneeID)
	}

	runs := listRuns(t, db, issue.ID)
	if len(runs) != 1 {
		t.Fatalf("runs = %d, want one queued delegation", len(runs))
	}
	if runs[0].Status != "queued" {
		t.Fatalf("run status = %q, want queued", runs[0].Status)
	}
	if runs[0].AgentUserID != agent {
		t.Fatalf("run agent = %s, want %s", runs[0].AgentUserID, agent)
	}
	want := before.Add(domain.DelegationDelay)
	if d := runs[0].RunAfter.Sub(want); d < -5*time.Second || d > 5*time.Second {
		t.Fatalf("run_after = %s, want within 5s of %s (delta %s)", runs[0].RunAfter, want, d)
	}

	if !changeNamesDelegate(t, db, issue.ID) {
		t.Fatal("changed_fields does not contain delegate_id")
	}

	history, err := svc.ListIssueHistory(ctx, f.Principal(), issue.ID)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	var saw bool
	for _, entry := range history {
		if entry.Kind == "delegate" {
			saw = true
		}
	}
	if !saw {
		t.Fatalf("history kinds = %v, want a delegate entry", kindsOf(history))
	}
}

func TestUpdateIssue_RedelegatingCancelsTheOpenRunAndQueuesAnother(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	first := newAppUser(t, f, "First")
	second := newAppUser(t, f, "Second")
	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Passed along", DelegateID: &first,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, _, err := svc.UpdateIssue(ctx, f.Principal(), domain.UpdateIssueInput{
		ID: issue.ID, DelegateID: &second,
	}); err != nil {
		t.Fatalf("re-delegate: %v", err)
	}

	runs := listRuns(t, db, issue.ID)
	var queued, cancelled int
	for _, run := range runs {
		switch run.Status {
		case "queued":
			queued++
			if run.AgentUserID != second {
				t.Fatalf("queued run is for %s, want %s", run.AgentUserID, second)
			}
		case "cancelled":
			cancelled++
			if run.AgentUserID != first {
				t.Fatalf("cancelled run is for %s, want the previous delegate %s", run.AgentUserID, first)
			}
		default:
			t.Fatalf("unexpected run status %q", run.Status)
		}
	}
	if queued != 1 || cancelled != 1 {
		t.Fatalf("queued = %d, cancelled = %d, want one of each", queued, cancelled)
	}
}

func TestUpdateIssue_ClearDelegateCancelsAndQueuesNothing(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	agent := newAppUser(t, f, "Helper")
	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Stop", DelegateID: &agent,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	updated, _, err := svc.UpdateIssue(ctx, f.Principal(), domain.UpdateIssueInput{
		ID: issue.ID, ClearDelegate: true,
	})
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if updated.DelegateID != nil {
		t.Fatalf("delegate = %v, want cleared", updated.DelegateID)
	}

	runs := listRuns(t, db, issue.ID)
	if len(runs) != 1 {
		t.Fatalf("runs = %d, want the original one, cancelled", len(runs))
	}
	if runs[0].Status != "cancelled" {
		t.Fatalf("run status = %q, want cancelled", runs[0].Status)
	}
}

func TestBulkUpdateIssues_DelegatesEverySelectedIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	agent := newAppUser(t, f, "Helper")
	var ids []uuid.UUID
	for _, title := range []string{"One", "Two"} {
		issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
			TeamID: f.TeamID, Title: title, AssigneeID: &f.UserID,
		})
		if err != nil {
			t.Fatalf("create %s: %v", title, err)
		}
		ids = append(ids, issue.ID)
	}

	updated, skipped, _, err := svc.BulkUpdateIssues(ctx, f.Principal(), domain.BulkUpdateIssuesInput{
		IDs: ids, DelegateID: &agent,
	})
	if err != nil {
		t.Fatalf("bulk delegate: %v", err)
	}
	if len(skipped) != 0 {
		t.Fatalf("skipped = %+v, want none", skipped)
	}
	if len(updated) != 2 {
		t.Fatalf("updated = %d, want 2", len(updated))
	}
	for _, issue := range updated {
		if issue.DelegateID == nil || *issue.DelegateID != agent {
			t.Fatalf("%s delegate = %v, want %s", issue.Title, issue.DelegateID, agent)
		}
		if issue.AssigneeID == nil || *issue.AssigneeID != f.UserID {
			t.Fatalf("%s assignee = %v, want the owner kept", issue.Title, issue.AssigneeID)
		}
		runs := listRuns(t, db, issue.ID)
		if len(runs) != 1 || runs[0].Status != "queued" || runs[0].AgentUserID != agent {
			t.Fatalf("%s runs = %+v, want one queued run for the agent", issue.Title, runs)
		}
	}
}

func newAppUser(t *testing.T, f *testutil.Fixture, name string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	err := f.DB.InTx(context.Background(), func(ctx context.Context, q *store.Queries) error {
		_, err := q.CreateUser(ctx, store.CreateUserParams{
			ID: id, WorkspaceID: f.WorkspaceID, Name: name, DisplayName: name,
			Timezone: "UTC", Role: "member", Kind: "app",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create app user: %v", err)
	}
	return id
}

func listRuns(t *testing.T, db *store.DB, issueID uuid.UUID) []store.AgentRun {
	t.Helper()
	runs, err := db.Queries().ListAgentRunsForIssue(context.Background(), issueID)
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	return runs
}

func changeNamesDelegate(t *testing.T, db *store.DB, issueID uuid.UUID) bool {
	t.Helper()
	var n int
	err := db.Pool().QueryRow(context.Background(), `
		SELECT count(*) FROM change_log
		WHERE entity_type = 'issue' AND entity_id = $1
		  AND 'delegate_id' = ANY(changed_fields)`, issueID).Scan(&n)
	if err != nil {
		t.Fatalf("read changed_fields: %v", err)
	}
	return n > 0
}

func kindsOf(entries []model.IssueHistoryEntry) []string {
	out := make([]string, len(entries))
	for i, entry := range entries {
		out[i] = entry.Kind
	}
	return out
}
