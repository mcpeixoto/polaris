package graph

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// A write, then a read, through the real resolvers and a real database, for every field an
// issue has.
//
// This is the shape of test the package was missing, and the gap it leaves is exactly the
// bug it was written for: createIssue and updateIssue accepted estimate, dueDate, parentId,
// labelIds and templateId, reported success and a fresh version, and wrote none of them,
// because the resolver built its domain input without those fields. Nothing failed.
// api_parity_test.go proves every mutation is *reachable*; schema_drift_test.go proves the
// stored shape and the wire shape agree. Neither can see that the code between them drops a
// field on the floor, because both sides of the comparison are still perfectly correct.
//
// So the assertion here is end-to-end and deliberately dumb: set it, read it back, and
// insist it is what you set. The table below is the field list, and TestIssueRoundTrip_
// TheTableCoversEveryInputField makes forgetting to extend it a failure rather than an
// omission — which is what stops this test decaying the way the two above did.

// issueField is one settable property, written twice and then, where the schema allows it,
// removed.
//
// Twice, because a create and an update take different paths into the domain layer and the
// original bug was in one of them and not the other: bulkUpdateIssues carried the estimate
// correctly the whole time, which is what made the single-issue omission look deliberate
// until somebody read all three call sites side by side.
type issueField struct {
	// input names the field on CreateIssueInput and UpdateIssueInput. The coverage test
	// matches it against those structs, so it has to be the JSON name, not the Go one.
	input string
	// output names the field on Issue as the read query selects it. Usually the same field;
	// labelIds is written as a list of ids and read back as the labels themselves.
	output string

	create func(*generated.CreateIssueInput)
	update func(*generated.UpdateIssueInput)
	// clear is the flag that removes the value, for the three-state properties. Nil for the
	// fields that have no such flag, which is most of them.
	clear func(*generated.UpdateIssueInput)

	// The three expected renderings, as they arrive over the wire.
	afterCreate string
	afterUpdate string
	afterClear  string

	// render turns the JSON value into the string compared against those, for the fields
	// whose wire shape is not a scalar.
	render func(any) string
}

func TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI(t *testing.T) {
	h := newHarness(t)
	fields, subject := issueRoundTripTable(t, h)

	// One query, naming every field, so the read path under test is the one a client uses
	// rather than a Go struct read straight out of a resolver. dueDateSource is the reason
	// it matters that this goes over the wire: the converter used to leave it as the Go
	// zero value, and an empty string is a perfectly good Go string that gqlgen serialises
	// into a non-null enum without a word of complaint.
	read := func(t *testing.T, stage string) map[string]any {
		t.Helper()
		body := h.execute(t, `
			query Read($id: UUID!) {
				issue(id: $id) {
					id workspaceId teamId number identifier
					title description stateId assigneeId creatorId priority sortOrder
					estimate dueDate dueDateSource parentId subIssueSortOrder templateId formTemplateId
					projectId projectMilestoneId cycleId
					startedAt completedAt canceledAt archivedAt createdAt updatedAt
					labels { id }
				}
			}`, map[string]any{"id": subject.String()})
		if errs, ok := body["errors"]; ok {
			t.Fatalf("reading the issue back after %s failed: %v", stage, errs)
		}
		data, _ := body["data"].(map[string]any)
		issue, ok := data["issue"].(map[string]any)
		if !ok {
			t.Fatalf("reading the issue back after %s returned no issue: %v", stage, body)
		}
		return issue
	}

	check := func(t *testing.T, stage string, issue map[string]any, f issueField, want string) {
		t.Helper()
		raw, present := issue[f.output]
		if !present {
			t.Fatalf("the read query did not select %q; the table and the query have drifted apart", f.output)
		}
		got := f.show(raw)
		if got != want {
			t.Errorf("%s: set %s and read back %s = %s, want %s.\n"+
				"A field that is accepted, reported as written and then absent is the whole bug this file exists for: "+
				"check that the resolver copies %s into the domain input and that the converter copies it back out.",
				stage, f.input, f.output, got, want, f.input)
		}
	}

	created := read(t, "createIssue")
	for _, f := range fields {
		t.Run("create/"+f.input, func(t *testing.T) { check(t, "createIssue", created, f, f.afterCreate) })
	}

	// One update carrying every field at once, because that is what a client sends: the
	// panel writes the properties the user touched in a single mutation, and a resolver that
	// handles a field only when it arrives alone is not a resolver anybody exercises.
	update := generated.UpdateIssueInput{ID: subject}
	for _, f := range fields {
		if f.update != nil {
			f.update(&update)
		}
	}
	if _, err := h.Mutation().UpdateIssue(h.ctx, update, nil, nil); err != nil {
		t.Fatalf("update every field at once: %v", err)
	}

	updated := read(t, "updateIssue")
	for _, f := range fields {
		if f.update == nil {
			continue
		}
		t.Run("update/"+f.input, func(t *testing.T) { check(t, "updateIssue", updated, f, f.afterUpdate) })
	}

	// Clearing is its own step and not a variation of the one above, because the three-state
	// properties each need a flag the value cannot express — and a resolver that carries the
	// value but drops the flag looks correct until somebody tries to take an estimate off an
	// issue and is told it worked.
	clear := generated.UpdateIssueInput{ID: subject}
	var clearable []issueField
	for _, f := range fields {
		if f.clear == nil {
			continue
		}
		f.clear(&clear)
		clearable = append(clearable, f)
	}
	if len(clearable) == 0 {
		t.Fatal("no field in the table can be cleared; the three-state properties are half the point of this test")
	}
	if _, err := h.Mutation().UpdateIssue(h.ctx, clear, nil, nil); err != nil {
		t.Fatalf("clear every clearable field at once: %v", err)
	}

	emptied := read(t, "the clear flags")
	for _, f := range clearable {
		t.Run("clear/"+f.input, func(t *testing.T) { check(t, "the clear flags", emptied, f, f.afterClear) })
	}
}

