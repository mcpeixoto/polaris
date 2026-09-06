package tools_test

import (
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Every ref in this catalogue accepts a UUID or the thing a person would type. The tests
// below are about that equivalence: the same row, whichever way it was named.

func TestResolveTeam_ByUUIDKeyAndName(t *testing.T) {
	h := newHarness(t)

	for _, ref := range []string{h.f.TeamID.String(), "ENG", "eng", "Engineering", "engineering"} {
		got := h.object("create_issue", map[string]any{"title": "Filed via " + ref, "team": ref})
		if str(t, got, "teamId") != h.f.TeamID.String() {
			t.Fatalf("team %q resolved to %v", ref, got["teamId"])
		}
	}

	_, err := h.callAs(h.p, "create_issue", map[string]any{"title": "x", "team": "DESIGN"})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found for a team that does not exist", err)
	}
	_, err = h.callAs(h.p, "create_issue", map[string]any{"title": "x", "team": ""})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want a validation error for a missing team", err)
	}
}

func TestResolveIssue_ByUUIDAndIdentifier(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Two names, one row")

	for _, ref := range []string{str(t, issue, "id"), str(t, issue, "identifier"), "eng-1"} {
		got := h.object("update_issue", map[string]any{"id": ref, "title": "Renamed via " + ref})
		if str(t, got, "id") != str(t, issue, "id") {
			t.Fatalf("issue %q resolved to %v", ref, got["id"])
		}
	}

	_, err := h.callAs(h.p, "get_issue", map[string]any{"id": "ENG-999"})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
	_, err = h.callAs(h.p, "assign_issue", map[string]any{"id": ""})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want a validation error for a missing issue ref", err)
	}
}

func TestResolveUser_ByUUIDDisplayNameEmailAndMe(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Assign me every way")

	var email string
	for _, u := range h.list("list_users", nil) {
		if str(t, u, "id") == h.f.UserID.String() {
			email = str(t, u, "email")
		}
	}
	if email == "" {
		t.Fatal("the fixture's user has no email to resolve by")
	}

	for _, ref := range []string{h.f.UserID.String(), "dev", "DEV", "Dev User", email, "me", "ME"} {
		h.call("assign_issue", map[string]any{"id": str(t, issue, "identifier")}) // unassign first
		got := h.object("assign_issue", map[string]any{
			"id": str(t, issue, "identifier"), "assignee": ref,
		})
		if str(t, got, "assigneeId") != h.f.UserID.String() {
			t.Fatalf("assignee %q resolved to %v", ref, got["assigneeId"])
		}
	}

	_, err := h.callAs(h.p, "assign_issue", map[string]any{
		"id": str(t, issue, "identifier"), "assignee": "nobody-by-that-name",
	})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
}

func TestResolveState_ByUUIDNameAndCategory(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Moving")

	for _, ref := range []string{h.f.InProgress.String(), "In Progress", "in progress", "started"} {
		h.call("set_issue_state", map[string]any{"id": str(t, issue, "identifier"), "state": "Backlog"})
		got := h.object("set_issue_state", map[string]any{
			"id": str(t, issue, "identifier"), "state": ref,
		})
		if str(t, got, "stateId") != h.f.InProgress.String() {
			t.Fatalf("state %q resolved to %v", ref, got["stateId"])
		}
	}

	_, err := h.callAs(h.p, "set_issue_state", map[string]any{
		"id": str(t, issue, "identifier"), "state": "Awaiting Legal",
	})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
}

