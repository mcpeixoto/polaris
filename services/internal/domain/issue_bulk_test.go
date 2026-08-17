package domain_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The reason bulk edit exists at all. Three issues, one transaction, one block of versions:
// if this ever becomes three calls to UpdateIssue it will still pass every functional test
// in the suite while taking the workspace version lock three times and waking every client
// three times, and nothing else in the codebase would notice.
func TestBulkUpdateIssues_ThreeIssuesMintOneVersionBlock(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	ids := []uuid.UUID{
		f.NewIssue(t, "One"),
		f.NewIssue(t, "Two"),
		f.NewIssue(t, "Three"),
	}

	beforeVersion := workspaceVersion(t, db, f.WorkspaceID)

	issues, skipped, version, err := svc.BulkUpdateIssues(ctx, p, domain.BulkUpdateIssuesInput{
		IDs:     ids,
		StateID: &f.InProgress,
	})
	if err != nil {
		t.Fatalf("bulk update: %v", err)
	}
	if len(issues) != 3 {
		t.Fatalf("expected 3 issues back, got %d", len(issues))
	}
	if len(skipped) != 0 {
		t.Fatalf("nothing should have been skipped, got %+v", skipped)
	}

	// Three changes, three consecutive versions, one bump. The block is contiguous because
	// Emit reserved it in one statement — which is exactly what one call to Emit buys and
	// three calls do not.
	if got, want := version-beforeVersion, int64(len(ids)); got != want {
		t.Fatalf("the batch advanced the workspace by %d versions, want %d", got, want)
	}

	changes := issueChangesAfter(t, db, f.WorkspaceID, beforeVersion)
	if len(changes) != 3 {
		t.Fatalf("expected 3 issue change rows, got %d", len(changes))
	}
	for i, c := range changes {
		if want := beforeVersion + int64(i) + 1; c.Version != want {
			t.Fatalf("change %d is at version %d, want %d — the block is not contiguous",
				i, c.Version, want)
		}
	}

	// And the edit actually happened.
	for _, id := range ids {
		got, err := svc.GetIssue(ctx, p, id)
		if err != nil {
			t.Fatalf("read back %s: %v", id, err)
		}
		if got.StateID != f.InProgress {
			t.Errorf("issue %s was not moved", id)
		}
		if got.StartedAt == nil {
			t.Errorf("issue %s moved to a started status without a startedAt", id)
		}
	}
}

// A selection that includes something the caller cannot reach edits the rest and says which
// it did not. Failing the whole call would leave somebody who selected fifty issues with no
// way to find the two that stopped it except by bisecting their own selection.
func TestBulkUpdateIssues_SkipsAnUnreachableIssueRatherThanFailing(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	reachable := f.NewIssue(t, "In my team")
	_, unreachable := secondTeam(t, svc, admin, "SEC", "Somewhere I cannot go")

	// A member of the fixture's team only.
	outsider := f.PrincipalFor(f.NewUser(t, "outsider", "member", true), authz.RoleMember, f.TeamID)

	priority := 1
	issues, skipped, version, err := svc.BulkUpdateIssues(ctx, outsider, domain.BulkUpdateIssuesInput{
		IDs:      []uuid.UUID{reachable, unreachable},
		Priority: &priority,
	})
	if err != nil {
		t.Fatalf("a partially reachable selection must not fail the call: %v", err)
	}
	if len(issues) != 1 || issues[0].ID != reachable {
		t.Fatalf("expected the reachable issue to be edited, got %+v", issues)
	}
	if version == 0 {
		t.Error("the edit that did happen must land on the sync stream")
	}

	if len(skipped) != 1 || skipped[0].ID != unreachable {
		t.Fatalf("expected exactly the unreachable issue to be skipped, got %+v", skipped)
	}
	if skipped[0].Reason == "" {
		t.Error("a skip without a reason is a silent failure with extra steps")
	}
	// The reason must not confirm the issue exists — it is the same string a genuinely
	// missing id gets.
	missing := uuid.Must(uuid.NewV7())
	_, skippedMissing, _, err := svc.BulkUpdateIssues(ctx, outsider, domain.BulkUpdateIssuesInput{
		IDs:      []uuid.UUID{reachable, missing},
		Priority: &priority,
	})
	if err != nil {
		t.Fatalf("bulk update with a missing id: %v", err)
	}
	if len(skippedMissing) != 1 || skippedMissing[0].Reason != skipped[0].Reason {
		t.Errorf("an unreachable issue and a non-existent one must give the same reason, got %q and %q",
			skipped[0].Reason, skippedMissing[0].Reason)
	}
}

