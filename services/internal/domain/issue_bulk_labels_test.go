package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// addLabelIds and removeLabelIds were in the schema and on the generated input from the day
// the multi-select shipped, and no code read them: the resolver built the domain input from
// nine fields and dropped these two. A bulk label edit therefore returned success with the
// workspace version bumped and changed nothing at all — the worst shape a bug can take,
// because the client's optimistic state agreed with the answer.

// changesOfType is the label-side counterpart to issueChangesAfter.
func changesOfType(t *testing.T, db *store.DB, workspaceID uuid.UUID, after int64, entityType string) []store.ChangeLog {
	t.Helper()
	rows, err := db.Queries().ReadChangesSince(context.Background(), store.ReadChangesSinceParams{
		WorkspaceID: workspaceID, AfterVersion: after, ThroughVersion: 1 << 40, PageSize: 500,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	out := make([]store.ChangeLog, 0, len(rows))
	for _, r := range rows {
		if r.EntityType == entityType {
			out = append(out, r)
		}
	}
	return out
}

func labelIDsOn(t *testing.T, svc *domain.Service, p *testutil.Fixture, issueID uuid.UUID) map[uuid.UUID]bool {
	t.Helper()
	applied, err := svc.ListIssueLabels(context.Background(), p.Principal(), issueID)
	if err != nil {
		t.Fatalf("list labels on %s: %v", issueID, err)
	}
	out := map[uuid.UUID]bool{}
	for _, il := range applied {
		out[il.LabelID] = true
	}
	return out
}

func TestBulkUpdateIssues_AddsLabelsToEveryIssueInTheSelection(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})
	regression := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "regression"})

	ids := []uuid.UUID{
		f.NewIssue(t, "One"),
		f.NewIssue(t, "Two"),
		f.NewIssue(t, "Three"),
	}

	beforeVersion := workspaceVersion(t, db, f.WorkspaceID)

	_, skipped, version, err := svc.BulkUpdateIssues(ctx, p, domain.BulkUpdateIssuesInput{
		IDs:         ids,
		AddLabelIDs: []uuid.UUID{bug.ID, regression.ID},
	})
	if err != nil {
		t.Fatalf("bulk label add: %v", err)
	}
	if len(skipped) != 0 {
		t.Fatalf("nothing should have been skipped, got %+v", skipped)
	}
	if version <= beforeVersion {
		t.Fatalf("version did not advance: %d -> %d", beforeVersion, version)
	}

	// The whole point: the labels are on every issue, not on none of them.
	for _, id := range ids {
		on := labelIDsOn(t, svc, f, id)
		if !on[bug.ID] || !on[regression.ID] {
			t.Errorf("issue %s carries %d of the 2 labels the edit applied", id, len(on))
		}
	}

	// Six applications, six rows on the change stream — a client that never sees them
	// renders the labels until its next bootstrap and then watches them appear.
	labelChanges := changesOfType(t, db, f.WorkspaceID, beforeVersion, "issueLabel")
	if len(labelChanges) != 6 {
		t.Fatalf("expected 6 issueLabel change rows (3 issues x 2 labels), got %d", len(labelChanges))
	}
	for _, c := range labelChanges {
		if c.Op != "upsert" {
			t.Errorf("change %s is %q, want upsert", c.EntityID, c.Op)
		}
	}
}

func TestBulkUpdateIssues_RemovesLabelsFromEveryIssueInTheSelection(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})
	ids := []uuid.UUID{f.NewIssue(t, "One"), f.NewIssue(t, "Two")}

	if _, _, _, err := svc.BulkUpdateIssues(ctx, p, domain.BulkUpdateIssuesInput{
		IDs: ids, AddLabelIDs: []uuid.UUID{bug.ID},
	}); err != nil {
		t.Fatalf("seed the labels: %v", err)
	}

	beforeVersion := workspaceVersion(t, db, f.WorkspaceID)

	if _, _, _, err := svc.BulkUpdateIssues(ctx, p, domain.BulkUpdateIssuesInput{
		IDs: ids, RemoveLabelIDs: []uuid.UUID{bug.ID},
	}); err != nil {
		t.Fatalf("bulk label remove: %v", err)
	}

	for _, id := range ids {
		if labelIDsOn(t, svc, f, id)[bug.ID] {
			t.Errorf("issue %s still carries the label the edit removed", id)
		}
	}

	removals := changesOfType(t, db, f.WorkspaceID, beforeVersion, "issueLabel")
	if len(removals) != 2 {
		t.Fatalf("expected 2 issueLabel change rows, got %d", len(removals))
	}
	for _, c := range removals {
		if c.Op != "delete" {
			t.Errorf("change %s is %q, want delete", c.EntityID, c.Op)
		}
	}
}

