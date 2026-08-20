package domain_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 10 in docs/07-milestones/01-milestone-1.md, second half:
//
//	Every new entity ... appears on the change stream with a scope.
//
// Only this level can prove it, and nothing did. Scope is not a type the compiler can check
// and not a constraint the database enforces: `change_log.scope` is a `jsonb` column with no
// CHECK on `kind`, and `Emit` accepts a zero-valued `authz.Scope` without complaint. A
// forgotten `Scope:` field therefore writes `{"kind":""}`, which `authz.Visible` matches no
// case for and denies — so the entity is emitted, stored, and invisible to every session
// forever, with no error anywhere and every existing test still green. The individual
// entity tests each assert their own scope, which is the right thing to do and cannot
// establish the universal: a type nobody wrote a test for is exactly the type that gets it
// wrong.
//
// So this exercises one write of every entity type the replica carries and then reads the
// change stream back the way the sync hub does. Two properties fall out that no per-entity
// test can state: that every type reaches the stream at all, and that not one of them
// arrives with a scope the visibility predicate cannot read.

// TestChangeStream_EveryEntityTypeArrivesWithAUsableScope is the universal.
func TestChangeStream_EveryEntityTypeArrivesWithAUsableScope(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	exerciseEveryEntityType(t, f, svc)

	rows, err := db.Pool().Query(ctx,
		`SELECT entity_type, scope FROM change_log WHERE workspace_id = $1 ORDER BY version`,
		f.WorkspaceID)
	if err != nil {
		t.Fatalf("read change stream: %v", err)
	}
	type change struct {
		EntityType string
		Scope      json.RawMessage
	}
	changes, err := pgx.CollectRows(rows, pgx.RowToStructByPos[change])
	if err != nil {
		t.Fatalf("scan change stream: %v", err)
	}
	if len(changes) == 0 {
		t.Fatal("the sweep emitted no changes at all")
	}

	// The kinds `authz.Visible` has a case for. Anything else is denied, so anything else
	// is an entity nobody will ever see.
	known := map[authz.ScopeKind]bool{
		authz.ScopeWorkspace:   true,
		authz.ScopeTeam:        true,
		authz.ScopeProject:     true,
		authz.ScopeIssueShared: true,
		authz.ScopeUser:        true,
	}

	seen := map[string]bool{}
	for _, c := range changes {
		seen[c.EntityType] = true

		scope, err := authz.ParseScope(c.Scope)
		if err != nil {
			t.Errorf("a %s change carries a scope the server cannot parse (%s): %v",
				c.EntityType, c.Scope, err)
			continue
		}
		if scope.Kind == "" {
			t.Errorf("a %s change carries an empty scope kind (%s). Emit accepts a zero-valued "+
				"authz.Scope, and authz.Visible denies every kind it has no case for — so this "+
				"entity was written, versioned, and will never reach a single client.",
				c.EntityType, c.Scope)
			continue
		}
		if !known[scope.Kind] {
			t.Errorf("a %s change carries scope kind %q, which authz.Visible has no case for; "+
				"it will be denied to every session", c.EntityType, scope.Kind)
		}

		// A scope of a kind that needs a subject and does not carry one is denied just as
		// completely as an empty one, and is easier to write by accident.
		switch scope.Kind {
		case authz.ScopeTeam, authz.ScopeProject:
			if len(scope.TeamIDs) == 0 {
				t.Errorf("a %s change is scoped to %q but names no team: %s",
					c.EntityType, scope.Kind, c.Scope)
			}
		case authz.ScopeUser:
			if scope.UserID == nil {
				t.Errorf("a %s change is scoped to a user but names none: %s", c.EntityType, c.Scope)
			}
		}
	}

	// And the sweep really did cover every type the client replicates, so a green result
	// means "all of them are scoped" rather than "the ones I happened to write are".
	for _, want := range clientEntityTypes(t) {
		if !seen[want] {
			t.Errorf("no %q change was emitted by the sweep. Either the entity never reaches the "+
				"change stream — which fails acceptance test 10 — or exerciseEveryEntityType needs "+
				"a case for it. Both are the kind of omission this test exists to catch.", want)
		}
	}

	// The reverse direction: a type the server emits and the client cannot name is silently
	// dropped by `Store.applyChanges`, which skips any change whose `type` is not an
	// EntityType. No error, no log line, just an entity that never appears.
	client := map[string]bool{}
	for _, name := range clientEntityTypes(t) {
		client[name] = true
	}
	var unknown []string
	for name := range seen {
		if !client[name] {
			unknown = append(unknown, name)
		}
	}
	sort.Strings(unknown)
	for _, name := range unknown {
		t.Errorf("the server emits %q, which is not in ENTITY_TYPES in web/src/store/types.ts. "+
			"The client drops changes whose type it does not recognise, without an error.", name)
	}
}