// issueRoundTripTable builds the field list against a live workspace, and returns the id of
// the issue it created with every field already set.
//
// The table is built rather than declared because most of its values are ids that have to
// exist first — a parent to be a sub-issue of, a template to be filed from, labels to carry.
func issueRoundTripTable(t *testing.T, h *harness) ([]issueField, uuid.UUID) {
	t.Helper()

	mate := h.f.NewUser(t, "mate", "member", true)
	parentOnCreate := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Epic one"}).Issue.ID
	parentOnUpdate := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Epic two"}).Issue.ID

	template, err := h.Mutation().CreateIssueTemplate(h.ctx, generated.CreateIssueTemplateInput{
		TeamID: &h.f.TeamID,
		Name:   "Bug report",
	})
	if err != nil {
		t.Fatalf("create a template to file from: %v", err)
	}

	formTemplate, err := h.Mutation().CreateFormTemplate(h.ctx, generated.CreateFormTemplateInput{
		TeamID: &h.f.TeamID,
		Name:   "Intake",
	})
	if err != nil {
		t.Fatalf("create a form template to file from: %v", err)
	}

	bug, regression := h.newLabel(t, "bug"), h.newLabel(t, "regression")

	onCreate, milestoneOnCreate := h.newProject(t, "On create")
	onUpdate, milestoneOnUpdate := h.newProject(t, "On update")

	cycleOnCreate, cycleOnUpdate := h.newCycles(t)

	// A client-minted v7, because that is the whole point of the id field: an offline create
	// names its own issue so the row on screen is the row the server writes.
	chosen := uuid.Must(uuid.NewV7())

	fields := []issueField{
		{
			input: "id", output: "id",
			create:      func(in *generated.CreateIssueInput) { in.ID = &chosen },
			afterCreate: chosen.String(),
		},
		{
			input: "teamId", output: "teamId",
			create:      func(in *generated.CreateIssueInput) { in.TeamID = h.f.TeamID },
			afterCreate: h.f.TeamID.String(),
		},
		{
			input: "title", output: "title",
			create:      func(in *generated.CreateIssueInput) { in.Title = "Filed with everything" },
			update:      func(in *generated.UpdateIssueInput) { in.Title = ptr("Renamed with everything") },
			afterCreate: "Filed with everything", afterUpdate: "Renamed with everything",
		},
		{
			input: "description", output: "description",
			create:      func(in *generated.CreateIssueInput) { in.Description = ptr("As filed") },
			update:      func(in *generated.UpdateIssueInput) { in.Description = ptr("As edited") },
			afterCreate: "As filed", afterUpdate: "As edited",
		},
		{
			input: "stateId", output: "stateId",
			create:      func(in *generated.CreateIssueInput) { in.StateID = &h.f.Todo },
			update:      func(in *generated.UpdateIssueInput) { in.StateID = &h.f.InProgress },
			afterCreate: h.f.Todo.String(), afterUpdate: h.f.InProgress.String(),
		},
		{
			input: "priority", output: "priority",
			create:      func(in *generated.CreateIssueInput) { in.Priority = ptr(2) },
			update:      func(in *generated.UpdateIssueInput) { in.Priority = ptr(1) },
			afterCreate: "2", afterUpdate: "1",
		},
		{
			input: "assigneeId", output: "assigneeId",
			create:      func(in *generated.CreateIssueInput) { in.AssigneeID = &h.f.UserID },
			update:      func(in *generated.UpdateIssueInput) { in.AssigneeID = &mate },
			clear:       func(in *generated.UpdateIssueInput) { in.ClearAssignee = ptr(true) },
			afterCreate: h.f.UserID.String(), afterUpdate: mate.String(), afterClear: "<nil>",
		},
		{
			input: "estimate", output: "estimate",
			create:      func(in *generated.CreateIssueInput) { in.Estimate = ptr(5) },
			update:      func(in *generated.UpdateIssueInput) { in.Estimate = ptr(8) },
			clear:       func(in *generated.UpdateIssueInput) { in.ClearEstimate = ptr(true) },
			afterCreate: "5", afterUpdate: "8", afterClear: "<nil>",
		},
		{
			input: "dueDate", output: "dueDate",
			create:      func(in *generated.CreateIssueInput) { in.DueDate = ptr("2026-09-01") },
			update:      func(in *generated.UpdateIssueInput) { in.DueDate = ptr("2026-10-15") },
			clear:       func(in *generated.UpdateIssueInput) { in.ClearDueDate = ptr(true) },
			afterCreate: "2026-09-01", afterUpdate: "2026-10-15", afterClear: "<nil>",
		},
		{
			input: "parentId", output: "parentId",
			create:      func(in *generated.CreateIssueInput) { in.ParentID = &parentOnCreate },
			update:      func(in *generated.UpdateIssueInput) { in.ParentID = &parentOnUpdate },
			clear:       func(in *generated.UpdateIssueInput) { in.ClearParent = ptr(true) },
			afterCreate: parentOnCreate.String(), afterUpdate: parentOnUpdate.String(), afterClear: "<nil>",
		},
		{
			input: "templateId", output: "templateId",
			create:      func(in *generated.CreateIssueInput) { in.TemplateID = &template.Template.ID },
			afterCreate: template.Template.ID.String(),
		},
		{
			input: "formTemplateId", output: "formTemplateId",
			create:      func(in *generated.CreateIssueInput) { in.FormTemplateID = &formTemplate.Template.ID },
			afterCreate: formTemplate.Template.ID.String(),
		},
		{
			// Written as a list of ids and read back as the labels themselves, which is the
			// one place in this table where the input and the output are different shapes —
			// and the reason the field needs its own renderer.
			input: "labelIds", output: "labels",
			create:      func(in *generated.CreateIssueInput) { in.LabelIds = []uuid.UUID{bug, regression} },
			afterCreate: bug.String() + "," + regression.String(),
			render:      renderLabelIDs,
		},
		{
			input: "projectId", output: "projectId",
			create:      func(in *generated.CreateIssueInput) { in.ProjectID = &onCreate },
			update:      func(in *generated.UpdateIssueInput) { in.ProjectID = &onUpdate },
			clear:       func(in *generated.UpdateIssueInput) { in.ClearProject = ptr(true) },
			afterCreate: onCreate.String(), afterUpdate: onUpdate.String(), afterClear: "<nil>",
		},
		{
			input: "projectMilestoneId", output: "projectMilestoneId",
			create:      func(in *generated.CreateIssueInput) { in.ProjectMilestoneID = &milestoneOnCreate },
			update:      func(in *generated.UpdateIssueInput) { in.ProjectMilestoneID = &milestoneOnUpdate },
			clear:       func(in *generated.UpdateIssueInput) { in.ClearMilestone = ptr(true) },
			afterCreate: milestoneOnCreate.String(), afterUpdate: milestoneOnUpdate.String(), afterClear: "<nil>",
		},
		{
			input: "cycleId", output: "cycleId",
			create:      func(in *generated.CreateIssueInput) { in.CycleID = &cycleOnCreate },
			update:      func(in *generated.UpdateIssueInput) { in.CycleID = &cycleOnUpdate },
			clear:       func(in *generated.UpdateIssueInput) { in.ClearCycle = ptr(true) },
			afterCreate: cycleOnCreate.String(), afterUpdate: cycleOnUpdate.String(), afterClear: "<nil>",
		},
	}

	create := generated.CreateIssueInput{}
	for _, f := range fields {
		if f.create != nil {
			f.create(&create)
		}
	}
	payload := h.createIssue(t, create)
	return fields, payload.Issue.ID
}