// A label-only edit must not move the issue rows. updated_at is the sort key of My Issues
// and of every "recently updated" view, so writing it would reorder somebody's screen for a
// change that did not touch the issue.
func TestBulkUpdateIssues_ALabelOnlyEditLeavesTheIssueRowAlone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})
	id := f.NewIssue(t, "One")

	before, err := svc.GetIssue(ctx, p, id)
	if err != nil {
		t.Fatalf("read the issue: %v", err)
	}
	beforeVersion := workspaceVersion(t, db, f.WorkspaceID)

	if _, _, _, err := svc.BulkUpdateIssues(ctx, p, domain.BulkUpdateIssuesInput{
		IDs: []uuid.UUID{id}, AddLabelIDs: []uuid.UUID{bug.ID},
	}); err != nil {
		t.Fatalf("bulk label add: %v", err)
	}

	after, err := svc.GetIssue(ctx, p, id)
	if err != nil {
		t.Fatalf("read the issue back: %v", err)
	}
	if !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Errorf("a label-only edit moved updated_at from %s to %s", before.UpdatedAt, after.UpdatedAt)
	}
	if got := issueChangesAfter(t, db, f.WorkspaceID, beforeVersion); len(got) != 0 {
		t.Errorf("a label-only edit emitted %d issue change rows; nothing on the row changed", len(got))
	}
}

// Labels ride along with a property change in one version block, which is the whole reason
// the bulk path exists.
func TestBulkUpdateIssues_AppliesLabelsAndPropertiesInOneCall(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})
	ids := []uuid.UUID{f.NewIssue(t, "One"), f.NewIssue(t, "Two")}

	issues, _, _, err := svc.BulkUpdateIssues(ctx, p, domain.BulkUpdateIssuesInput{
		IDs:         ids,
		StateID:     &f.InProgress,
		AddLabelIDs: []uuid.UUID{bug.ID},
	})
	if err != nil {
		t.Fatalf("bulk update: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues back, got %d", len(issues))
	}
	for _, issue := range issues {
		if issue.StateID != f.InProgress {
			t.Errorf("issue %s was not moved", issue.ID)
		}
		if !labelIDsOn(t, svc, f, issue.ID)[bug.ID] {
			t.Errorf("issue %s did not get the label", issue.ID)
		}
	}
}

func TestBulkUpdateIssues_RefusesAddingAndRemovingTheSameLabel(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})

	_, _, _, err := svc.BulkUpdateIssues(context.Background(), p, domain.BulkUpdateIssuesInput{
		IDs:            []uuid.UUID{f.NewIssue(t, "One")},
		AddLabelIDs:    []uuid.UUID{bug.ID},
		RemoveLabelIDs: []uuid.UUID{bug.ID},
	})
	if err == nil {
		t.Fatal("adding and removing the same label in one call was accepted")
	}
	if got := platform.CodeOf(err); got != platform.CodeValidation {
		t.Fatalf("code = %s, want VALIDATION (%v)", got, err)
	}
}

func TestBulkUpdateIssues_RefusesALabelThatDoesNotExist(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	_, _, _, err := svc.BulkUpdateIssues(context.Background(), f.Principal(), domain.BulkUpdateIssuesInput{
		IDs:         []uuid.UUID{f.NewIssue(t, "One")},
		AddLabelIDs: []uuid.UUID{uuid.New()},
	})
	if err == nil {
		t.Fatal("a label that does not exist was accepted")
	}
	if got := platform.CodeOf(err); got != platform.CodeValidation {
		t.Fatalf("code = %s, want VALIDATION (%v)", got, err)
	}
	if !strings.Contains(err.Error(), "label") {
		t.Fatalf("the message does not name the problem: %v", err)
	}
}

// Labels alone are a change, so the "nothing to change" guard must not refuse them — it
// used to, silently, by not knowing about them at all.
func TestBulkUpdateIssues_LabelsAloneAreAChange(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})

	if _, _, _, err := svc.BulkUpdateIssues(context.Background(), p, domain.BulkUpdateIssuesInput{
		IDs:         []uuid.UUID{f.NewIssue(t, "One")},
		AddLabelIDs: []uuid.UUID{bug.ID},
	}); err != nil {
		t.Fatalf("a labels-only bulk edit was refused: %v", err)
	}
}
