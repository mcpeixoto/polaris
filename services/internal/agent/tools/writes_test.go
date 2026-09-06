package tools_test

import (
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

func TestCreateIssue_FilesIntoTheTeamNamedByKey(t *testing.T) {
	h := newHarness(t)

	got := h.object("create_issue", map[string]any{
		"title": "Checkout crashes", "team": "ENG",
		"description": "On Safari 17.", "priority": 2,
	})
	if got["title"] != "Checkout crashes" || got["priority"] != 2 {
		t.Fatalf("issue = %v", got)
	}
	if str(t, got, "identifier") != "ENG-1" {
		t.Fatalf("identifier = %v, want ENG-1", got["identifier"])
	}
	if str(t, got, "teamId") != h.f.TeamID.String() {
		t.Fatalf("teamId = %v", got["teamId"])
	}
	if got["description"] != "On Safari 17." {
		t.Fatalf("description = %v", got["description"])
	}
}

func TestUpdateIssue_ChangesOnlyWhatWasSent(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Original title")

	got := h.object("update_issue", map[string]any{
		"id": str(t, issue, "identifier"), "title": "Better title",
	})
	if got["title"] != "Better title" {
		t.Fatalf("title = %v", got["title"])
	}
	if got["priority"] != 0 {
		t.Fatalf("priority moved to %v without being asked", got["priority"])
	}

	got = h.object("update_issue", map[string]any{"id": str(t, issue, "id"), "priority": 1})
	if got["priority"] != 1 || got["title"] != "Better title" {
		t.Fatalf("issue = %v", got)
	}
}

func TestAssignIssue_AssignsAndThenUnassigns(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Needs an owner")

	got := h.object("assign_issue", map[string]any{
		"id": str(t, issue, "identifier"), "assignee": "me",
	})
	if str(t, got, "assigneeId") != h.f.UserID.String() {
		t.Fatalf("assigneeId = %v, want %v", got["assigneeId"], h.f.UserID)
	}

	// Omitting the assignee is the unassign. Nil would be indistinguishable from "leave
	// it alone", which is the bug the domain's three-state input exists to prevent.
	got = h.object("assign_issue", map[string]any{"id": str(t, issue, "identifier")})
	if _, ok := got["assigneeId"]; ok {
		t.Fatalf("issue is still assigned: %v", got)
	}
}

func TestSetIssueState_MovesByNameAndByCategory(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Moving along")

	got := h.object("set_issue_state", map[string]any{
		"id": str(t, issue, "identifier"), "state": "In Progress",
	})
	if str(t, got, "stateId") != h.f.InProgress.String() {
		t.Fatalf("stateId = %v, want In Progress", got["stateId"])
	}

	got = h.object("set_issue_state", map[string]any{
		"id": str(t, issue, "identifier"), "state": "completed",
	})
	if str(t, got, "stateId") != h.f.Done.String() {
		t.Fatalf("stateId = %v, want Done", got["stateId"])
	}
}

func TestSetIssueLabels_ReplacesTheWholeSet(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Labelled")
	for _, name := range []string{"bug", "regression"} {
		if _, _, err := h.svc.CreateLabel(h.ctx, h.p, domain.CreateLabelInput{Name: name}); err != nil {
			t.Fatalf("label %s: %v", name, err)
		}
	}

	h.call("set_issue_labels", map[string]any{
		"id": str(t, issue, "identifier"), "labels": []any{"bug", "regression"},
	})
	if got := labelNames(t, h, issue); len(got) != 2 {
		t.Fatalf("applied %v, want both", got)
	}

	// The second call is the whole set, not an addition: "regression" has to come off.
	got := h.object("set_issue_labels", map[string]any{
		"id": str(t, issue, "identifier"), "labels": []any{"bug"},
	})
	if ids, ok := got["labelIds"].([]string); !ok || len(ids) != 1 {
		t.Fatalf("labelIds = %v", got["labelIds"])
	}
	names := labelNames(t, h, issue)
	if len(names) != 1 || names[0] != "bug" {
		t.Fatalf("applied %v, want just bug", names)
	}

	h.call("set_issue_labels", map[string]any{"id": str(t, issue, "identifier"), "labels": []any{}})
	if got := labelNames(t, h, issue); len(got) != 0 {
		t.Fatalf("an empty set left %v behind", got)
	}
}

func TestSetIssueEstimate_SetsAndClears(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Sized")

	got := h.object("set_issue_estimate", map[string]any{
		"id": str(t, issue, "identifier"), "estimate": 3,
	})
	if got["estimate"] != 3 {
		t.Fatalf("estimate = %v, want 3", got["estimate"])
	}

	// Unestimated is not an estimate of zero, so the absence has to remove the key.
	got = h.object("set_issue_estimate", map[string]any{"id": str(t, issue, "identifier")})
	if _, ok := got["estimate"]; ok {
		t.Fatalf("estimate survived the clear: %v", got)
	}

	// Zero is a real estimate on a team that allows it, and must not be read as absence.
	got = h.object("set_issue_estimate", map[string]any{
		"id": str(t, issue, "identifier"), "estimate": 0,
	})
	if got["estimate"] != 0 {
		t.Fatalf("estimate 0 came back as %v", got["estimate"])
	}
}

func TestSetIssueDueDate_SetsClearsAndRefusesRubbish(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Due someday")

	got := h.object("set_issue_due_date", map[string]any{
		"id": str(t, issue, "identifier"), "dueDate": "2030-01-15",
	})
	if got["dueDate"] != "2030-01-15" {
		t.Fatalf("dueDate = %v", got["dueDate"])
	}

	got = h.object("set_issue_due_date", map[string]any{"id": str(t, issue, "identifier")})
	if _, ok := got["dueDate"]; ok {
		t.Fatalf("dueDate survived the clear: %v", got)
	}

	// The domain owns the format; the tool must not swallow or restate its complaint.
	_, err := h.callAs(h.p, "set_issue_due_date", map[string]any{
		"id": str(t, issue, "identifier"), "dueDate": "next Tuesday",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want a validation error", err)
	}
}

func TestCreateSubIssue_InheritsTheParentsTeam(t *testing.T) {
	h := newHarness(t)
	parent := h.newIssue("Ship the redesign")

	got := h.object("create_sub_issue", map[string]any{
		"parent": str(t, parent, "identifier"), "title": "Update the nav",
		"assignee": "me",
	})
	if str(t, got, "parentId") != str(t, parent, "id") {
		t.Fatalf("parentId = %v, want %v", got["parentId"], parent["id"])
	}
	if str(t, got, "teamId") != h.f.TeamID.String() {
		t.Fatalf("teamId = %v", got["teamId"])
	}
	if str(t, got, "assigneeId") != h.f.UserID.String() {
		t.Fatalf("assigneeId = %v", got["assigneeId"])
	}
}

func TestLinkIssues_RecordsTheRelation(t *testing.T) {
	h := newHarness(t)
	blocker := h.newIssue("Migrate the schema")
	blocked := h.newIssue("Ship the feature")

	got := h.object("link_issues", map[string]any{
		"id": str(t, blocker, "identifier"), "relatedId": str(t, blocked, "identifier"),
		"type": "blocks",
	})
	if got["type"] != "blocks" {
		t.Fatalf("type = %v", got["type"])
	}
	if str(t, got, "issueId") != str(t, blocker, "id") || str(t, got, "relatedIssueId") != str(t, blocked, "id") {
		t.Fatalf("relation = %v", got)
	}

	_, err := h.callAs(h.p, "link_issues", map[string]any{
		"id": str(t, blocker, "identifier"), "relatedId": str(t, blocked, "identifier"),
		"type": "supersedes",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want a validation error for an unknown relation type", err)
	}
}

func TestArchiveIssue_ArchivesAndRestores(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Done with this")

	got := h.object("archive_issue", map[string]any{"id": str(t, issue, "identifier")})
	if got["archived"] != true {
		t.Fatalf("archive returned %v", got)
	}
	if listed := identifiers(h.list("list_issues", nil)); contains(listed, str(t, issue, "identifier")) {
		t.Fatalf("an archived issue is still in the default listing: %v", listed)
	}

	got = h.object("archive_issue", map[string]any{
		"id": str(t, issue, "identifier"), "archived": false,
	})
	if got["archived"] != false {
		t.Fatalf("restore returned %v", got)
	}
	if listed := identifiers(h.list("list_issues", nil)); !contains(listed, str(t, issue, "identifier")) {
		t.Fatalf("a restored issue is missing from %v", listed)
	}
}

func TestAddIssueToProject_PlacesTheIssueAndItsMilestone(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Part of the plan")
	project := h.object("create_project", map[string]any{"name": "Billing v2", "teams": []any{"ENG"}})
	if _, _, err := h.svc.CreateProjectMilestone(h.ctx, h.p, domain.CreateProjectMilestoneInput{
		ProjectID: mustUUID(t, str(t, project, "id")), Name: "Beta",
	}); err != nil {
		t.Fatalf("milestone: %v", err)
	}

	got := h.object("add_issue_to_project", map[string]any{
		"id": str(t, issue, "identifier"), "project": "Billing v2", "milestone": "Beta",
	})
	if str(t, got, "projectId") != str(t, project, "id") {
		t.Fatalf("projectId = %v", got["projectId"])
	}
	if _, ok := got["projectMilestoneId"]; !ok {
		t.Fatalf("milestone was not applied: %v", got)
	}
}

func TestCreateProject_NeedsATeamAndKeepsWhatItWasGiven(t *testing.T) {
	h := newHarness(t)

	got := h.object("create_project", map[string]any{
		"name": "Billing v2", "teams": []any{"ENG"},
		"summary": "Rewrite invoicing", "priority": 2, "lead": "me",
		"targetDate": "2030-03-01",
	})
	if got["name"] != "Billing v2" || got["priority"] != 2 {
		t.Fatalf("project = %v", got)
	}
	if str(t, got, "leadId") != h.f.UserID.String() {
		t.Fatalf("leadId = %v", got["leadId"])
	}
	if got["targetDate"] != "2030-03-01" {
		t.Fatalf("targetDate = %v", got["targetDate"])
	}

	// A project with no team is one nobody can open, so it is refused rather than made.
	_, err := h.callAs(h.p, "create_project", map[string]any{"name": "Orphan", "teams": []any{}})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want a validation error", err)
	}
}

func TestUpdateProject_RenamesAndClearsTheLead(t *testing.T) {
	h := newHarness(t)
	h.call("create_project", map[string]any{"name": "Billing v2", "teams": []any{"ENG"}, "lead": "me"})

	got := h.object("update_project", map[string]any{
		"id": "Billing v2", "name": "Billing v3", "priority": 1,
	})
	if got["name"] != "Billing v3" || got["priority"] != 1 {
		t.Fatalf("project = %v", got)
	}
	if str(t, got, "leadId") != h.f.UserID.String() {
		t.Fatalf("the lead was dropped by an update that never mentioned it: %v", got)
	}

	got = h.object("update_project", map[string]any{"id": "Billing v3", "lead": "none"})
	if _, ok := got["leadId"]; ok {
		t.Fatalf("lead survived the clear: %v", got)
	}
}

func TestComments_CreateEditReactAndDelete(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Discuss")

	created := h.object("create_comment", map[string]any{
		"id": str(t, issue, "identifier"), "body": "First thought.",
	})
	id := str(t, created, "id")

	edited := h.object("update_comment", map[string]any{"id": id, "body": "Second thought."})
	if edited["body"] != "Second thought." {
		t.Fatalf("body = %v", edited["body"])
	}

	reaction := h.object("add_reaction", map[string]any{"id": id, "emoji": "👍"})
	if reaction["emoji"] != "👍" || str(t, reaction, "commentId") != id {
		t.Fatalf("reaction = %v", reaction)
	}
	if str(t, reaction, "userId") != h.f.UserID.String() {
		t.Fatalf("reaction userId = %v", reaction["userId"])
	}

	deleted := h.object("delete_comment", map[string]any{"id": id})
	if deleted["deleted"] != true {
		t.Fatalf("delete returned %v", deleted)
	}
	if left := h.list("list_comments", map[string]any{"id": str(t, issue, "identifier")}); len(left) != 0 {
		t.Fatalf("the comment survived deletion: %v", left)
	}
}

// A comment has no identifier, so the only ref is a UUID — and a caller that sends an
// issue's ENG-123 by mistake has to be told, not handed a not-found from somewhere deeper.
func TestCommentTools_RefuseANonUUIDRef(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Discuss")

	for _, name := range []string{"update_comment", "delete_comment", "add_reaction"} {
		_, err := h.callAs(h.p, name, map[string]any{
			"id": str(t, issue, "identifier"), "body": "x", "emoji": "👍",
		})
		if platform.CodeOf(err) != platform.CodeValidation {
			t.Errorf("%s: got %v, want a validation error", name, err)
		}
	}
}

func labelNames(t *testing.T, h *harness, issue map[string]any) []string {
	t.Helper()
	applied, err := h.svc.ListIssueLabels(h.ctx, h.p, mustUUID(t, str(t, issue, "id")))
	if err != nil {
		t.Fatalf("list issue labels: %v", err)
	}
	all, err := h.svc.ListLabels(h.ctx, h.p)
	if err != nil {
		t.Fatalf("list labels: %v", err)
	}
	byID := map[string]string{}
	for _, l := range all {
		byID[l.ID.String()] = l.Name
	}
	out := make([]string, 0, len(applied))
	for _, a := range applied {
		out = append(out, byID[a.LabelID.String()])
	}
	return out
}