// show renders a value the way the table's expectations are written.
func (f issueField) show(v any) string {
	if f.render != nil {
		return f.render(v)
	}
	return showWire(v)
}

func showWire(v any) string {
	if v == nil {
		return "<nil>"
	}
	// JSON numbers arrive as float64, and an estimate of 5 has to read as "5" rather than
	// "5e+00" for the table to be worth looking at.
	if n, ok := v.(float64); ok && n == float64(int64(n)) {
		return fmt.Sprint(int64(n))
	}
	return fmt.Sprint(v)
}

// newLabel makes a label on the fixture's team, for the tests that need something to apply.
func (h *harness) newLabel(t *testing.T, name string) uuid.UUID {
	t.Helper()
	payload, err := h.Mutation().CreateLabel(h.ctx, generated.CreateLabelInput{
		TeamID: &h.f.TeamID, Name: name,
	}, nil, nil)
	if err != nil {
		t.Fatalf("create label %q: %v", name, err)
	}
	return payload.Label.ID
}

// newProject makes a project on the fixture's team and a milestone inside it, so the
// issue round trip can file into one project and then move to another without violating
// "a milestone belongs to the issue's project".
func (h *harness) newProject(t *testing.T, name string) (projectID, milestoneID uuid.UUID) {
	t.Helper()
	project, err := h.Mutation().CreateProject(h.ctx, generated.CreateProjectInput{
		Name:    name,
		TeamIds: []uuid.UUID{h.f.TeamID},
	}, nil, nil)
	if err != nil {
		t.Fatalf("create project %q: %v", name, err)
	}
	if project.Project == nil {
		t.Fatalf("create project %q returned no project", name)
	}
	milestone, err := h.Mutation().CreateProjectMilestone(h.ctx, generated.CreateProjectMilestoneInput{
		ProjectID: project.Project.ID,
		Name:      name + " milestone",
	}, nil, nil)
	if err != nil {
		t.Fatalf("create milestone for %q: %v", name, err)
	}
	if milestone.Milestone == nil {
		t.Fatalf("create milestone for %q returned no milestone", name)
	}
	return project.Project.ID, milestone.Milestone.ID
}