// A name is only unique inside a scope, so "bug" can be both a team label and a workspace
// one. The team's own is the one a person picking from that team's list would get.
func TestResolveLabel_PrefersTheTeamsOwnOverTheWorkspaceWide(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Labelled")

	workspaceLabel, _, err := h.svc.CreateLabel(h.ctx, h.p, domain.CreateLabelInput{Name: "bug"})
	if err != nil {
		t.Fatalf("workspace label: %v", err)
	}
	teamLabel, _, err := h.svc.CreateLabel(h.ctx, h.p, domain.CreateLabelInput{
		Name: "bug", TeamID: &h.f.TeamID,
	})
	if err != nil {
		t.Fatalf("team label: %v", err)
	}

	got := h.object("set_issue_labels", map[string]any{
		"id": str(t, issue, "identifier"), "labels": []any{"bug"},
	})
	ids, _ := got["labelIds"].([]string)
	if len(ids) != 1 || ids[0] != teamLabel.ID.String() {
		t.Fatalf("labelIds = %v, want the team's %v not the workspace's %v",
			ids, teamLabel.ID, workspaceLabel.ID)
	}

	// A UUID names one row exactly, so it must reach the workspace label the name did not.
	got = h.object("set_issue_labels", map[string]any{
		"id": str(t, issue, "identifier"), "labels": []any{workspaceLabel.ID.String()},
	})
	ids, _ = got["labelIds"].([]string)
	if len(ids) != 1 || ids[0] != workspaceLabel.ID.String() {
		t.Fatalf("labelIds = %v, want %v", ids, workspaceLabel.ID)
	}

	_, err = h.callAs(h.p, "set_issue_labels", map[string]any{
		"id": str(t, issue, "identifier"), "labels": []any{"no-such-label"},
	})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
}

func TestResolveCycle_ByUUIDNameAndNumber(t *testing.T) {
	h := newHarness(t)
	enableCycles(t, h)
	cycles := h.list("list_cycles", map[string]any{"team": "ENG"})
	first := cycles[0]
	planned := h.newIssue("In the cycle")
	if _, _, err := h.svc.UpdateIssue(h.ctx, h.p, domain.UpdateIssueInput{
		ID:      mustUUID(t, str(t, planned, "id")),
		CycleID: ptr(mustUUID(t, str(t, first, "id"))),
	}); err != nil {
		t.Fatalf("put the issue in a cycle: %v", err)
	}

	for _, ref := range []string{str(t, first, "id"), str(t, first, "name"), "1"} {
		got := identifiers(h.list("list_issues", map[string]any{"cycle": ref, "team": "ENG"}))
		if len(got) != 1 || got[0] != str(t, planned, "identifier") {
			t.Fatalf("cycle %q returned %v", ref, got)
		}
	}

	_, err := h.callAs(h.p, "list_issues", map[string]any{"cycle": "99", "team": "ENG"})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
}

func TestResolveProjectAndMilestone_ByUUIDAndName(t *testing.T) {
	h := newHarness(t)
	project := h.object("create_project", map[string]any{"name": "Billing v2", "teams": []any{"ENG"}})
	milestone, _, err := h.svc.CreateProjectMilestone(h.ctx, h.p, domain.CreateProjectMilestoneInput{
		ProjectID: mustUUID(t, str(t, project, "id")), Name: "Beta",
	})
	if err != nil {
		t.Fatalf("milestone: %v", err)
	}

	for _, ref := range []string{str(t, project, "id"), "Billing v2", "billing v2"} {
		got := h.object("get_project", map[string]any{"id": ref})
		if str(t, got, "id") != str(t, project, "id") {
			t.Fatalf("project %q resolved to %v", ref, got["id"])
		}
	}

	issue := h.newIssue("Planned")
	for _, ref := range []string{milestone.ID.String(), "Beta", "beta"} {
		got := h.object("add_issue_to_project", map[string]any{
			"id": str(t, issue, "identifier"), "project": "Billing v2", "milestone": ref,
		})
		if str(t, got, "projectMilestoneId") != milestone.ID.String() {
			t.Fatalf("milestone %q resolved to %v", ref, got["projectMilestoneId"])
		}
	}

	_, err = h.callAs(h.p, "get_project", map[string]any{"id": "No Such Project"})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
	_, err = h.callAs(h.p, "add_issue_to_project", map[string]any{
		"id": str(t, issue, "identifier"), "project": "Billing v2", "milestone": "Gamma",
	})
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
}

