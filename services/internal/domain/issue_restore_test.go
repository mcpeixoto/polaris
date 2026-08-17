package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 5 in docs/07-milestones/01-milestone-1.md:
//
//	Deleting an issue and undoing within the window restores it, its comments and its
//	relations.
//
// Only this level can prove it. The criterion is a statement about what survives a
// round trip through the database, and the client cannot make it: its replica cascades a
// deleted issue's children away locally, so a client-side test would prove that the store
// forgot them, not that the server still holds them.
//
// The comments half was already covered by TestRestoreIssue_BringsBackTheIssueWithItsComments
// in issue_bulk_test.go. The relations half was covered by nothing — no test in the
// repository created a relation and then deleted the issue holding it — which matters more
// than it first appears, because relations are the one child the schema could plausibly
// take away. `comment` carries its own `deleted_at` and is obviously untouched by a soft
// delete; `issue_relation` has no `deleted_at` at all and two `ON DELETE CASCADE` foreign
// keys pointing at `issue(id)`. Whether those cascades fire is the whole question, and the
// answer — that a soft delete is an UPDATE and never triggers them — is exactly the kind of
// fact that stays true until somebody makes the purge job real and reaches for the wrong
// verb.
func TestRestoreIssue_BringsBackItsRelationsAsWellAsItsComments(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	subject := f.NewIssue(t, "The one that gets deleted")
	blocked := f.NewIssue(t, "Waits on the subject")
	sibling := f.NewIssue(t, "Merely related")
	// Cross-team, because a relation that spans teams is emitted with a project scope
	// rather than a team one, and a restore that dropped it would take work off a second
	// team's board for a delete they never saw.
	_, farIssue := secondTeam(t, svc, p, "PLAT", "The far end")

	// One of every direction the listing can read a row from: forward, reverse, and the
	// symmetric type that is canonicalised smaller-id-first regardless of what was passed.
	if _, _, err := svc.CreateIssueRelation(ctx, p, subject, blocked, model.RelationBlocks); err != nil {
		t.Fatalf("create blocks relation: %v", err)
	}
	if _, _, err := svc.CreateIssueRelation(ctx, p, farIssue, subject, model.RelationBlocks); err != nil {
		t.Fatalf("create reverse blocks relation: %v", err)
	}
	if _, _, err := svc.CreateIssueRelation(ctx, p, subject, sibling, model.RelationRelated); err != nil {
		t.Fatalf("create related relation: %v", err)
	}

	for _, body := range []string{"This is wrong", "Agreed, reopening"} {
		if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
			IssueID: subject, Body: body,
		}); err != nil {
			t.Fatalf("create comment: %v", err)
		}
	}

	// What the issue held before any of it was deleted, so the assertions below compare
	// against the real shape rather than against a number written by hand.
	forwardBefore, err := svc.ListIssueRelations(ctx, p, subject)
	if err != nil {
		t.Fatalf("list relations before: %v", err)
	}
	if len(forwardBefore) != 2 {
		t.Fatalf("setup holds %d forward relations, want 2", len(forwardBefore))
	}
	reverseBefore, err := svc.ListIssuesBlocking(ctx, p, subject)
	if err != nil {
		t.Fatalf("list reverse relations before: %v", err)
	}
	if len(reverseBefore) != 1 {
		t.Fatalf("setup holds %d reverse relations, want 1", len(reverseBefore))
	}

	if _, err := svc.DeleteIssue(ctx, p, subject); err != nil {
		t.Fatalf("delete issue: %v", err)
	}

	restored, _, err := svc.RestoreIssue(ctx, p, subject)
	if err != nil {
		t.Fatalf("restore issue: %v", err)
	}
	if restored.ID != subject {
		t.Fatalf("restore returned %s, want %s", restored.ID, subject)
	}

	// The criterion's three clauses, one at a time.
	comments, err := svc.ListComments(ctx, p, subject)
	if err != nil {
		t.Fatalf("list comments after restore: %v", err)
	}
	if len(comments) != 2 {
		t.Errorf("the discussion did not come back: %d comments, want 2", len(comments))
	}

	forwardAfter, err := svc.ListIssueRelations(ctx, p, subject)
	if err != nil {
		t.Fatalf("list relations after restore: %v", err)
	}
	if !sameRelationIDs(forwardBefore, forwardAfter) {
		t.Errorf("the issue's own relations did not come back: had %v, now %v",
			relationIDsOf(forwardBefore), relationIDsOf(forwardAfter))
	}

	reverseAfter, err := svc.ListIssuesBlocking(ctx, p, subject)
	if err != nil {
		t.Fatalf("list reverse relations after restore: %v", err)
	}
	if !sameRelationIDs(reverseBefore, reverseAfter) {
		t.Errorf("the relation pointing at the issue from another team did not come back: "+
			"had %v, now %v", relationIDsOf(reverseBefore), relationIDsOf(reverseAfter))
	}

	// And the far end can still see it. A row that survives but is unreadable from the
	// other side is the same outage for the team that was waiting on the work.
	farSide, err := svc.ListIssueRelations(ctx, p, farIssue)
	if err != nil {
		t.Fatalf("list far-side relations: %v", err)
	}
	if len(farSide) != 1 {
		t.Errorf("the far team sees %d relations after the restore, want 1", len(farSide))
	}
}