func (h *harness) newCycles(t *testing.T) (onCreate, onUpdate uuid.UUID) {
	t.Helper()
	enabled := true
	upcoming := 2
	payload, err := h.Mutation().UpdateTeamCycles(h.ctx, generated.UpdateTeamCyclesInput{
		TeamID:        h.f.TeamID,
		Enabled:       &enabled,
		UpcomingCount: &upcoming,
	})
	if err != nil {
		t.Fatalf("enable cycles: %v", err)
	}
	if payload.Team == nil {
		t.Fatal("enable cycles returned no team")
	}
	cycles, err := h.Query().Cycles(h.ctx, h.f.TeamID)
	if err != nil {
		t.Fatalf("list cycles: %v", err)
	}
	if len(cycles) < 2 {
		t.Fatalf("got %d cycles, want at least two", len(cycles))
	}
	return cycles[0].ID, cycles[1].ID
}

func renderLabelIDs(v any) string {
	rows, _ := v.([]any)
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		lbl, _ := row.(map[string]any)
		ids = append(ids, fmt.Sprint(lbl["id"]))
	}
	return strings.Join(ids, ",")
}

// The two tests below are the ones that keep the table honest. Without them the table is
// just another hand-maintained list, and the field somebody forgets to add to it is exactly
// the field they forgot to add to the resolver.

