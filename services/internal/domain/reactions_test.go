package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Feature 6.4's reactions. The properties that make this the smallest write in the product
// are the ones worth pinning: both directions are idempotent without a read, neither mints
// a version for a no-op, and you may only touch your own.

func seedComment(t *testing.T, svc *domain.Service, f *testutil.Fixture) uuid.UUID {
	t.Helper()
	comment, _, err := svc.CreateComment(context.Background(), f.Principal(), domain.CreateCommentInput{
		IssueID: f.NewIssue(t, "Something"), Body: "worth reacting to",
	})
	if err != nil {
		t.Fatalf("create the comment: %v", err)
	}
	return comment.ID
}

func TestAddReaction_WritesARowAndAChange(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	commentID := seedComment(t, svc, f)
	before := workspaceVersion(t, db, f.WorkspaceID)

	reaction, version, err := svc.AddReaction(ctx, p, commentID, "🎉")
	if err != nil {
		t.Fatalf("add the reaction: %v", err)
	}
	if reaction.Emoji != "🎉" || reaction.CommentID != commentID || reaction.UserID != p.UserID {
		t.Fatalf("reaction = %+v", reaction)
	}
	if version <= before {
		t.Fatalf("version did not advance: %d -> %d", before, version)
	}

	changes := changesOfType(t, db, f.WorkspaceID, before, "reaction")
	if len(changes) != 1 {
		t.Fatalf("expected 1 reaction change row, got %d", len(changes))
	}
	if changes[0].Op != "upsert" || changes[0].EntityID != reaction.ID {
		t.Fatalf("change = %+v, want an upsert of %s", changes[0], reaction.ID)
	}

	byComment, err := svc.ListReactionsForComments(ctx, p, []uuid.UUID{commentID})
	if err != nil {
		t.Fatalf("list reactions: %v", err)
	}
	if len(byComment[commentID]) != 1 {
		t.Fatalf("expected 1 reaction on the comment, got %d", len(byComment[commentID]))
	}
}

// The unique key IS the idempotency: a second tap on the same face, and a retried mutation,
// are the same statement and the same outcome. Neither may mint a version — there is no
// delta coming, so a client told to wait for one would wait for ever.
func TestAddReaction_TheSameEmojiTwiceIsANoOp(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	commentID := seedComment(t, svc, f)
	first, _, err := svc.AddReaction(ctx, p, commentID, "👍")
	if err != nil {
		t.Fatalf("first add: %v", err)
	}

	before := workspaceVersion(t, db, f.WorkspaceID)
	again, version, err := svc.AddReaction(ctx, p, commentID, "👍")
	if err != nil {
		t.Fatalf("second add: %v", err)
	}
	if again.ID != first.ID {
		t.Fatalf("the second add minted a new row %s, want the existing %s", again.ID, first.ID)
	}
	if version != 0 {
		t.Fatalf("version = %d, want 0 — nothing was written, so no delta is coming", version)
	}
	if got := workspaceVersion(t, db, f.WorkspaceID); got != before {
		t.Fatalf("the workspace advanced from %d to %d for a write that did nothing", before, got)
	}
}

func TestRemoveReaction_DeletesTheRowAndEmitsADelete(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	commentID := seedComment(t, svc, f)
	added, _, err := svc.AddReaction(ctx, p, commentID, "🚀")
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	before := workspaceVersion(t, db, f.WorkspaceID)
	removed, version, err := svc.RemoveReaction(ctx, p, commentID, "🚀")
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if removed != added.ID {
		t.Fatalf("removed %s, want %s", removed, added.ID)
	}
	if version <= before {
		t.Fatalf("version did not advance on the removal: %d -> %d", before, version)
	}

	changes := changesOfType(t, db, f.WorkspaceID, before, "reaction")
	if len(changes) != 1 || changes[0].Op != "delete" {
		t.Fatalf("changes = %+v, want one delete", changes)
	}

	byComment, err := svc.ListReactionsForComments(ctx, p, []uuid.UUID{commentID})
	if err != nil {
		t.Fatalf("list reactions: %v", err)
	}
	if len(byComment[commentID]) != 0 {
		t.Fatalf("the reaction survived the removal: %+v", byComment[commentID])
	}
}

