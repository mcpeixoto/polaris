package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Archiving used to be a one-way door for labels, templates and statuses.
//
// `archiveIssue(id, archived: Boolean!)` has always taken a direction. `archiveLabel(id)`,
// `archiveIssueTemplate(id)` and `archiveWorkflowState(id)` did not, so nothing in the
// product could ever un-archive one — and the workaround is not equivalent. A status, a
// label and a template are all named by id from somewhere else: a board column, a saved
// view's filter, every issue that ever carried the label, `issue.template_id`. Creating a
// replacement with the same name produces a different row that none of those point at, so a
// mistaken archive was permanent in a way nothing on screen explained.
//
// Each of the three tests below takes the same shape: archive it, prove it is gone from the
// listing the product reads, bring it back, prove it is in that listing again — and prove
// the change stream said an upsert rather than a delete on the way back, because every client
// dropped its copy when the archive arrived and only a payload can return it.

func TestArchiveLabel_GoesBothWays(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	label, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "Regression"})
	if err != nil {
		t.Fatalf("create label: %v", err)
	}

	if _, err := svc.ArchiveLabel(ctx, p, label.ID, true); err != nil {
		t.Fatalf("archive label: %v", err)
	}
	if labelIDs(t, svc, ctx, p)[label.ID] {
		t.Fatalf("an archived label is still in the picker")
	}

	version, err := svc.ArchiveLabel(ctx, p, label.ID, false)
	if err != nil {
		t.Fatalf("un-archive label: %v", err)
	}
	if !labelIDs(t, svc, ctx, p)[label.ID] {
		t.Errorf("the label did not come back into the picker after being un-archived")
	}
	assertChange(t, db, label.ID, version, "upsert", true)
}

// The interesting rule, and the one that had to be decided rather than fallen into.
//
// A group can only be archived once it is empty, which means the labels that were in it were
// archived first. Bringing one of those back without the group would file it in the picker
// under a heading that has itself been archived — a chip belonging to a group nothing can
// resolve, which is exactly the state the archive rule refuses to create from the other
// direction. So the un-archive is refused, in an order the user can act on, rather than
// silently restoring the group or silently moving the label to the root.
func TestUnarchiveLabel_RefusesWhileItsGroupIsStillArchived(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	group, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "Priority", IsGroup: true})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	child, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "P0", ParentID: &group.ID})
	if err != nil {
		t.Fatalf("create label in group: %v", err)
	}

	// The order the product forces: a group cannot be archived while it still holds labels.
	if _, err := svc.ArchiveLabel(ctx, p, group.ID, true); platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("archiving a group that still holds a label was allowed: %v", err)
	}
	if _, err := svc.ArchiveLabel(ctx, p, child.ID, true); err != nil {
		t.Fatalf("archive the label: %v", err)
	}
	if _, err := svc.ArchiveLabel(ctx, p, group.ID, true); err != nil {
		t.Fatalf("archive the now-empty group: %v", err)
	}

	err = nil
	if _, err = svc.ArchiveLabel(ctx, p, child.ID, false); platform.CodeOf(err) != platform.CodeConflict {
		t.Fatalf("un-archiving a label whose group is still archived was allowed (%v).\n"+
			"It would reappear in the picker under a heading that does not exist, which is the "+
			"state archiving a non-empty group is refused to prevent, reached from the other side.",
			err)
	}

	// And the order that does work.
	if _, err := svc.ArchiveLabel(ctx, p, group.ID, false); err != nil {
		t.Fatalf("un-archive the group: %v", err)
	}
	if _, err := svc.ArchiveLabel(ctx, p, child.ID, false); err != nil {
		t.Fatalf("un-archive the label once its group is back: %v", err)
	}
	live := labelIDs(t, svc, ctx, p)
	if !live[group.ID] || !live[child.ID] {
		t.Errorf("group %v and label %v are not both back in the picker", live[group.ID], live[child.ID])
	}
}

// A name released by archiving can be taken. Coming back to find it gone is a refusal the
// user can act on, and not a 500 from a unique index.
func TestUnarchiveLabel_ExplainsANameTakenWhileItWasArchived(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	original, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "Flaky"})
	if err != nil {
		t.Fatalf("create label: %v", err)
	}
	if _, err := svc.ArchiveLabel(ctx, p, original.ID, true); err != nil {
		t.Fatalf("archive label: %v", err)
	}
	if _, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "flaky"}); err != nil {
		t.Fatalf("take the freed name: %v", err)
	}

	_, err = svc.ArchiveLabel(ctx, p, original.ID, false)
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("un-archiving into a taken name gave %v (code %s), want a validation error naming the label",
			err, platform.CodeOf(err))
	}
}

