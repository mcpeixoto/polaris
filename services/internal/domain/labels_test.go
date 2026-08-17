package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 1 in docs/07-milestones/01-milestone-1.md:
//
//	Two clients add different labels to one issue at the same moment -> both survive.
//
// This is the test the whole shape of issue_label exists to pass. If applications were an
// array on the issue — or if this method read the issue's labels, added one, and wrote the
// set back — the two calls below would each write a set of one and the loser's label would
// vanish with no error anywhere. Neither client would ever learn that it had happened.
func TestAddIssueLabel_ConcurrentAddsOfDifferentLabelsBothSurvive(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})
	regression := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "regression"})
	issue := f.NewIssue(t, "Two people, one issue")

	type result struct {
		applied model.IssueLabel
		version int64
		err     error
	}
	labels := []uuid.UUID{bug.ID, regression.ID}
	results := make([]result, len(labels))

	// A barrier rather than staggered starts: the interesting instant is the one where both
	// transactions are open at once.
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range labels {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			applied, version, err := svc.AddIssueLabel(ctx, p, issue, labels[i])
			results[i] = result{applied, version, err}
		}(i)
	}
	close(start)
	wg.Wait()

	for i, r := range results {
		if r.err != nil {
			t.Fatalf("add %d: %v — both concurrent adds must succeed", i, r.err)
		}
	}
	if results[0].applied.ID == results[1].applied.ID {
		t.Fatal("both adds returned one row id; an application is one row per (issue, label)")
	}
	if results[0].version == results[1].version {
		t.Fatalf("both adds landed on version %d; every write gets its own place in the stream", results[0].version)
	}

	// Both rows are there, which is the acceptance criterion itself.
	applied, err := svc.ListIssueLabels(ctx, p, issue)
	if err != nil {
		t.Fatalf("list issue labels: %v", err)
	}
	if len(applied) != 2 {
		t.Fatalf("issue carries %d labels, want 2 — one of the concurrent adds was lost", len(applied))
	}
	got := map[uuid.UUID]bool{}
	for _, a := range applied {
		got[a.LabelID] = true
	}
	if !got[bug.ID] || !got[regression.ID] {
		t.Fatalf("issue carries %v, want both %s and %s", got, bug.ID, regression.ID)
	}

	// And both reached the sync stream as separate entities. A single change naming the
	// issue would be the set-write bug wearing a different hat: the second delta would tell
	// every client to replace the first one's work.
	changes := emittedChangesOf(t, db, f.WorkspaceID, "issueLabel")
	if len(changes) != 2 {
		t.Fatalf("emitted %d issueLabel changes, want 2", len(changes))
	}
	delivered := map[uuid.UUID]bool{}
	for _, c := range changes {
		if c.Op != string(domain.OpUpsert) {
			t.Fatalf("issueLabel change is %q, want an upsert of the one row", c.Op)
		}
		if c.EntityID == issue {
			t.Fatal("a change named the issue; an application is its own entity, not a field of the issue")
		}
		delivered[decodeChangePayload[model.IssueLabel](t, c.Payload).LabelID] = true
	}
	if changes[0].EntityID == changes[1].EntityID {
		t.Fatal("both changes name one entity; the two applications must be addressable separately")
	}
	if !delivered[bug.ID] || !delivered[regression.ID] {
		t.Fatal("the deltas a client would receive do not carry both labels")
	}
	for _, c := range emittedChanges(t, db, f.WorkspaceID) {
		if c.EntityType == "issue" {
			t.Fatal("labelling rewrote the issue itself; nothing on the issue row changed")
		}
	}
}