// coveredElsewhere names the input fields the round trip does not check by value, each with
// the test that does check it.
//
// They are all positional: they do not store what you send, they mint a fractional key from
// the neighbours you named, so "read it back and compare" is not a question that has an
// answer. What they have instead is an order, and an order is checked by looking at the list.
//
// An entry here is a decision to be argued for in review, which is the point of making it a
// visible edit rather than a silent omission — the same bargain notInTheAPI strikes in
// api_parity_test.go.
var coveredElsewhere = map[string]string{
	"afterIssueId":   "TestIssueOrdering_PlacesAnIssueWhereTheCallerAsked",
	"moveToTop":      "TestIssueOrdering_PlacesAnIssueWhereTheCallerAsked",
	"afterSiblingId": "TestIssueOrdering_PlacesASubIssueAmongItsSiblings",

	// Each of these is the clear half of a three-state property, and the table exercises it
	// through that property's own row rather than as a field of its own.
	"clearAssignee":  "the clear step of TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI",
	"clearEstimate":  "the clear step of TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI",
	"clearDueDate":   "the clear step of TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI",
	"clearParent":    "the clear step of TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI",
	"clearProject":   "the clear step of TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI",
	"clearMilestone": "the clear step of TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI",
	"clearCycle":     "the clear step of TestIssueRoundTrip_EverySettableFieldSurvivesTheAPI",

	"fromTriage":            "TestCreateIssue_FromTriageViewLandsInTriage",
	"skipDefaultTemplate":   "TestCreateIssue_SkipDefaultTemplateLeavesTheIssueBlank",
	"recurringCadence":      "TestCreateIssue_RecurringCadenceAttachesASchedule",
	"recurringFirstDueDate": "TestCreateIssue_RecurringCadenceAttachesASchedule",
}

func TestIssueRoundTrip_TheTableCoversEveryInputField(t *testing.T) {
	h := newHarness(t)
	fields, _ := issueRoundTripTable(t, h)

	covered := make(map[string]bool, len(fields))
	for _, f := range fields {
		covered[f.input] = true
	}

	for _, in := range []struct {
		name  string
		shape any
	}{
		{"CreateIssueInput", generated.CreateIssueInput{}},
		{"UpdateIssueInput", generated.UpdateIssueInput{}},
	} {
		t.Run(in.name, func(t *testing.T) {
			for name := range jsonFields(reflect.TypeOf(in.shape)) {
				if name == "id" && in.name == "UpdateIssueInput" {
					// Which issue to update, not a property of it.
					continue
				}
				if covered[name] {
					continue
				}
				if reason, ok := coveredElsewhere[name]; ok {
					if reason == "" {
						t.Errorf("%s.%s is exempt from the round trip with no reason given", in.name, name)
					}
					continue
				}
				t.Errorf(
					"%s.%s is accepted by the API and no test writes it and reads it back.\n"+
						"A field the schema declares, the input carries and the resolver forgets is silent: "+
						"the mutation returns a fresh version and the value never lands. Add a row to the table in "+
						"issueRoundTripTable, or add %q to coveredElsewhere with the test that covers it.",
					in.name, name, name)
			}
		})
	}
}

// storedButUnwritable are the fields on Issue that no input sets and that a freshly filed
// issue therefore has no value for.
//
// Everything else must come back populated, because the round trip above sets every field it
// can — so a zero here means the converter dropped it on the way out, which is the half of
// the original bug that schema_drift_test.go cannot see.
var storedButUnwritable = map[string]string{
	"startedAt":   "set by the transition into a started or completed status, not by an input",
	"completedAt": "same, for a completed status",
	"canceledAt":  "same, for a cancelled one",
	"archivedAt":  "archiveIssue, and an archived issue is not what this reads back",
	// The two trash fields are the strongest case in this map: they are not merely unset on
	// the issue being read, they are unset on every issue any caller can read. `issue(id:)`
	// and every listing filter deleted rows out, so a non-zero value here would mean the API
	// had just handed somebody a row from the trash. deletedIssues is the one read that
	// returns them populated, and TestDeletedIssues_CarryWhenAndByWhom is what checks it.
	"deletedAt":        "only ever set on a row the trash listing returns; this read cannot see one",
	"deletedBy":        "same",
	"snoozedUntil":     "set by snoozeIssue, not by create; TestSnoozeIssue_HidesUntilTimeOrActivity",
	"autoClosedAt":     "set by the auto-close engine, not by create",
	"recurringIssueId": "set by createRecurringIssue, not by a stored input field; TestCreateIssue_RecurringCadenceAttachesASchedule",
}