// Nothing in this package elevates. A principal who cannot reach a team gets the answer a
// missing row gets, which is what stops a tool call from confirming that an issue exists.
func TestTools_RefuseAPrincipalWhoCannotReachTheTeam(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Not yours")
	comment := h.object("create_comment", map[string]any{
		"id": str(t, issue, "identifier"), "body": "internal",
	})

	outsiderID := h.f.NewUser(t, "outsider", "member", false)
	outsider := h.f.PrincipalFor(outsiderID, authz.RoleMember)

	if teams, err := h.callAs(outsider, "list_teams", nil); err != nil {
		t.Fatalf("list_teams: %v", err)
	} else if rows, _ := teams.([]map[string]any); len(rows) != 0 {
		t.Fatalf("an outsider saw %v", rows)
	}
	if issues, err := h.callAs(outsider, "list_issues", nil); err != nil {
		t.Fatalf("list_issues: %v", err)
	} else if rows, _ := issues.([]map[string]any); len(rows) != 0 {
		t.Fatalf("an outsider saw %v", rows)
	}

	denied := []struct {
		name string
		args map[string]any
	}{
		{"get_issue", map[string]any{"id": str(t, issue, "identifier")}},
		{"list_comments", map[string]any{"id": str(t, issue, "identifier")}},
		{"create_issue", map[string]any{"title": "sneaky", "team": "ENG"}},
		{"create_comment", map[string]any{"id": str(t, issue, "identifier"), "body": "hello"}},
		{"update_issue", map[string]any{"id": str(t, issue, "identifier"), "title": "hijacked"}},
		{"assign_issue", map[string]any{"id": str(t, issue, "identifier"), "assignee": "dev"}},
		{"set_issue_state", map[string]any{"id": str(t, issue, "identifier"), "state": "Done"}},
		{"archive_issue", map[string]any{"id": str(t, issue, "identifier")}},
		{"update_comment", map[string]any{"id": str(t, comment, "id"), "body": "edited"}},
		{"delete_comment", map[string]any{"id": str(t, comment, "id")}},
		{"add_reaction", map[string]any{"id": str(t, comment, "id"), "emoji": "👍"}},
		{"list_workflow_states", map[string]any{"team": "ENG"}},
		{"list_cycles", map[string]any{"team": "ENG"}},
	}
	for _, c := range denied {
		out, err := h.callAs(outsider, c.name, c.args)
		if err == nil {
			t.Errorf("%s succeeded for an outsider and returned %v", c.name, out)
			continue
		}
		if code := platform.CodeOf(err); code != platform.CodeNotFound && code != platform.CodeForbidden {
			t.Errorf("%s failed with %v (%s), want not-found or forbidden", c.name, err, code)
		}
	}

	// The issue is untouched: the refusals above were refusals, not partial writes.
	after := h.object("get_issue", map[string]any{"id": str(t, issue, "identifier")})
	if after["title"] != "Not yours" {
		t.Fatalf("the issue changed under a denied caller: %v", after)
	}
}

// A guest is scoped rather than weakened — they work normally inside a team they belong to,
// but shaping the workspace is not theirs to do.
func TestCreateProject_RefusesAGuestInsideTheirOwnTeam(t *testing.T) {
	h := newHarness(t)
	guestID := h.f.NewUser(t, "guest", "guest", true)
	guest := h.f.PrincipalFor(guestID, authz.RoleGuest, h.f.TeamID)

	// The same guest may file an issue, so the refusal below is about the action and not
	// about the guest being unable to see anything.
	if _, err := h.callAs(guest, "create_issue", map[string]any{"title": "A guest's bug", "team": "ENG"}); err != nil {
		t.Fatalf("a guest in the team should be able to file an issue: %v", err)
	}

	out, err := h.callAs(guest, "create_project", map[string]any{"name": "Guest plan", "teams": []any{"ENG"}})
	if err == nil {
		t.Fatalf("a guest created a project: %v", out)
	}
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("got %v, want forbidden", err)
	}
}