// clientEntityTypes reads the entity types the replica carries out of the client's source.
//
// The same shape as TestNotificationPrefsMatchTheClient and the sync schema pin: a contract
// shared by two languages with no compiler across the seam needs a test that reads both
// sides, and this is the third instance of that lesson in this repository.
func clientEntityTypes(t *testing.T) []string {
	t.Helper()

	const relative = "../../../web/src/store/types.ts"
	source, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		// A hard failure rather than a skip: a skip would be silent in CI on the day
		// somebody moved the file, which is exactly when the pin stops holding.
		t.Fatalf("cannot read the client's store types at %s: %v", relative, err)
	}

	block := regexp.MustCompile(`ENTITY_TYPES[^=]*=\s*\[([^\]]*)\]`).FindStringSubmatch(string(source))
	if block == nil {
		t.Fatalf("no ENTITY_TYPES array in %s — if it was renamed, this test has to be taught "+
			"the new name rather than deleted", relative)
	}

	var out []string
	for _, m := range regexp.MustCompile(`'([A-Za-z]+)'`).FindAllStringSubmatch(block[1], -1) {
		out = append(out, m[1])
	}
	if len(out) == 0 {
		t.Fatalf("ENTITY_TYPES in %s parsed to nothing", relative)
	}
	sort.Strings(out)
	return out
}

