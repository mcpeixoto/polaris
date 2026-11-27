package domain_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A silent change is the same row as a loud one with one bit flipped, and the fan-out has to
// read that bit. The test replays one real assignment's change row twice — once silent, once
// not — so the only difference between the two passes is the flag itself. A test that
// compared two different mutations could pass because the mutations differed.
func TestFanOut_SilentChangeRowDeliversNothingWhileTheSameRowLoudDoes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Needs an owner"})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{ID: issue.ID, AssigneeID: &bobID}); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	before := notificationRowCount(t, db, f.WorkspaceID)
	if before == 0 {
		t.Fatal("the original assignment notified nobody, so this test cannot tell silence from a broken fan-out")
	}

	// The assignment's own row, as the emitter wrote it.
	var payload json.RawMessage
	var fields []string
	if err := db.Pool().QueryRow(ctx, `
		SELECT payload, changed_fields FROM change_log
		WHERE workspace_id = $1 AND entity_type = 'issue' AND entity_id = $2
		  AND cardinality(changed_fields) > 0
		ORDER BY version DESC LIMIT 1`, f.WorkspaceID, issue.ID,
	).Scan(&payload, &fields); err != nil {
		t.Fatalf("read the assignment's change row: %v", err)
	}
	replay := func(silent bool) int {
		t.Helper()
		if err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
			teamID := f.TeamID
			_, err := domain.Emitter{}.Emit(ctx, q, f.WorkspaceID, alice.Actor(), domain.Change{
				EntityType: "issue", EntityID: issue.ID, Op: domain.OpUpsert, TeamID: &teamID,
				Scope: authz.TeamScope(f.TeamID, false), Payload: payload, ChangedFields: fields,
				Silent: silent,
			})
			return err
		}); err != nil {
			t.Fatalf("emit: %v", err)
		}
		n, err := svc.FanOut(ctx, f.WorkspaceID)
		if err != nil {
			t.Fatalf("fan out: %v", err)
		}
		return n
	}

	if n := replay(true); n != 0 {
		t.Errorf("a silent copy of an assignment made %d deliveries, want 0", n)
	}
	if got := notificationRowCount(t, db, f.WorkspaceID); got != before {
		t.Errorf("a silent change moved the inbox from %d rows to %d", before, got)
	}
	if n := replay(false); n == 0 {
		t.Error("the same row, not silent, delivered nothing — the silent pass above proves nothing")
	}
}

// The writer's side: a mutation under WithImport writes silent rows and subscribes nobody,
// and the hub still has every one of them to stream.
func TestWithImport_WritesSilentRowsAndSubscribesNobody(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := domain.WithImport(context.Background())
	bobID := f.NewUser(t, "bob", "member", true)

	var after int64
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT version FROM workspace_version WHERE workspace_id = $1`, f.WorkspaceID,
	).Scan(&after); err != nil {
		t.Fatalf("read version: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Copied from elsewhere", AssigneeID: &bobID,
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, f.Principal(), domain.CreateCommentInput{
		IssueID: issue.ID, Body: "said months ago",
	}); err != nil {
		t.Fatalf("create comment: %v", err)
	}

	var silent, loud int
	if err := db.Pool().QueryRow(context.Background(), `
		SELECT count(*) FILTER (WHERE silent), count(*) FILTER (WHERE NOT silent)
		FROM change_log WHERE workspace_id = $1 AND version > $2`, f.WorkspaceID, after,
	).Scan(&silent, &loud); err != nil {
		t.Fatalf("count change rows: %v", err)
	}
	if silent == 0 || loud != 0 {
		t.Errorf("an import wrote %d silent and %d loud change rows, want some and none", silent, loud)
	}

	rows, err := svc.ReadChanges(context.Background(), f.WorkspaceID, after, after+1000, 1000)
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	if len(rows) != silent {
		t.Errorf("the sync read path returned %d of the import's %d changes; silent must not mean unsynced",
			len(rows), silent)
	}

	var subs int
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT count(*) FROM issue_subscription WHERE issue_id = $1`, issue.ID,
	).Scan(&subs); err != nil {
		t.Fatalf("count subscriptions: %v", err)
	}
	if subs != 0 {
		t.Errorf("an imported issue has %d subscriptions, want 0", subs)
	}

	if _, err := svc.FanOut(context.Background(), f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	if n := notificationRowCount(t, db, f.WorkspaceID); n != 0 {
		t.Errorf("an import produced %d notification rows, want 0", n)
	}
}