// The one-per-group rule is the database's, and the error a user sees has to name the label
// that is in the way. A raw 23505 arrives as a 500 for something they could fix in one click.
func TestAddIssueLabel_SecondLabelFromOneGroupIsRefusedByName(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	priority := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "Priority", IsGroup: true})
	p0 := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "P0", ParentID: &priority.ID})
	p1 := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "P1", ParentID: &priority.ID})
	issue := f.NewIssue(t, "Only one priority")

	if _, _, err := svc.AddIssueLabel(ctx, p, issue, p0.ID); err != nil {
		t.Fatalf("apply P0: %v", err)
	}

	_, _, err := svc.AddIssueLabel(ctx, p, issue, p1.ID)
	if err == nil {
		t.Fatal("an issue accepted two labels from one group")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION — this is a fixable input, not a server fault", code, err)
	}
	if !strings.Contains(err.Error(), "P0") || !strings.Contains(err.Error(), "Priority") {
		t.Fatalf("error %q names neither the conflicting label nor the group; the user cannot act on it", err)
	}

	applied, err := svc.ListIssueLabels(ctx, p, issue)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(applied) != 1 || applied[0].LabelID != p0.ID {
		t.Fatalf("issue carries %d labels after the refusal, want P0 alone", len(applied))
	}
}

// A group is a container. Applying one is a picker bug or an API caller's mistake, and the
// message has to say which of the two things they meant.
func TestAddIssueLabel_AGroupIsNotApplicable(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	priority := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "Priority", IsGroup: true})
	issue := f.NewIssue(t, "Grouped")

	_, _, err := svc.AddIssueLabel(ctx, p, issue, priority.ID)
	if err == nil {
		t.Fatal("a group was applied to an issue")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}
	if !strings.Contains(err.Error(), "Priority") || !strings.Contains(err.Error(), "group") {
		t.Fatalf("error %q does not explain that Priority is a group", err)
	}
}

// A team's label on another team's issue would show up in that team's filters, on an issue
// they cannot open. The trigger refuses it; this is about the sentence the user gets.
func TestAddIssueLabel_ATeamsLabelStaysInItsTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	design, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{Key: "DES", Name: "Design"})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}
	// The principal is assembled at the entry point and never re-read, so joining a team
	// mid-request means building the principal that a later request would carry.
	p := f.PrincipalFor(f.UserID, authz.RoleOwner, f.TeamID, design.ID)

	mockup := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "needs-mockup", TeamID: &design.ID})
	issue := f.NewIssue(t, "An engineering issue")

	_, _, err = svc.AddIssueLabel(ctx, p, issue, mockup.ID)
	if err == nil {
		t.Fatal("Design's label was applied to an Engineering issue")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}
	if !strings.Contains(err.Error(), "needs-mockup") {
		t.Fatalf("error %q does not name the label that was refused", err)
	}
}

// Adding a label twice is the same application, not a second one. The id has to be stable
// because it is the entity's name on the sync stream: a fresh id would tell every client to
// hold two rows for one label on one issue.
func TestAddIssueLabel_IsIdempotentOnTheSameRow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})
	issue := f.NewIssue(t, "Double click")

	first, _, err := svc.AddIssueLabel(ctx, p, issue, bug.ID)
	if err != nil {
		t.Fatalf("first add: %v", err)
	}
	second, _, err := svc.AddIssueLabel(ctx, p, issue, bug.ID)
	if err != nil {
		t.Fatalf("second add: %v — applying a label already there is not an error", err)
	}
	if first.ID != second.ID {
		t.Fatalf("second add minted a new id (%s then %s)", first.ID, second.ID)
	}

	applied, err := svc.ListIssueLabels(ctx, p, issue)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(applied) != 1 {
		t.Fatalf("issue carries %d applications of one label, want 1", len(applied))
	}
}