func TestIssueRoundTrip_TheReadPathCarriesEveryStoredField(t *testing.T) {
	h := newHarness(t)
	_, subject := issueRoundTripTable(t, h)

	issue, err := h.Query().Issue(h.ctx, subject)
	if err != nil {
		t.Fatalf("read back the issue the table created: %v", err)
	}

	// The fields the sync stream carries and the API also exposes — the intersection
	// schema_drift_test.go proves is total. Those are exactly the fields toIssue has to copy,
	// and this is the only test that notices when it does not. The wire type's extra fields
	// are skipped: state, team, labels and the rest are resolved rather than stored, and a
	// query that did not name them is right to leave them empty.
	stored := jsonFields(reflect.TypeOf(model.Issue{}))
	wire := reflect.ValueOf(*issue)
	wireType := wire.Type()

	for i := range wireType.NumField() {
		name, skip := jsonName(wireType.Field(i))
		if skip {
			continue
		}
		if _, isStored := stored[name]; !isStored {
			continue
		}
		if reason, ok := storedButUnwritable[name]; ok {
			if reason == "" {
				t.Errorf("Issue.%s is exempt with no reason given", name)
			}
			continue
		}
		if wire.Field(i).IsZero() {
			t.Errorf(
				"Issue.%s came back empty after a create that set every field it could.\n"+
					"The database has the value and the schema declares the field; a converter that does not copy it "+
					"returns null — or, for a non-null enum, the empty string, which is not a member of it and which "+
					"gqlgen will serialise without complaint. Copy %s in toIssue.", name, name)
		}
	}
}

// The positional fields, checked by the only thing they have: an order.
//
// afterIssueId, moveToTop and afterSiblingId do not store what you send them. Each mints a
// fractional key from the neighbours you named, so the assertion is where the issue ended up
// in the list, not what came back on the field.

func TestIssueOrdering_PlacesAnIssueWhereTheCallerAsked(t *testing.T) {
	h := newHarness(t)

	first := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "First"}).Issue.ID
	second := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Second"}).Issue.ID

	// Filed with afterIssueId, so it lands between the two rather than at the bottom.
	middle := h.createIssue(t, generated.CreateIssueInput{
		TeamID: h.f.TeamID, Title: "Middle", AfterIssueID: &first,
	}).Issue.ID
	if got := h.issueOrder(t); !reflect.DeepEqual(got, []uuid.UUID{first, middle, second}) {
		t.Errorf("createIssue(afterIssueId: first) put the issue at %v; it must sit directly below the issue it named", got)
	}

	// And moved to the top, which is its own flag because there is no issue to be "after".
	if _, err := h.Mutation().UpdateIssue(h.ctx, generated.UpdateIssueInput{
		ID: second, MoveToTop: ptr(true),
	}, nil, nil); err != nil {
		t.Fatalf("move an issue to the top: %v", err)
	}
	if got := h.issueOrder(t); !reflect.DeepEqual(got, []uuid.UUID{second, first, middle}) {
		t.Errorf("updateIssue(moveToTop: true) left the order %v; moveToTop is dropped by a resolver that only carries afterIssueId", got)
	}
}

func TestIssueOrdering_PlacesASubIssueAmongItsSiblings(t *testing.T) {
	h := newHarness(t)

	parent := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Epic"}).Issue.ID
	child := func(title string) uuid.UUID {
		return h.createIssue(t, generated.CreateIssueInput{
			TeamID: h.f.TeamID, Title: title, ParentID: &parent,
		}).Issue.ID
	}
	one, two, three := child("One"), child("Two"), child("Three")

	if got := h.childOrder(t, parent); !reflect.DeepEqual(got, []uuid.UUID{one, two, three}) {
		t.Fatalf("sub-issues were filed in the order one, two, three and came back %v", got)
	}

	// The gesture this exists for: dragging the last child up under the first. It is a
	// different sequence from the backlog's, so it moves without touching sortOrder.
	if _, err := h.Mutation().UpdateIssue(h.ctx, generated.UpdateIssueInput{
		ID: three, AfterSiblingID: &one,
	}, nil, nil); err != nil {
		t.Fatalf("move a sub-issue up its parent's checklist: %v", err)
	}
	if got := h.childOrder(t, parent); !reflect.DeepEqual(got, []uuid.UUID{one, three, two}) {
		t.Errorf("updateIssue(afterSiblingId: one) left the checklist %v, want one, three, two.\n"+
			"A resolver that drops afterSiblingId reports a fresh version and leaves the order exactly as it was", got)
	}

	if order := h.issueOrder(t); len(order) != 4 {
		t.Errorf("the team's backlog has %d issues after a sibling move; the two orders are separate sequences and one must not disturb the other", len(order))
	}
}

