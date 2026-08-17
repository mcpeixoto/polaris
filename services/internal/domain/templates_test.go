package domain_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A template's properties are the create mutation's own arguments, kept as an opaque bag so
// that adding a field to issue creation does not need a migration here. That only holds if
// the bag survives the round trip byte for byte in meaning: a template whose properties
// arrive back missing a key prefills an issue the author did not describe, and nothing
// errors.
func TestIssueTemplate_PropertiesRoundTripThroughEverySurface(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	properties := json.RawMessage(`{
	  "priority": 2,
	  "assigneeId": null,
	  "labelIds": ["a3e2f1c4-0000-7000-8000-000000000001"],
	  "estimate": 3,
	  "nested": {"dueDateSource": "manual"}
	}`)
	title := "Incident: "
	body := "## Impact\n\n## Timeline\n"

	created, _, err := svc.CreateIssueTemplate(ctx, admin, domain.CreateIssueTemplateInput{
		TeamID:     &f.TeamID,
		Name:       "Incident report",
		Title:      &title,
		Body:       &body,
		Properties: properties,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if !jsonBlobsEqual(t, created.Properties, properties) {
		t.Fatalf("the returned properties are %s, want %s", created.Properties, properties)
	}
	if created.Title != title || created.Body != body {
		t.Fatalf("title/body came back as %q/%q, want %q/%q", created.Title, created.Body, title, body)
	}

	listed, err := svc.ListIssueTemplates(ctx, admin, &f.TeamID)
	if err != nil {
		t.Fatalf("list templates: %v", err)
	}
	if len(listed) != 1 || !jsonBlobsEqual(t, listed[0].Properties, properties) {
		t.Fatalf("the listing returned %+v, want the properties as saved", listed)
	}

	// And on the wire, which is the copy every client actually renders from.
	for _, c := range changesForEntity(t, db, f.WorkspaceID, "issueTemplate") {
		if c.EntityID != created.ID {
			continue
		}
		payload := decodeIssueTemplate(t, c.Payload)
		if !jsonBlobsEqual(t, payload.Properties, properties) {
			t.Fatalf("the change payload carries %s, want %s", payload.Properties, properties)
		}
		if payload.Title != title || payload.Body != body {
			t.Fatalf("the change payload carries %q/%q, want %q/%q", payload.Title, payload.Body, title, body)
		}
	}

	// An edit that names only the properties leaves the rest of the template alone, and the
	// new bag replaces the old one whole rather than merging into it — a merge would make
	// removing a property impossible.
	replacement := json.RawMessage(`{"priority": 1}`)
	updated, _, err := svc.UpdateIssueTemplate(ctx, admin, domain.UpdateIssueTemplateInput{
		ID:         created.ID,
		Properties: replacement,
	})
	if err != nil {
		t.Fatalf("update template: %v", err)
	}
	if !jsonBlobsEqual(t, updated.Properties, replacement) {
		t.Fatalf("properties are %s after the edit, want %s", updated.Properties, replacement)
	}
	if updated.Title != title || updated.Body != body {
		t.Fatalf("an edit to the properties changed title/body to %q/%q", updated.Title, updated.Body)
	}
}

// The bag is an object on both sides of the wire. A client handed an array where it expects
// an object does not render one wrong option — it throws while painting the create dialog,
// and the template that did it was saved by somebody else.
func TestCreateIssueTemplate_PropertiesMustBeAnObject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	_, _, err := svc.CreateIssueTemplate(ctx, f.Principal(), domain.CreateIssueTemplateInput{
		TeamID:     &f.TeamID,
		Name:       "Wrong shape",
		Properties: json.RawMessage(`["priority", 2]`),
	})
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}

	// Absent is not the same as wrong: a template that prefills nothing but a name is a
	// legitimate thing to want, and it stores an empty bag rather than a null one.
	empty, _, err := svc.CreateIssueTemplate(ctx, f.Principal(), domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID,
		Name:   "Just a name",
	})
	if err != nil {
		t.Fatalf("create template with no properties: %v", err)
	}
	if !jsonBlobsEqual(t, empty.Properties, json.RawMessage(`{}`)) {
		t.Fatalf("properties defaulted to %s, want an empty object", empty.Properties)
	}
}

// The two scopes are two permissions and two audiences, and they have to agree: a workspace
// template is offered in every team's create dialog, which is what makes creating one an
// admin action while creating a team's own is not.
func TestCreateIssueTemplate_ScopeDecidesBothThePermissionAndTheChangeScope(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "mem", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)

	if _, _, err := svc.CreateIssueTemplate(ctx, member, domain.CreateIssueTemplateInput{
		Name: "Company-wide bug report",
	}); platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("a member created a workspace-wide template (%v), want FORBIDDEN", err)
	}

	teamTemplate, _, err := svc.CreateIssueTemplate(ctx, member, domain.CreateIssueTemplateInput{
		Name: "Bug report", TeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("a team member could not add a template to their own team: %v", err)
	}
	workspaceTemplate, _, err := svc.CreateIssueTemplate(ctx, f.Principal(), domain.CreateIssueTemplateInput{
		Name: "Company-wide bug report",
	})
	if err != nil {
		t.Fatalf("create workspace template: %v", err)
	}

	scopes := map[uuid.UUID]authz.Scope{}
	for _, c := range changesForEntity(t, db, f.WorkspaceID, "issueTemplate") {
		scope, err := authz.ParseScope(c.Scope)
		if err != nil {
			t.Fatalf("parse scope: %v", err)
		}
		scopes[c.EntityID] = scope
	}
	if got := scopes[teamTemplate.ID]; got.Kind != authz.ScopeTeam || len(got.TeamIDs) != 1 || got.TeamIDs[0] != f.TeamID {
		t.Fatalf("a team template travels under %+v, want a team scope naming %s", got, f.TeamID)
	}
	if got := scopes[workspaceTemplate.ID]; got.Kind != authz.ScopeWorkspace {
		t.Fatalf("a workspace template travels under %+v, want a workspace scope", got)
	}
}