// The delete has to name the row that disappeared, not the issue and not the label, because
// the row's id is what every client stored.
func TestRemoveIssueLabel_DeletesTheApplicationByItsOwnID(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	bug := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})
	issue := f.NewIssue(t, "Mislabelled")

	applied, _, err := svc.AddIssueLabel(ctx, p, issue, bug.ID)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	removed, version, err := svc.RemoveIssueLabel(ctx, p, issue, bug.ID)
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if removed != applied.ID {
		t.Fatalf("removed id %s, want the application's own id %s", removed, applied.ID)
	}
	if version == 0 {
		t.Fatal("the removal minted no version; clients would never hear about it")
	}

	changes := emittedChangesOf(t, db, f.WorkspaceID, "issueLabel")
	last := changes[len(changes)-1]
	if last.Op != string(domain.OpDelete) || last.EntityID != applied.ID {
		t.Fatalf("last change is %s of %s, want a delete of %s", last.Op, last.EntityID, applied.ID)
	}

	rest, err := svc.ListIssueLabels(ctx, p, issue)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rest) != 0 {
		t.Fatalf("issue still carries %d labels after the removal", len(rest))
	}

	// Removing what is not there is a mistake worth reporting, not a silent success: a
	// client that thinks it removed something it did not would show the chip gone.
	if _, _, err := svc.RemoveIssueLabel(ctx, p, issue, bug.ID); err == nil {
		t.Fatal("removing an absent label reported success")
	}
}

// The two scopes are two different permissions, and the change each emits has to carry the
// scope the sync hub judges it by. A workspace label with a team scope reaches nobody outside
// that team; a team label with a workspace scope reaches everybody, including people who
// cannot see the team it belongs to.
func TestCreateLabel_ScopeDecidesBothThePermissionAndTheChangeScope(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "mem", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)

	if _, _, err := svc.CreateLabel(ctx, member, domain.CreateLabelInput{Name: "company-wide"}); err == nil {
		t.Fatal("a member created a workspace-wide label")
	} else if code := platform.CodeOf(err); code != platform.CodeForbidden {
		t.Fatalf("got code %s (%v), want FORBIDDEN", code, err)
	}

	teamLabel, _, err := svc.CreateLabel(ctx, member, domain.CreateLabelInput{
		Name: "flaky", TeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("a team member could not create a label in their own team: %v", err)
	}
	workspaceLabel := mustLabel(t, svc, f.Principal(), domain.CreateLabelInput{Name: "company-wide"})

	scopes := map[uuid.UUID]authz.Scope{}
	for _, c := range emittedChangesOf(t, db, f.WorkspaceID, "label") {
		scope, err := authz.ParseScope(c.Scope)
		if err != nil {
			t.Fatalf("parse scope: %v", err)
		}
		scopes[c.EntityID] = scope
	}

	if got := scopes[teamLabel.ID]; got.Kind != authz.ScopeTeam || len(got.TeamIDs) != 1 || got.TeamIDs[0] != f.TeamID {
		t.Fatalf("team label travels under %+v, want a team scope naming %s", got, f.TeamID)
	}
	if got := scopes[workspaceLabel.ID]; got.Kind != authz.ScopeWorkspace {
		t.Fatalf("workspace label travels under %+v, want a workspace scope", got)
	}
}

// Names are unique per scope and case-insensitively, so "Bug" and "bug" in one team is a
// mistake nobody notices until they filter. The same name in two scopes is not a mistake.
func TestCreateLabel_NamesAreUniqueWithinAScopeOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})

	_, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "  Bug  "})
	if err == nil {
		t.Fatal("two labels differing only in case were accepted in one scope")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}
	if !strings.Contains(err.Error(), "Bug") {
		t.Fatalf("error %q does not say which name collided", err)
	}

	if _, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "bug", TeamID: &f.TeamID}); err != nil {
		t.Fatalf("a team may have its own label of a name the workspace uses: %v", err)
	}
}

