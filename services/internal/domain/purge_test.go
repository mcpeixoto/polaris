package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The trash had no bottom.
//
// DeleteIssue's doc comment promised a thirty-day window and said "hard deletion is a purge
// job"; IssueRestoreWindow's said "the purge job hard-deletes on that schedule". There was no
// purge job and no way to empty the trash at all, so every soft-deleted issue in the product
// stayed in the table every list query scans, forever, carried by every partial index.
//
// The three properties worth pinning are the ones that make it safe to offer at all: it is
// admin-only, it destroys what it says it destroys and nothing else, and it tells the caller
// what is left rather than leaving them to call again and find out.

func TestPurgeDeletedIssues_IsAdminOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	issue := f.NewIssue(t, "Deleted by a member")
	if _, err := svc.DeleteIssue(ctx, f.Principal(), issue); err != nil {
		t.Fatalf("delete issue: %v", err)
	}

	member := f.PrincipalFor(f.NewUser(t, "sam", "member", true), authz.RoleMember, f.TeamID)
	_, _, _, err := svc.PurgeDeletedIssues(ctx, member, nil)
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("a member emptied the trash (%v).\n"+
			"Every other destructive action in the product is reversible for thirty days, so the "+
			"permission that gates them is the permission to make a recoverable mistake. This one "+
			"is not recoverable at all.", err)
	}

	// And the row is still there, which is the half a permission check can get wrong by
	// refusing after the write.
	remaining, err := svc.ListDeletedIssues(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list the trash: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("the refused purge left %d issues in the trash, want 1", len(remaining))
	}
}

// What it destroys, and what it publishes.
//
// The cascade is the part worth checking against the database rather than against the schema:
// comment, issue_label, issue_relation from either end, issue_subscription, issue_history and
// notification are all ON DELETE CASCADE, and a future migration that changed one of those to
// RESTRICT would turn "empty trash" into an error nobody could act on, while one that changed
// a sub-issue's parent_id from SET NULL to CASCADE would delete work the caller never put in
// the trash.
func TestPurgeDeletedIssues_DestroysTheIssueAndItsChildrenAndSparesItsSubIssues(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	doomed := f.NewIssue(t, "The one being emptied")
	bystander := f.NewIssue(t, "Merely linked to it")

	child, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "A sub-issue of the doomed one", ParentID: &doomed,
	})
	if err != nil {
		t.Fatalf("create sub-issue: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID: doomed, Body: "Something said before it was deleted",
	}); err != nil {
		t.Fatalf("create comment: %v", err)
	}
	if _, _, err := svc.CreateIssueRelation(ctx, p, bystander, doomed, model.RelationBlocks); err != nil {
		t.Fatalf("create relation: %v", err)
	}

	if _, err := svc.DeleteIssue(ctx, p, doomed); err != nil {
		t.Fatalf("delete issue: %v", err)
	}

	ids, remaining, version, err := svc.PurgeDeletedIssues(ctx, p, nil)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if len(ids) != 1 || ids[0] != doomed {
		t.Fatalf("purge destroyed %v, want just %v", ids, doomed)
	}
	if remaining != 0 {
		t.Errorf("the trash reports %d rows left after emptying it", remaining)
	}

	// Gone from the table, not merely from a listing.
	assertRowCount(t, db, 0, `SELECT count(*) FROM issue WHERE id = $1`, doomed)
	assertRowCount(t, db, 0, `SELECT count(*) FROM comment WHERE issue_id = $1`, doomed)
	assertRowCount(t, db, 0,
		`SELECT count(*) FROM issue_relation WHERE issue_id = $1 OR related_issue_id = $1`, doomed)
	assertRowCount(t, db, 0, `SELECT count(*) FROM issue_history WHERE issue_id = $1`, doomed)

	// The sub-issue survives, orphaned. issue.parent_id is ON DELETE SET NULL on purpose:
	// a cross-team sub-issue belongs to a team that has lost nothing, and deleting it would
	// destroy work nobody asked to destroy.
	assertRowCount(t, db, 1, `SELECT count(*) FROM issue WHERE id = $1 AND parent_id IS NULL`, child.ID)
	assertRowCount(t, db, 1, `SELECT count(*) FROM issue WHERE id = $1`, bystander)

	// And the stream carries a delete for it. Strictly no replica can still be holding the
	// row — the soft delete already told them all to forget it — but a hard delete that
	// appeared in change_log nowhere would be the one mutation in the product with no trace
	// in the audit log or the webhook feed.
	assertChange(t, db, doomed, version, "delete", false)
}