// Removing something already gone is the outcome the caller asked for. A retried mutation
// must not fail, and there is nothing to emit.
func TestRemoveReaction_RemovingWhatIsNotThereSucceedsQuietly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	commentID := seedComment(t, svc, f)
	before := workspaceVersion(t, db, f.WorkspaceID)

	removed, version, err := svc.RemoveReaction(ctx, p, commentID, "🤷")
	if err != nil {
		t.Fatalf("removing a reaction that is not there failed: %v", err)
	}
	if removed != uuid.Nil {
		t.Fatalf("removed = %s, want the nil id", removed)
	}
	if version != 0 {
		t.Fatalf("version = %d, want 0", version)
	}
	if got := workspaceVersion(t, db, f.WorkspaceID); got != before {
		t.Fatalf("the workspace advanced from %d to %d for a removal that removed nothing", before, got)
	}
}

// A reaction is a signature. RemoveReaction is scoped to the caller's own row by the
// statement itself, so somebody else's reaction is simply not found — no admin override,
// because an admin who can delete the comment deletes the reactions with it.
func TestRemoveReaction_CannotRemoveSomebodyElses(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	other := f.NewUser(t, "Other", "member", true)
	otherP := f.PrincipalFor(other, p.Role, f.TeamID)

	commentID := seedComment(t, svc, f)
	theirs, _, err := svc.AddReaction(ctx, otherP, commentID, "❤️")
	if err != nil {
		t.Fatalf("their add: %v", err)
	}

	removed, version, err := svc.RemoveReaction(ctx, p, commentID, "❤️")
	if err != nil {
		t.Fatalf("removing somebody else's reaction should be a quiet no-op, got: %v", err)
	}
	if removed != uuid.Nil || version != 0 {
		t.Fatalf("removed = %s at version %d; somebody else's reaction was touched", removed, version)
	}

	byComment, err := svc.ListReactionsForComments(ctx, otherP, []uuid.UUID{commentID})
	if err != nil {
		t.Fatalf("list reactions: %v", err)
	}
	if len(byComment[commentID]) != 1 || byComment[commentID][0].ID != theirs.ID {
		t.Fatalf("their reaction did not survive: %+v", byComment[commentID])
	}
}

// Two people may react with the same emoji; the key is (comment, person, emoji).
func TestAddReaction_TwoPeopleMayUseTheSameEmoji(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	other := f.NewUser(t, "Other", "member", true)
	otherP := f.PrincipalFor(other, p.Role, f.TeamID)

	commentID := seedComment(t, svc, f)
	if _, _, err := svc.AddReaction(ctx, p, commentID, "🎉"); err != nil {
		t.Fatalf("first person: %v", err)
	}
	if _, _, err := svc.AddReaction(ctx, otherP, commentID, "🎉"); err != nil {
		t.Fatalf("second person: %v", err)
	}

	byComment, err := svc.ListReactionsForComments(ctx, p, []uuid.UUID{commentID})
	if err != nil {
		t.Fatalf("list reactions: %v", err)
	}
	if len(byComment[commentID]) != 2 {
		t.Fatalf("expected 2 reactions, got %d", len(byComment[commentID]))
	}
}

func TestAddReaction_RefusesSomethingThatIsNotAnEmoji(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	commentID := seedComment(t, svc, f)

	// Blank, a sentence, whitespace between two characters, and something far too long.
	for _, bad := range []string{"", "   ", "great work everyone", "🎉 🚀", strings.Repeat("a", 200)} {
		_, _, err := svc.AddReaction(ctx, p, commentID, bad)
		if err == nil {
			t.Errorf("%q was accepted as an emoji", bad)
			continue
		}
		if got := platform.CodeOf(err); got != platform.CodeValidation {
			t.Errorf("%q gave %s, want VALIDATION", bad, got)
		}
	}
}

func TestAddReaction_RefusesACommentTheCallerCannotSee(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	_, _, err := svc.AddReaction(context.Background(), f.Principal(), uuid.New(), "🎉")
	if err == nil {
		t.Fatal("reacting to a comment that does not exist was accepted")
	}
	// Not-found rather than forbidden, so the API is not an oracle for other teams' threads.
	if got := platform.CodeOf(err); got != platform.CodeNotFound {
		t.Fatalf("code = %s, want NOT_FOUND", got)
	}
}