// A template belongs to whoever can see its scope. The workspace's are offered everywhere,
// a team's only inside that team, and a guest — scoped to their teams and never handed
// workspace-wide entities — sees only the latter.
func TestListIssueTemplates_ShowsOnlyWhatTheCallersScopeAllows(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	teamTemplate, _, err := svc.CreateIssueTemplate(ctx, admin, domain.CreateIssueTemplateInput{
		Name: "Bug report", TeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("create team template: %v", err)
	}
	workspaceTemplate, _, err := svc.CreateIssueTemplate(ctx, admin, domain.CreateIssueTemplateInput{
		Name: "Company-wide bug report",
	})
	if err != nil {
		t.Fatalf("create workspace template: %v", err)
	}

	// The create dialog inside the team: the workspace's plus that team's own.
	inTeam := templateIDs(t, svc, admin, &f.TeamID)
	if !inTeam[teamTemplate.ID] || !inTeam[workspaceTemplate.ID] {
		t.Fatalf("the team's create dialog offers %v, want both templates", inTeam)
	}

	outsiderID := f.NewUser(t, "outsider", "member", false)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember)
	all := templateIDs(t, svc, outsider, nil)
	if all[teamTemplate.ID] {
		t.Fatal("a non-member was shown a team's template; which templates a team keeps is information about that team")
	}
	if !all[workspaceTemplate.ID] {
		t.Fatal("a workspace member was not shown a workspace-wide template")
	}
	if _, err := svc.ListIssueTemplates(ctx, outsider, &f.TeamID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("listing a team's templates from outside gave %v, want NOT_FOUND", err)
	}
	// Reading one by id is the same answer, or the link is the way round the listing.
	if _, err := svc.GetIssueTemplate(ctx, outsider, teamTemplate.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("reading a team template from outside gave %v, want NOT_FOUND", err)
	}
	if _, err := svc.GetIssueTemplate(ctx, outsider, workspaceTemplate.ID); err != nil {
		t.Fatalf("a workspace member could not read a workspace-wide template: %v", err)
	}

	guestID := f.NewUser(t, "guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)
	seen := templateIDs(t, svc, guest, nil)
	if seen[workspaceTemplate.ID] {
		t.Fatal("a guest was shown a workspace-wide template")
	}
	if !seen[teamTemplate.ID] {
		t.Fatal("a guest was not shown a template of the team they belong to")
	}
}

// Archiving is a template's delete: issue.template_id still points at the row, so it stays,
// but it must stop being offered — and the client's copy is what the create dialog reads,
// so the change has to be a delete rather than an upsert carrying archivedAt.
func TestArchiveIssueTemplate_StopsBeingOfferedAndTellsClientsToForgetIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	template, _, err := svc.CreateIssueTemplate(ctx, admin, domain.CreateIssueTemplateInput{
		Name: "Retired", TeamID: &f.TeamID,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	id, _, err := svc.ArchiveIssueTemplate(ctx, admin, template.ID)
	if err != nil {
		t.Fatalf("archive template: %v", err)
	}
	if id != template.ID {
		t.Fatalf("archive returned %s, want %s — the id is how every client names the row it must drop", id, template.ID)
	}

	if seen := templateIDs(t, svc, admin, &f.TeamID); seen[template.ID] {
		t.Fatal("an archived template is still offered in the create dialog")
	}

	// A second archive, and any edit, must not resurrect it.
	if _, _, err := svc.ArchiveIssueTemplate(ctx, admin, template.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("archiving twice gave %v, want NOT_FOUND", err)
	}
	name := "Back from the dead"
	if _, _, err := svc.UpdateIssueTemplate(ctx, admin, domain.UpdateIssueTemplateInput{
		ID: template.ID, Name: &name,
	}); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("editing an archived template gave %v, want NOT_FOUND", err)
	}

	var deletes int
	for _, c := range changesForEntity(t, db, f.WorkspaceID, "issueTemplate") {
		if c.EntityID == template.ID && c.Op == string(domain.OpDelete) {
			deletes++
		}
	}
	if deletes != 1 {
		t.Fatalf("%d delete changes were emitted, want exactly 1", deletes)
	}
}

// --- helpers ------------------------------------------------------------------------

func templateIDs(t *testing.T, svc *domain.Service, p *authz.Principal, teamID *uuid.UUID) map[uuid.UUID]bool {
	t.Helper()
	templates, err := svc.ListIssueTemplates(context.Background(), p, teamID)
	if err != nil {
		t.Fatalf("list templates: %v", err)
	}
	seen := make(map[uuid.UUID]bool, len(templates))
	for _, tpl := range templates {
		seen[tpl.ID] = true
	}
	return seen
}

// decodeIssueTemplate reads a change payload the way a client does: as JSON, through the
// model's own tags, rather than as the Go value the server happened to hold.
func decodeIssueTemplate(t *testing.T, raw []byte) model.IssueTemplate {
	t.Helper()
	var tpl model.IssueTemplate
	if err := json.Unmarshal(raw, &tpl); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	return tpl
}