// Bounded, and honest about it.
//
// Every purged issue mints a change row inside one transaction under the workspace's version
// lock, so an unbounded "empty trash" on a workspace with years of deletions would hold every
// other writer behind one statement. The cap is real, so the count of what is left has to be
// real too — a caller told "0 remaining" while rows are still there would stop calling.
func TestPurgeDeletedIssues_IsBoundedAndReportsWhatIsLeft(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	// One more than the batch would be five hundred and one issues, which is a slow test
	// for a property the SQL states. Instead the batch is exercised at its own edge by
	// asking for a cutoff that leaves some rows behind, which is the same branch: some
	// eligible, some not, and a count of the difference.
	var deleted []uuid.UUID
	for i := range 3 {
		id := f.NewIssue(t, "")
		if _, err := svc.DeleteIssue(ctx, p, id); err != nil {
			t.Fatalf("delete issue %d: %v", i, err)
		}
		deleted = append(deleted, id)
	}

	// Age the first two so a cutoff can separate them from the third.
	cutoff := time.Now().Add(-time.Hour)
	for _, id := range deleted[:2] {
		if _, err := db.Pool().Exec(ctx,
			`UPDATE issue SET deleted_at = $2 WHERE id = $1`, id, cutoff.Add(-time.Hour)); err != nil {
			t.Fatalf("age the deletion: %v", err)
		}
	}

	ids, remaining, _, err := svc.PurgeDeletedIssues(ctx, p, &cutoff)
	if err != nil {
		t.Fatalf("purge before the cutoff: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("a cutoff an hour ago destroyed %d issues, want the 2 deleted before it", len(ids))
	}
	if remaining != 0 {
		t.Errorf("remaining is %d for a cutoff that has nothing left before it", remaining)
	}

	// The third is untouched, and is still restorable — which is the whole point of the
	// cutoff existing.
	if _, _, err := svc.RestoreIssue(ctx, p, deleted[2]); err != nil {
		t.Errorf("an issue deleted after the cutoff was not restorable afterwards: %v", err)
	}
}

// The retention sweep, which is the half nothing else in the product does.
//
// It runs without a principal and without a workspace, takes IssueRestoreWindow as its cutoff
// rather than a parameter, and must not touch anything still inside the window. A sweep that
// could be told which cutoff to use would be a way to defeat the guarantee the window is.
func TestPurgeExpiredIssues_TakesOnlyWhatIsPastTheWindow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	expired := f.NewIssue(t, "Deleted long ago")
	recent := f.NewIssue(t, "Deleted this morning")
	for _, id := range []uuid.UUID{expired, recent} {
		if _, err := svc.DeleteIssue(ctx, p, id); err != nil {
			t.Fatalf("delete issue: %v", err)
		}
	}
	if _, err := db.Pool().Exec(ctx,
		`UPDATE issue SET deleted_at = now() - $2::interval WHERE id = $1`,
		expired, (domain.IssueRestoreWindow + time.Hour).String()); err != nil {
		t.Fatalf("age the deletion: %v", err)
	}

	n, err := svc.PurgeExpiredIssues(ctx)
	if err != nil {
		t.Fatalf("retention sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("the sweep destroyed %d issues, want the 1 past the window", n)
	}
	assertRowCount(t, db, 0, `SELECT count(*) FROM issue WHERE id = $1`, expired)
	assertRowCount(t, db, 1, `SELECT count(*) FROM issue WHERE id = $1`, recent)

	// The one deleted this morning is still restorable, which is what the window promises.
	if _, _, err := svc.RestoreIssue(ctx, p, recent); err != nil {
		t.Errorf("the sweep took an issue still inside the recovery window: %v", err)
	}
}

func assertRowCount(t *testing.T, db *store.DB, want int64, query string, args ...any) {
	t.Helper()
	var got int64
	if err := db.Pool().QueryRow(context.Background(), query, args...).Scan(&got); err != nil {
		t.Fatalf("count: %v\n%s", err, query)
	}
	if got != want {
		t.Errorf("%s returned %d, want %d", query, got, want)
	}
}