// The window is the other half of "undoing within the window", and nothing exercised its
// far side: every restore test in the suite deletes and restores in the same millisecond,
// so a cutoff of zero — or of a hundred years — would pass all of them identically.
//
// The boundary is reached by ageing `deleted_at` directly rather than by waiting, which is
// the only way to test a thirty-day rule in a test suite that has to finish.
func TestRestoreIssue_RefusesOnceTheWindowHasPassed(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue := f.NewIssue(t, "Deleted a long time ago")
	if _, err := svc.DeleteIssue(ctx, p, issue); err != nil {
		t.Fatalf("delete issue: %v", err)
	}

	// Just inside the window first, so the test proves the cutoff is a boundary rather
	// than proving that restore fails whenever the timestamp is not now.
	ageDeletion(t, f, issue, domain.IssueRestoreWindow-time.Hour)
	if _, _, err := svc.RestoreIssue(ctx, p, issue); err != nil {
		t.Fatalf("restore one hour inside the %s window was refused: %v",
			domain.IssueRestoreWindow, err)
	}

	if _, err := svc.DeleteIssue(ctx, p, issue); err != nil {
		t.Fatalf("re-delete issue: %v", err)
	}
	ageDeletion(t, f, issue, domain.IssueRestoreWindow+time.Hour)

	if _, _, err := svc.RestoreIssue(ctx, p, issue); err == nil {
		t.Errorf("an issue deleted %s ago was restored; the window is %s and past it the "+
			"issue is only recoverable from a backup",
			domain.IssueRestoreWindow+time.Hour, domain.IssueRestoreWindow)
	}
}

// ageDeletion backdates an issue's deleted_at by the given duration.
func ageDeletion(t *testing.T, f *testutil.Fixture, issueID uuid.UUID, by time.Duration) {
	t.Helper()
	tag, err := f.DB.Pool().Exec(context.Background(),
		`UPDATE issue SET deleted_at = now() - $2::interval WHERE id = $1`,
		issueID, by.String())
	if err != nil {
		t.Fatalf("age deletion: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("ageing deleted_at touched %d rows, want 1", tag.RowsAffected())
	}
}

func relationIDsOf(rows []model.IssueRelation) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ID)
	}
	return out
}

// sameRelationIDs compares as a set: the listing's order is not part of the criterion, and
// asserting it would make an ORDER BY change look like data loss.
func sameRelationIDs(before, after []model.IssueRelation) bool {
	if len(before) != len(after) {
		return false
	}
	seen := make(map[uuid.UUID]bool, len(after))
	for _, r := range after {
		seen[r.ID] = true
	}
	for _, r := range before {
		if !seen[r.ID] {
			return false
		}
	}
	return true
}