// Statuses belong to one team, so a cross-team selection cannot all move to one of them.
// Without this the statement would point an issue at another team's status, which no board
// can render.
func TestBulkUpdateIssues_SkipsIssuesWhoseTeamDoesNotOwnTheStatus(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	mine := f.NewIssue(t, "Mine")
	_, theirs := secondTeam(t, svc, p, "PRD", "Another team's")

	issues, skipped, _, err := svc.BulkUpdateIssues(ctx, p, domain.BulkUpdateIssuesInput{
		IDs:     []uuid.UUID{mine, theirs},
		StateID: &f.InProgress,
	})
	if err != nil {
		t.Fatalf("bulk update: %v", err)
	}
	if len(issues) != 1 || issues[0].ID != mine {
		t.Fatalf("expected only the owning team's issue to move, got %+v", issues)
	}
	if len(skipped) != 1 || skipped[0].ID != theirs {
		t.Fatalf("expected the other team's issue to be skipped, got %+v", skipped)
	}
	if !strings.Contains(skipped[0].Reason, "different team") {
		t.Errorf("the reason should say why, got %q", skipped[0].Reason)
	}
}

func TestBulkUpdateIssues_RefusesAnEmptyEdit(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	id := f.NewIssue(t, "Untouched")
	before := workspaceVersion(t, db, f.WorkspaceID)

	_, _, _, err := svc.BulkUpdateIssues(ctx, f.Principal(), domain.BulkUpdateIssuesInput{
		IDs: []uuid.UUID{id},
	})
	if err == nil {
		t.Fatal("a bulk edit that changes nothing was accepted")
	}
	// Nothing may reach the stream: a version bump with no change wakes every client in the
	// workspace to deliver an issue identical to the one they hold.
	if after := workspaceVersion(t, db, f.WorkspaceID); after != before {
		t.Errorf("an empty edit advanced the version from %d to %d", before, after)
	}
}

// --- restore -------------------------------------------------------------------------

// A restore has to bring the issue back whole. Comments are separate rows with their own
// deleted_at, so a delete that only hides the issue leaves them intact — and this is what
// proves the restore does not have to put them back one by one, and that nothing on the way
// through discards them.
func TestRestoreIssue_BringsBackTheIssueWithItsComments(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Deleted by mistake"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	for _, body := range []string{"first thought", "second thought"} {
		if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
			IssueID: issue.ID, Body: body,
		}); err != nil {
			t.Fatalf("comment: %v", err)
		}
	}

	if _, err := svc.DeleteIssue(ctx, p, issue.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.GetIssue(ctx, p, issue.ID); err == nil {
		t.Fatal("the issue is still readable after being deleted")
	}

	restored, version, err := svc.RestoreIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.ID != issue.ID || restored.Identifier != issue.Identifier {
		t.Errorf("the restored issue is not the one that was deleted: %+v", restored)
	}
	if version == 0 {
		t.Error("a restore must put the issue back on the sync stream")
	}

	if _, err := svc.GetIssue(ctx, p, issue.ID); err != nil {
		t.Fatalf("the restored issue is not readable: %v", err)
	}
	comments, err := svc.ListComments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list comments: %v", err)
	}
	if len(comments) != 2 {
		t.Fatalf("the discussion did not come back with the issue: %d comments", len(comments))
	}

	// The change row has to carry the issue, not just its id: the client dropped its copy
	// when the delete arrived, so an id alone would leave a hole until the next bootstrap.
	changes := issueChangesAfter(t, db, f.WorkspaceID, 0)
	last := changes[len(changes)-1]
	if last.Op != string(domain.OpUpsert) || len(last.Payload) == 0 {
		t.Errorf("restore emitted %s with a %d-byte payload, want an upsert carrying the issue",
			last.Op, len(last.Payload))
	}
}