func TestArchiveIssueTemplate_GoesBothWays(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	template, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{Name: "Bug report"})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	if _, _, err := svc.ArchiveIssueTemplate(ctx, p, template.ID, true); err != nil {
		t.Fatalf("archive template: %v", err)
	}
	if templateIDs(t, svc, p, nil)[template.ID] {
		t.Fatalf("an archived template is still offered by the create dialog")
	}

	_, version, err := svc.ArchiveIssueTemplate(ctx, p, template.ID, false)
	if err != nil {
		t.Fatalf("un-archive template: %v", err)
	}
	if !templateIDs(t, svc, p, nil)[template.ID] {
		t.Errorf("the template is not offered again after being un-archived")
	}
	assertChange(t, db, template.ID, version, "upsert", true)
}

func TestArchiveWorkflowState_GoesBothWays(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	state, _, err := svc.CreateWorkflowState(ctx, p, domain.CreateWorkflowStateInput{
		TeamID: f.TeamID, Name: "In Review", Category: domain.CategoryStarted,
	})
	if err != nil {
		t.Fatalf("create status: %v", err)
	}

	if _, err := svc.ArchiveWorkflowState(ctx, p, state.ID, true); err != nil {
		t.Fatalf("archive status: %v", err)
	}
	if stateIDs(t, svc, ctx, p, f.TeamID)[state.ID] {
		t.Fatalf("an archived status is still a column on the board")
	}

	version, err := svc.ArchiveWorkflowState(ctx, p, state.ID, false)
	if err != nil {
		t.Fatalf("un-archive status: %v", err)
	}
	live := stateIDs(t, svc, ctx, p, f.TeamID)
	if !live[state.ID] {
		t.Errorf("the status is not a column again after being un-archived")
	}
	assertChange(t, db, state.ID, version, "upsert", true)

	// Archiving twice is not a way to mint a version for a write that did not happen: a
	// mutation reporting a version its call did not create tells a client its write landed
	// somewhere on the stream that nothing was written to.
	if _, err := svc.ArchiveWorkflowState(ctx, p, state.ID, false); platform.CodeOf(err) != platform.CodeNotFound {
		t.Errorf("un-archiving a live status gave %v, want not-found", err)
	}
}

// assertChange reads the change_log row a mutation minted and insists it says what the
// clients need it to say.
//
// The op is the whole point of the un-archive work: archiving reaches a replica as a delete
// and the client throws its copy away, so the way back has to be an upsert carrying the row.
// An un-archive that emitted a delete would leave every client without the label, the
// template or the column, with the server perfectly sure it had restored it.
func assertChange(t *testing.T, db *store.DB, entityID uuid.UUID, version int64, wantOp string, wantPayload bool) {
	t.Helper()

	var op string
	var hasPayload bool
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT op, payload IS NOT NULL FROM change_log WHERE entity_id = $1 AND version = $2`,
		entityID, version,
	).Scan(&op, &hasPayload); err != nil {
		t.Fatalf("read the change row for %s at version %d: %v", entityID, version, err)
	}
	if op != wantOp {
		t.Errorf("the change stream carries op %q for this write, want %q", op, wantOp)
	}
	if hasPayload != wantPayload {
		t.Errorf("the change row carries payload=%v, want %v — an upsert with no payload is a "+
			"row the client is told to keep and given nothing to keep", hasPayload, wantPayload)
	}
}

func labelIDs(t *testing.T, svc *domain.Service, ctx context.Context, p *authz.Principal) map[uuid.UUID]bool {
	t.Helper()
	rows, err := svc.ListLabels(ctx, p)
	if err != nil {
		t.Fatalf("list labels: %v", err)
	}
	out := make(map[uuid.UUID]bool, len(rows))
	for _, r := range rows {
		out[r.ID] = true
	}
	return out
}

func stateIDs(t *testing.T, svc *domain.Service, ctx context.Context, p *authz.Principal, teamID uuid.UUID) map[uuid.UUID]bool {
	t.Helper()
	rows, err := svc.ListWorkflowStates(ctx, p, teamID)
	if err != nil {
		t.Fatalf("list statuses: %v", err)
	}
	out := make(map[uuid.UUID]bool, len(rows))
	for _, r := range rows {
		out[r.ID] = true
	}
	return out
}