// Positions are fractional keys compared within one scope, so appending and inserting are
// both one row written and no neighbour touched.
func TestCreateLabel_AfterLabelIDInsertsBetweenNeighbours(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	first := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "first"})
	third := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "third"})
	second := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "second", AfterLabelID: &first.ID})

	if !(first.Position < second.Position && second.Position < third.Position) {
		t.Fatalf("positions %q, %q, %q are not in the order the caller asked for",
			first.Position, second.Position, third.Position)
	}

	labels, err := svc.ListLabels(ctx, p)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var names []string
	for _, l := range labels {
		names = append(names, l.Name)
	}
	if strings.Join(names, ",") != "first,second,third" {
		t.Fatalf("labels list as %v, want first,second,third", names)
	}

	// A team label's key is minted against its own scope, so it never has to be comparable
	// with the workspace's.
	if _, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{
		Name: "team-scoped", TeamID: &f.TeamID, AfterLabelID: &first.ID,
	}); err == nil {
		t.Fatal("a team label was positioned against a workspace label")
	}
}

// Moving a label between groups carries its applications with it, and the move has to fail
// rather than silently drop one of two labels an issue already holds. Only the person doing
// the reorganisation can decide which survives.
func TestUpdateLabel_MovingIntoAGroupThatWouldDoubleUpIsRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	priority := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "Priority", IsGroup: true})
	p0 := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "P0", ParentID: &priority.ID})
	urgent := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "urgent"})

	issue := f.NewIssue(t, "Carries both")
	if _, _, err := svc.AddIssueLabel(ctx, p, issue, p0.ID); err != nil {
		t.Fatalf("apply P0: %v", err)
	}
	if _, _, err := svc.AddIssueLabel(ctx, p, issue, urgent.ID); err != nil {
		t.Fatalf("apply urgent: %v", err)
	}

	_, _, err := svc.UpdateLabel(ctx, p, domain.UpdateLabelInput{ID: urgent.ID, ParentID: &priority.ID})
	if err == nil {
		t.Fatal("a label moved into a group an issue already had a label from")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}
	if !strings.Contains(err.Error(), "urgent") || !strings.Contains(err.Error(), "Priority") {
		t.Fatalf("error %q names neither the label being moved nor the group", err)
	}

	// Nothing was dropped on the way to the refusal.
	applied, err := svc.ListIssueLabels(ctx, p, issue)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(applied) != 2 {
		t.Fatalf("issue carries %d labels after the refused move, want both", len(applied))
	}
	after, err := svc.GetLabel(ctx, p, urgent.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if after.ParentID != nil {
		t.Fatalf("urgent ended up in group %s despite the refusal", *after.ParentID)
	}
}

// A label may only be parented to a group, and the message has to say so in the caller's
// terms rather than in the trigger's.
func TestCreateLabel_ParentMustBeAGroup(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	plain := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "bug"})

	_, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "child", ParentID: &plain.ID})
	if err == nil {
		t.Fatal("a label was parented to something that is not a group")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}
	if !strings.Contains(err.Error(), "bug") {
		t.Fatalf("error %q does not name the label that is not a group", err)
	}
}

// Archiving is the label's delete: there is no unarchive and clients are told to forget it.
// So it refuses while anything still points at the label, rather than leaving every client
// holding an application whose label it no longer has.
func TestArchiveLabel_RefusesWhileStillInUse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	priority := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "Priority", IsGroup: true})
	p0 := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "P0", ParentID: &priority.ID})
	issue := f.NewIssue(t, "Has a priority")
	if _, _, err := svc.AddIssueLabel(ctx, p, issue, p0.ID); err != nil {
		t.Fatalf("apply: %v", err)
	}

	if _, err := svc.ArchiveLabel(ctx, p, priority.ID); err == nil {
		t.Fatal("a group holding labels was archived")
	} else if code := platform.CodeOf(err); code != platform.CodeConflict {
		t.Fatalf("got code %s (%v), want CONFLICT", code, err)
	}

	_, err := svc.ArchiveLabel(ctx, p, p0.ID)
	if err == nil {
		t.Fatal("a label still applied to an issue was archived")
	}
	if code := platform.CodeOf(err); code != platform.CodeConflict {
		t.Fatalf("got code %s (%v), want CONFLICT", code, err)
	}
	if !strings.Contains(err.Error(), "1 issue") {
		t.Fatalf("error %q does not say how many issues still carry it", err)
	}

	if _, _, err := svc.RemoveIssueLabel(ctx, p, issue, p0.ID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	version, err := svc.ArchiveLabel(ctx, p, p0.ID)
	if err != nil {
		t.Fatalf("archive after the last application went away: %v", err)
	}
	if version == 0 {
		t.Fatal("archiving minted no version")
	}

	changes := emittedChangesOf(t, db, f.WorkspaceID, "label")
	last := changes[len(changes)-1]
	if last.Op != string(domain.OpDelete) || last.EntityID != p0.ID {
		t.Fatalf("last label change is %s of %s, want a delete of %s", last.Op, last.EntityID, p0.ID)
	}
	if last.Payload != nil {
		t.Fatal("the delete carried a payload; a client only needs the id to forget the row")
	}

	// And it is gone from every read, because there is no state in which an archived label
	// is still offered.
	if _, err := svc.GetLabel(ctx, p, p0.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("archived label is still readable (%v)", err)
	}
	for _, l := range mustListLabels(t, svc, p) {
		if l.ID == p0.ID {
			t.Fatal("archived label is still listed")
		}
	}
}