func TestRestoreIssue_RefusesSomethingThatWasNeverDeleted(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	id := f.NewIssue(t, "Alive and well")

	_, _, err := svc.RestoreIssue(ctx, f.Principal(), id)
	if err == nil {
		t.Fatal("restoring a live issue was accepted")
	}
	if got := platform.CodeOf(err); got != platform.CodeNotFound {
		t.Errorf("code = %s, want NOT_FOUND", got)
	}
}

// The bin and the restore have to agree about the window, or it lists issues whose restore
// button answers "not found".
func TestListDeletedIssues_ListsWhatRestoreWouldAccept(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	kept := f.NewIssue(t, "Still here")
	binned := f.NewIssue(t, "Thrown away")
	if _, err := svc.DeleteIssue(ctx, p, binned); err != nil {
		t.Fatalf("delete: %v", err)
	}

	deleted, err := svc.ListDeletedIssues(ctx, p)
	if err != nil {
		t.Fatalf("list deleted: %v", err)
	}
	if len(deleted) != 1 || deleted[0].ID != binned {
		t.Fatalf("the bin holds %+v, want just the deleted issue", deleted)
	}
	if deleted[0].Identifier == "" {
		t.Error("a binned issue still needs its identifier — it is how a person recognises it")
	}

	if _, _, err := svc.RestoreIssue(ctx, p, deleted[0].ID); err != nil {
		t.Fatalf("the bin listed an issue restore then refused: %v", err)
	}

	// A guest of no teams sees nothing, rather than everybody's deletions.
	stranger := f.PrincipalFor(f.NewUser(t, "stranger", "member", false), authz.RoleMember)
	strangerBin, err := svc.ListDeletedIssues(ctx, stranger)
	if err != nil {
		t.Fatalf("list deleted for a stranger: %v", err)
	}
	if len(strangerBin) != 0 {
		t.Errorf("somebody outside the team can read the bin: %+v", strangerBin)
	}

	// The live issue is not in the bin, and is still readable — a restore of one issue must
	// not have disturbed anything else in the team.
	if _, err := svc.GetIssue(ctx, p, kept); err != nil {
		t.Errorf("the issue that was never deleted is not readable: %v", err)
	}
}

// --- sub-issues ----------------------------------------------------------------------

// A cycle in the parent chain is a hang, not a data-quality problem: the rollup, the
// breadcrumb and the delete cascade all walk it. The database refuses it; what this proves
// is that the refusal reaches the user as something they can act on rather than as a 500
// naming two uuids.
func TestUpdateIssue_RefusesAParentCycleWithAUsableMessage(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent := f.NewIssue(t, "Epic")
	child := f.NewIssue(t, "Task")

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: child, ParentID: &parent}); err != nil {
		t.Fatalf("parenting: %v", err)
	}

	// Now make the parent a child of its own child.
	_, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: parent, ParentID: &child})
	if err == nil {
		t.Fatal("a parent cycle was accepted")
	}
	if got := platform.CodeOf(err); got != platform.CodeValidation {
		t.Fatalf("code = %s, want VALIDATION — a cycle is something the user did, not a server fault", got)
	}
	var perr *platform.Error
	if !errors.As(err, &perr) || perr.Field != "parentId" {
		t.Errorf("the error must name the offending field so the client can attach it: %+v", err)
	}
	if strings.Contains(err.Error(), parent.String()) || strings.Contains(err.Error(), child.String()) {
		t.Errorf("the message reads back the trigger's uuids instead of explaining: %v", err)
	}

	// An issue directly under itself is the same refusal.
	_, _, err = svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: child, ParentID: &child})
	if err == nil || platform.CodeOf(err) != platform.CodeValidation {
		t.Errorf("an issue set as its own parent gave %v, want a validation error", err)
	}
}