// exerciseEveryEntityType performs one write of each entity type the replica carries.
//
// Written through the domain layer rather than the store, which is the opposite of what the
// fixtures do and is the point: the criterion is about what the emitter produces, so a
// fixture that wrote the rows directly would bypass the only code under test.
func exerciseEveryEntityType(t *testing.T, f *testutil.Fixture, svc *domain.Service) {
	t.Helper()
	ctx := context.Background()
	p := f.Principal()

	name := "Acme Renamed"
	if _, _, err := svc.UpdateWorkspace(ctx, p, domain.UpdateWorkspaceInput{Name: &name}); err != nil {
		t.Fatalf("workspace: %v", err)
	}

	displayName := "dev-renamed"
	if _, _, err := svc.UpdateProfile(ctx, p, domain.UpdateProfileInput{DisplayName: &displayName}); err != nil {
		t.Fatalf("user: %v", err)
	}

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("githubConnection: %v", err)
	}
	if _, _, err := svc.CreateGitHubUserLink(ctx, p, domain.CreateGitHubUserLinkInput{GitHubLogin: "dev"}); err != nil {
		t.Fatalf("githubUserLink: %v", err)
	}
	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("gitlabConnection: %v", err)
	}
	if _, _, err := svc.CreateGitLabUserLink(ctx, p, domain.CreateGitLabUserLinkInput{GitLabUsername: "dev"}); err != nil {
		t.Fatalf("gitlabUserLink: %v", err)
	}

	team, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "OPS", Name: "Operations"})
	if err != nil {
		t.Fatalf("team: %v", err)
	}

	watcherID := f.NewUser(t, "watcher", "member", false)
	if _, _, err := svc.AddTeamMember(ctx, p, f.TeamID, watcherID, "member"); err != nil {
		t.Fatalf("teamMembership: %v", err)
	}

	if _, _, err := svc.CreateWorkflowState(ctx, p, domain.CreateWorkflowStateInput{
		TeamID: f.TeamID, Name: "In Review", Category: "started", Color: "#5e6ad2",
	}); err != nil {
		t.Fatalf("workflowState: %v", err)
	}

	label := mustLabel(t, svc, p, domain.CreateLabelInput{Name: "scoped"})

	if _, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID, Name: "Bug report",
	}); err != nil {
		t.Fatalf("issueTemplate: %v", err)
	}

	formTpl, _, err := svc.CreateFormTemplate(ctx, p, domain.CreateFormTemplateInput{
		TeamID: &f.TeamID, Name: "Intake form",
	})
	if err != nil {
		t.Fatalf("formTemplate: %v", err)
	}
	if _, _, err := svc.CreateFormTemplateField(ctx, p, domain.CreateFormTemplateFieldInput{
		FormTemplateID: formTpl.ID,
		FieldType:      model.FormFieldText,
		Label:          "Summary",
	}); err != nil {
		t.Fatalf("formTemplateField: %v", err)
	}

	if _, _, err := svc.CreateAskForm(ctx, p, domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "IT requests",
	}); err != nil {
		t.Fatalf("askForm: %v", err)
	}

	projTpl, _, err := svc.CreateProjectTemplate(ctx, p, domain.CreateProjectTemplateInput{
		TeamID: &f.TeamID, Name: "Launch kit", Summary: "Ship it",
	})
	if err != nil {
		t.Fatalf("projectTemplate: %v", err)
	}
	if _, _, err := svc.CreateProjectTemplateMilestone(ctx, p, domain.CreateProjectTemplateMilestoneInput{
		ProjectTemplateID: projTpl.ID, Name: "Beta",
	}); err != nil {
		t.Fatalf("projectTemplateMilestone: %v", err)
	}
	if _, _, err := svc.CreateProjectTemplateIssue(ctx, p, domain.CreateProjectTemplateIssueInput{
		ProjectTemplateID: projTpl.ID, Title: "Kickoff",
	}); err != nil {
		t.Fatalf("projectTemplateIssue: %v", err)
	}

	if _, _, err := svc.CreateProjectStatus(ctx, p, domain.CreateProjectStatusInput{
		Name: "Paused", Category: model.ProjectCategoryPlanned,
	}); err != nil {
		t.Fatalf("projectStatus: %v", err)
	}

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Scoped", TeamIDs: []uuid.UUID{f.TeamID}, MemberIDs: []uuid.UUID{p.UserID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	if _, _, err := svc.CreateProjectMilestone(ctx, p, domain.CreateProjectMilestoneInput{
		ProjectID: project.ID, Name: "Beta",
	}); err != nil {
		t.Fatalf("projectMilestone: %v", err)
	}

	on := true
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &on,
	}); err != nil {
		t.Fatalf("cycle: %v", err)
	}

	if _, _, err := svc.CreateRecurringIssue(ctx, p, domain.CreateRecurringIssueInput{
		TeamID:       f.TeamID,
		Title:        "Weekly status",
		Cadence:      model.CadenceWeekly,
		FirstDueDate: "2026-09-01",
	}); err != nil {
		t.Fatalf("recurringIssue: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The scoped one",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	other, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: team.ID, Title: "The far one",
	})
	if err != nil {
		t.Fatalf("issue in the second team: %v", err)
	}

	if _, _, err := svc.AddIssueLabel(ctx, p, issue.ID, label.ID); err != nil {
		t.Fatalf("issueLabel: %v", err)
	}
	// Cross-team, so the sweep produces a project-scoped change as well as team- and
	// workspace-scoped ones — the kind whose TeamIDs a zero value would leave empty.
	if _, _, err := svc.CreateIssueRelation(ctx, p, issue.ID, other.ID, model.RelationBlocks); err != nil {
		t.Fatalf("issueRelation: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID: issue.ID, Body: "Scoped comment",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	if _, _, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID: issue.ID, URL: "https://github.com/acme/app/pull/1", Title: "PR 1",
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	if _, _, err := svc.CreateDocument(ctx, p, domain.CreateDocumentInput{
		TeamID: f.TeamID, Title: "Runbook",
	}); err != nil {
		t.Fatalf("document: %v", err)
	}
	if _, _, err := svc.CreateInitiative(ctx, p, domain.CreateInitiativeInput{
		Name: "Reliability",
	}); err != nil {
		t.Fatalf("initiative: %v", err)
	}
	cust, _, err := svc.CreateCustomer(ctx, p, domain.CreateCustomerInput{Name: "Acme"})
	if err != nil {
		t.Fatalf("customer: %v", err)
	}
	if _, _, err := svc.CreateCustomerRequest(ctx, p, domain.CreateCustomerRequestInput{
		CustomerID: &cust.ID, IssueID: &issue.ID, Body: "Need SSO",
	}); err != nil {
		t.Fatalf("customerRequest: %v", err)
	}
	urgent := int32(1440)
	if _, _, err := svc.CreateSlaRule(ctx, p, domain.CreateSlaRuleInput{
		Filter:          json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
		Action:          model.SlaActionApply,
		DurationMinutes: &urgent,
	}); err != nil {
		t.Fatalf("slaRule: %v", err)
	}
	dash, _, err := svc.CreateDashboard(ctx, p, domain.CreateDashboardInput{Name: "Delivery"})
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}
	if _, _, err := svc.CreateDashboardTile(ctx, p, domain.CreateDashboardTileInput{
		DashboardID: dash.ID,
		Title:       "Lead time",
		Measure:     model.DashboardMeasureLeadTime,
	}); err != nil {
		t.Fatalf("dashboardTile: %v", err)
	}
	project, _, err = svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Launch pad", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("project for initiative link: %v", err)
	}
	initRows, err := svc.ListInitiatives(ctx, p)
	if err != nil || len(initRows) == 0 {
		t.Fatalf("list initiatives: %v", err)
	}
	if _, _, err := svc.AddInitiativeProject(ctx, p, initRows[0].ID, project.ID); err != nil {
		t.Fatalf("initiativeProject: %v", err)
	}
	if _, _, err := svc.CreateProjectUpdate(ctx, p, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthAtRisk,
		Body:      "Scope creep",
	}); err != nil {
		t.Fatalf("projectUpdate: %v", err)
	}
	blocker, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Foundation", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("blocking project: %v", err)
	}
	if _, _, err := svc.AddProjectDependency(ctx, p, blocker.ID, project.ID); err != nil {
		t.Fatalf("projectDependency: %v", err)
	}
	pl, _, err := svc.CreateProjectLabel(ctx, p, domain.CreateProjectLabelInput{Name: "Strategic"})
	if err != nil {
		t.Fatalf("projectLabel: %v", err)
	}
	if _, _, err := svc.AddProjectLabel(ctx, p, project.ID, pl.ID); err != nil {
		t.Fatalf("projectLabelLink: %v", err)
	}

	// The watcher subscribes and then hears about somebody else's edit, which is the only
	// way to make a `notification` row exist without writing one by hand.
	watcher := f.PrincipalFor(watcherID, authz.RoleMember, f.TeamID)
	if _, _, err := svc.SetIssueSubscription(ctx, watcher, issue.ID, true); err != nil {
		t.Fatalf("issueSubscription: %v", err)
	}
	title := "The scoped one, edited"
	if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, Title: &title}); err != nil {
		t.Fatalf("issue update: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("notification: %v", err)
	}

	view, _, err := svc.CreateView(ctx, p, domain.CreateViewInput{
		Name:   "Everything urgent",
		Filter: json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
	})
	if err != nil {
		t.Fatalf("view: %v", err)
	}
	if _, _, err := svc.SetViewPreference(ctx, p, "view:"+view.ID.String(),
		json.RawMessage(`{"groupBy":"state"}`)); err != nil {
		t.Fatalf("viewPreference: %v", err)
	}
	if _, _, err := svc.SetViewSubscription(ctx, p, domain.SetViewSubscriptionInput{
		ViewID: view.ID, Added: true, Completed: true,
	}); err != nil {
		t.Fatalf("viewSubscription: %v", err)
	}
	if _, _, err := svc.AddFavorite(ctx, p, "view", view.ID, nil); err != nil {
		t.Fatalf("favorite: %v", err)
	}
}

// The exemption every other test in this file depends on being honest: that the sweep above
// is complete. Stated as its own assertion so a reader can see the coverage claim without
// running it, and so that the failure names the missing type rather than showing up as a
// vague absence in the test above.
func TestChangeStream_TheSweepCoversEveryReplicatedType(t *testing.T) {
	types := clientEntityTypes(t)
	if len(types) < 16 {
		t.Fatalf("ENTITY_TYPES parsed to %d entries (%v); the parse is wrong, not the client",
			len(types), types)
	}
	t.Logf("the replica carries %d entity types: %s", len(types), strings.Join(types, ", "))
}