// issueOrder is the team's backlog as the board draws it: sortOrder ascending, which is what
// ListIssuesForTeam returns.
func (h *harness) issueOrder(t *testing.T) []uuid.UUID {
	t.Helper()
	issues, err := h.Query().Issues(h.ctx, h.f.TeamID)
	if err != nil {
		t.Fatalf("list the team's issues: %v", err)
	}
	ids := make([]uuid.UUID, 0, len(issues))
	for _, i := range issues {
		ids = append(ids, i.ID)
	}
	return ids
}

// childOrder is one parent's checklist, in sub_issue_sort_order.
func (h *harness) childOrder(t *testing.T, parent uuid.UUID) []uuid.UUID {
	t.Helper()
	body := h.execute(t, `query Kids($id: UUID!) { issue(id: $id) { children { id } } }`,
		map[string]any{"id": parent.String()})
	if errs, ok := body["errors"]; ok {
		t.Fatalf("read a parent's children: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	issue, _ := data["issue"].(map[string]any)
	rows, _ := issue["children"].([]any)

	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		child, _ := row.(map[string]any)
		id, err := uuid.Parse(fmt.Sprint(child["id"]))
		if err != nil {
			t.Fatalf("a child came back with id %v: %v", child["id"], err)
		}
		ids = append(ids, id)
	}
	return ids
}

// The nested fields, which are declared in the schema and were resolved by nothing.
//
// Selecting them used to yield `[]` or `null` in every case: hydrateIssues filled the status,
// the team, the people, the comments and the history, and there was no issueResolver behind
// the rest — so a client asking for an issue's labels, its parent, its children, its progress
// or its links got a well-formed answer that was simply not true. Issue.progress is M1
// acceptance test 4, which is why the silence mattered.
func TestIssue_TheNestedFieldsResolveToWhatTheDatabaseHolds(t *testing.T) {
	h := newHarness(t)

	label := h.newLabel(t, "urgent")
	parent := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Epic"}).Issue.ID

	subject := h.createIssue(t, generated.CreateIssueInput{
		TeamID:   h.f.TeamID,
		Title:    "The one under test",
		ParentID: &parent,
		LabelIds: []uuid.UUID{label},
	}).Issue.ID

	// Two children, one of them finished, so the rollup has something to round.
	done := h.createIssue(t, generated.CreateIssueInput{
		TeamID: h.f.TeamID, Title: "Finished", ParentID: &subject,
	}).Issue.ID
	h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Outstanding", ParentID: &subject})
	if _, err := h.Mutation().UpdateIssue(h.ctx, generated.UpdateIssueInput{
		ID: done, StateID: &h.f.Done,
	}, nil, nil); err != nil {
		t.Fatalf("finish a sub-issue: %v", err)
	}

	// A link in each direction: one this issue owns, and one pointing at it.
	blocked := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Waiting on us"}).Issue.ID
	blocker := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "In our way"}).Issue.ID
	for _, link := range []struct{ from, to uuid.UUID }{{subject, blocked}, {blocker, subject}} {
		if _, err := h.Mutation().CreateIssueRelation(h.ctx, link.from, link.to,
			generated.RelationTypeBlocks, nil, nil); err != nil {
			t.Fatalf("link %s to %s: %v", link.from, link.to, err)
		}
	}

	if _, err := h.Mutation().CreateAttachment(h.ctx, generated.CreateAttachmentInput{
		IssueID: subject, URL: "https://github.com/acme/app/pull/4", Title: ptr("PR 4"),
	}, nil, nil); err != nil {
		t.Fatalf("attach a URL: %v", err)
	}

	body := h.execute(t, `
		query Panel($id: UUID!) {
			issue(id: $id) {
				labels { id name }
				parent { id title }
				children { id }
				progress { total completed canceled percent }
				relations { relatedIssueId type }
				blockedBy { issueId type }
				subscribers { userId }
				attachments { url title }
			}
		}`, map[string]any{"id": subject.String()})
	if errs, ok := body["errors"]; ok {
		t.Fatalf("the issue panel query failed: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	issue, _ := data["issue"].(map[string]any)

	if got := renderLabelIDs(issue["labels"]); got != label.String() {
		t.Errorf("issue.labels came back %v; the label applied at creation must be on it", issue["labels"])
	}
	if p, _ := issue["parent"].(map[string]any); p == nil || fmt.Sprint(p["id"]) != parent.String() {
		t.Errorf("issue.parent came back %v; the issue was filed as a sub-issue of %s", issue["parent"], parent)
	}
	if kids, _ := issue["children"].([]any); len(kids) != 2 {
		t.Errorf("issue.children came back %v; the issue has two sub-issues", issue["children"])
	}

	// Acceptance test 4: the parent's progress arrives with the parent, in the same answer.
	progress, _ := issue["progress"].(map[string]any)
	if progress == nil {
		t.Fatalf("issue.progress is null on an issue with two children; a client cannot draw the bar without a second round trip it should not have to make")
	}
	for field, want := range map[string]string{"total": "2", "completed": "1", "canceled": "0", "percent": "50"} {
		if got := showWire(progress[field]); got != want {
			t.Errorf("issue.progress.%s is %s, want %s (one of two children finished)", field, got, want)
		}
	}

	relations, _ := issue["relations"].([]any)
	if len(relations) != 1 {
		t.Fatalf("issue.relations came back %v; the issue blocks exactly one other", issue["relations"])
	}
	if r, _ := relations[0].(map[string]any); fmt.Sprint(r["relatedIssueId"]) != blocked.String() {
		t.Errorf("issue.relations names %v, not the issue it blocks", relations[0])
	}

	blockers, _ := issue["blockedBy"].([]any)
	if len(blockers) != 1 {
		t.Fatalf("issue.blockedBy came back %v; exactly one issue blocks this one, and it is the same row read from the far end", issue["blockedBy"])
	}
	if r, _ := blockers[0].(map[string]any); fmt.Sprint(r["issueId"]) != blocker.String() {
		t.Errorf("issue.blockedBy names %v, not the issue in its way", blockers[0])
	}

	// Filing an issue subscribes you to it, so the watcher list is never empty on an issue
	// somebody has just created.
	watchers, _ := issue["subscribers"].([]any)
	if len(watchers) == 0 {
		t.Fatalf("issue.subscribers is empty; whoever filed the issue is watching it")
	}
	var found bool
	for _, w := range watchers {
		row, _ := w.(map[string]any)
		if fmt.Sprint(row["userId"]) == h.f.UserID.String() {
			found = true
		}
	}
	if !found {
		t.Errorf("issue.subscribers came back %v without the person who filed it", issue["subscribers"])
	}

	links, _ := issue["attachments"].([]any)
	if len(links) != 1 {
		t.Fatalf("issue.attachments came back %v; the issue has one link", issue["attachments"])
	}
	if row, _ := links[0].(map[string]any); fmt.Sprint(row["url"]) != "https://github.com/acme/app/pull/4" {
		t.Errorf("issue.attachments names %v, not the URL we attached", links[0])
	}
}

// IssueLabel.label is declared non-null, which makes forgetting it worse than a null field:
// gqlgen refuses to marshal null into a non-null position, so the whole mutation comes back
// as an error — after the row has already been written and the version already minted. A
// client that retries applies it twice and is told twice that it failed.
func TestAddIssueLabel_ThePayloadCarriesTheLabelItApplied(t *testing.T) {
	h := newHarness(t)
	issue := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Needs a chip"}).Issue.ID
	label := h.newLabel(t, "needs-triage")

	body := h.execute(t, `
		mutation Apply($issue: UUID!, $label: UUID!) {
			addIssueLabel(issueId: $issue, labelId: $label) {
				version
				issueLabel { labelId label { id name } }
			}
		}`, map[string]any{"issue": issue.String(), "label": label.String()})
	if errs, ok := body["errors"]; ok {
		t.Fatalf("applying a label and asking for it back failed: %v", errs)
	}

	data, _ := body["data"].(map[string]any)
	payload, _ := data["addIssueLabel"].(map[string]any)
	applied, _ := payload["issueLabel"].(map[string]any)
	nested, _ := applied["label"].(map[string]any)
	if nested == nil {
		t.Fatalf("addIssueLabel returned an application with no label on it: %v", applied)
	}
	if fmt.Sprint(nested["id"]) != label.String() || nested["name"] != "needs-triage" {
		t.Errorf("the application names label %v, not the one that was applied", nested)
	}
}