// Labels are visible by their scope, judged by the one predicate every read path uses. A
// guest is scoped to their teams and never sees workspace-wide entities.
func TestListLabels_ShowsOnlyWhatTheCallersScopeAllows(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	workspaceLabel := mustLabel(t, svc, admin, domain.CreateLabelInput{Name: "company-wide"})
	teamLabel := mustLabel(t, svc, admin, domain.CreateLabelInput{Name: "flaky", TeamID: &f.TeamID})

	guestID := f.NewUser(t, "guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)

	seen := map[uuid.UUID]bool{}
	labels, err := svc.ListLabels(ctx, guest)
	if err != nil {
		t.Fatalf("list as guest: %v", err)
	}
	for _, l := range labels {
		seen[l.ID] = true
	}
	if seen[workspaceLabel.ID] {
		t.Fatal("a guest was shown a workspace-wide label")
	}
	if !seen[teamLabel.ID] {
		t.Fatal("a guest was not shown a label of the team they belong to")
	}

	// Somebody outside the team sees neither the label nor its existence.
	outsiderID := f.NewUser(t, "outsider", "member", false)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember)
	if _, err := svc.GetLabel(ctx, outsider, teamLabel.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("a non-member read a team label (%v); which labels a team has is information about that team", err)
	}
}

func mustLabel(t *testing.T, svc *domain.Service, p *authz.Principal, in domain.CreateLabelInput) model.Label {
	t.Helper()
	label, _, err := svc.CreateLabel(context.Background(), p, in)
	if err != nil {
		t.Fatalf("create label %q: %v", in.Name, err)
	}
	return label
}

func mustListLabels(t *testing.T, svc *domain.Service, p *authz.Principal) []model.Label {
	t.Helper()
	labels, err := svc.ListLabels(context.Background(), p)
	if err != nil {
		t.Fatalf("list labels: %v", err)
	}
	return labels
}

// emittedChanges reads the change stream the way the sync hub does, which is the only place
// that can prove a mutation is visible to clients at all.
func emittedChanges(t *testing.T, db *store.DB, workspaceID uuid.UUID) []store.ChangeLog {
	t.Helper()
	rows, err := db.Queries().ReadChangesSince(context.Background(), store.ReadChangesSinceParams{
		WorkspaceID: workspaceID, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 500,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	return rows
}

func emittedChangesOf(t *testing.T, db *store.DB, workspaceID uuid.UUID, entityType string) []store.ChangeLog {
	t.Helper()
	var out []store.ChangeLog
	for _, r := range emittedChanges(t, db, workspaceID) {
		if r.EntityType == entityType {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		t.Fatalf("no %s changes were emitted at all — clients never learn about it", entityType)
	}
	return out
}

// A payload is JSON on the wire, so this is what a client would actually receive.
func decodeChangePayload[T any](t *testing.T, raw json.RawMessage) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	return v
}