func TestUpdateIssue_ClearFlagsAreTheOnlyWayToRemoveAValue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent := f.NewIssue(t, "Epic")
	id := f.NewIssue(t, "Task")

	estimate := 5
	due := model.Date("2026-03-01")
	set, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
		ID: id, Estimate: &estimate, DueDate: &due, ParentID: &parent,
	})
	if err != nil {
		t.Fatalf("set: %v", err)
	}
	if set.Estimate == nil || *set.Estimate != 5 {
		t.Fatalf("estimate = %v, want 5", set.Estimate)
	}
	if set.DueDate == nil || *set.DueDate != due {
		t.Fatalf("dueDate = %v, want %s", set.DueDate, due)
	}
	if set.ParentID == nil || *set.ParentID != parent {
		t.Fatalf("parentId = %v, want %s", set.ParentID, parent)
	}
	// A sub-issue needs a place among its siblings, or the children list has no order to
	// render and re-parenting twice produces an arbitrary one.
	if set.SubIssueSortOrder == nil {
		t.Error("a sub-issue was given no place among its siblings")
	}

	// An update that mentions none of them leaves all three alone. This is the whole reason
	// the clear flags exist: without them this call would wipe the lot.
	renamed := "Renamed"
	untouched, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: id, Title: &renamed})
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if untouched.Estimate == nil || untouched.DueDate == nil || untouched.ParentID == nil {
		t.Fatalf("a partial update dropped values it never mentioned: %+v", untouched)
	}

	cleared, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
		ID: id, ClearEstimate: true, ClearDueDate: true, ClearParent: true,
	})
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if cleared.Estimate != nil || cleared.DueDate != nil || cleared.ParentID != nil {
		t.Fatalf("the clear flags did not remove the values: %+v", cleared)
	}

	// Setting and clearing in one call is a contradiction, not something to resolve
	// silently in favour of one of them.
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
		ID: id, Estimate: &estimate, ClearEstimate: true,
	}); err == nil {
		t.Error("setting and clearing the estimate at once was accepted")
	}
}

// A sub-issue may live in another team on purpose — a platform task under a product feature
// is the normal case — but only for somebody who can reach both. Otherwise attaching to a
// guessed id is an existence oracle, the same one relations are careful not to be.
func TestCreateIssue_SubIssueAcrossTeamsNeedsBothTeams(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	_, parent := secondTeam(t, svc, admin, "PLT", "Platform work")

	child, _, err := svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Product work", ParentID: &parent,
	})
	if err != nil {
		t.Fatalf("cross-team sub-issue: %v", err)
	}
	if child.ParentID == nil || *child.ParentID != parent {
		t.Fatalf("parentId = %v, want %s", child.ParentID, parent)
	}
	if child.SubIssueSortOrder == nil {
		t.Error("a sub-issue created under a parent needs a place among its siblings")
	}

	outsider := f.PrincipalFor(f.NewUser(t, "outsider", "member", true), authz.RoleMember, f.TeamID)
	_, _, err = svc.CreateIssue(ctx, outsider, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Reaching in", ParentID: &parent,
	})
	if err == nil {
		t.Fatal("an issue was attached to a parent in a team the caller cannot see")
	}
	if got := platform.CodeOf(err); got != platform.CodeValidation {
		t.Errorf("code = %s, want VALIDATION", got)
	}
	if strings.Contains(err.Error(), parent.String()) {
		t.Errorf("the error names the hidden parent: %v", err)
	}
}

func TestCreateIssue_RejectsAnEstimateThatWouldWrapTheColumn(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// The column is a smallint. Narrowed unchecked this becomes 0 — a value the CHECK is
	// happy with, stored under a burndown nobody has reason to doubt.
	huge := 65536
	_, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Enormous", Estimate: &huge,
	})
	if err == nil {
		t.Fatal("an estimate larger than the column accepts was taken")
	}
	if got := platform.CodeOf(err); got != platform.CodeValidation {
		t.Errorf("code = %s, want VALIDATION", got)
	}
}

func TestCreateIssue_RejectsADueDateThatIsNotACalendarDay(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// An instant, which is exactly the mistake model.Date exists to prevent.
	bad := model.Date("2026-03-01T09:00:00Z")
	_, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Due when?", DueDate: &bad,
	})
	if err == nil {
		t.Fatal("a timestamp was accepted as a due date")
	}
	if !strings.Contains(err.Error(), "2006-01-02") {
		t.Errorf("the error should name the format, got: %v", err)
	}
}

// --- progress ------------------------------------------------------------------------

// Cancelled children leave the denominator. Counted as incomplete, a parent that cancelled
// its last outstanding child would sit at 66% forever with no work left that could move it.
func TestIssueProgress_CancelledChildrenLeaveTheDenominator(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent := f.NewIssue(t, "Epic")

	// No children at all is not nought per cent: it means this is not a parent.
	if progress, err := svc.IssueProgress(ctx, p, parent); err != nil {
		t.Fatalf("progress: %v", err)
	} else if progress != nil {
		t.Fatalf("an issue with no children reported %+v, want nil", progress)
	}

	states := []uuid.UUID{f.Done, f.Done, f.Canceled}
	for i, state := range states {
		child := f.NewIssue(t, "")
		if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: child, ParentID: &parent}); err != nil {
			t.Fatalf("parent child %d: %v", i, err)
		}
		if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: child, StateID: &state}); err != nil {
			t.Fatalf("move child %d: %v", i, err)
		}
	}

	progress, err := svc.IssueProgress(ctx, p, parent)
	if err != nil {
		t.Fatalf("progress: %v", err)
	}
	if progress == nil {
		t.Fatal("a parent with three children reported no progress")
	}
	if progress.Total != 3 || progress.Completed != 2 || progress.Canceled != 1 {
		t.Fatalf("progress = %+v, want 3 total, 2 completed, 1 cancelled", *progress)
	}
	// Two done out of the two that could be done.
	if progress.Percent != 100 {
		t.Errorf("percent = %d, want 100: cancelled work is not incomplete work", progress.Percent)
	}
}

// Only the direct children. A recursive rollup would make a list view walk the whole graph
// once per visible row, and the grandchild here is what would show up if it did.
func TestIssueProgress_CountsDirectChildrenOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent := f.NewIssue(t, "Epic")
	child := f.NewIssue(t, "Task")
	grandchild := f.NewIssue(t, "Subtask")

	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: child, ParentID: &parent}); err != nil {
		t.Fatalf("parent the child: %v", err)
	}
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: grandchild, ParentID: &child}); err != nil {
		t.Fatalf("parent the grandchild: %v", err)
	}

	progress, err := svc.IssueProgress(ctx, p, parent)
	if err != nil {
		t.Fatalf("progress: %v", err)
	}
	if progress == nil || progress.Total != 1 {
		t.Fatalf("progress = %+v, want a total of 1 — the grandchild belongs to the child", progress)
	}
}

// --- estimates -----------------------------------------------------------------------

func TestUpdateTeamEstimates_SetsTheScaleWithoutTouchingTheIssues(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	estimate := 3
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Three of something", Estimate: &estimate,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	team, version, err := svc.UpdateTeamEstimates(ctx, p, domain.UpdateTeamEstimatesInput{
		TeamID: f.TeamID, Scale: model.EstimateScaleTShirt, AllowZero: true,
	})
	if err != nil {
		t.Fatalf("update estimates: %v", err)
	}
	if team.EstimateScale != model.EstimateScaleTShirt || !team.EstimateAllowZero || team.EstimateExtended {
		t.Fatalf("team estimate settings = %+v", team)
	}
	if version == 0 {
		t.Error("the scale change must reach the clients that render it")
	}

	// The number stays put. That is the property that makes changing a scale cheap rather
	// than a rewrite of every issue in the team.
	after, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if after.Estimate == nil || *after.Estimate != 3 {
		t.Errorf("changing the scale rewrote the issue's estimate: %v", after.Estimate)
	}

	if _, _, err := svc.UpdateTeamEstimates(ctx, p, domain.UpdateTeamEstimatesInput{
		TeamID: f.TeamID, Scale: "roman-numerals",
	}); err == nil {
		t.Error("a scale the product does not have was accepted")
	}
}

// --- helpers -------------------------------------------------------------------------

func workspaceVersion(t *testing.T, db *store.DB, workspaceID uuid.UUID) int64 {
	t.Helper()
	v, err := db.Queries().GetWorkspaceVersion(context.Background(), workspaceID)
	if err != nil {
		t.Fatalf("read workspace version: %v", err)
	}
	return v
}

func issueChangesAfter(t *testing.T, db *store.DB, workspaceID uuid.UUID, after int64) []store.ChangeLog {
	t.Helper()
	rows, err := db.Queries().ReadChangesSince(context.Background(), store.ReadChangesSinceParams{
		WorkspaceID: workspaceID, AfterVersion: after, ThroughVersion: 1 << 40, PageSize: 500,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	out := make([]store.ChangeLog, 0, len(rows))
	for _, r := range rows {
		if r.EntityType == "issue" {
			out = append(out, r)
		}
	}
	return out
}
