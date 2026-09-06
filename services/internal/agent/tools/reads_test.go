package tools_test

import (
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

func TestGetViewer_NamesTheCallerAndTheirWorkspace(t *testing.T) {
	h := newHarness(t)

	got := h.object("get_viewer", nil)
	if str(t, got, "userId") != h.f.UserID.String() {
		t.Fatalf("userId = %v, want %v", got["userId"], h.f.UserID)
	}
	if str(t, got, "workspaceId") != h.f.WorkspaceID.String() {
		t.Fatalf("workspaceId = %v, want %v", got["workspaceId"], h.f.WorkspaceID)
	}
	if str(t, got, "role") != "owner" {
		t.Fatalf("role = %v, want owner", got["role"])
	}
}

func TestListTeams_ReturnsTheKeyAgentsWillPassBack(t *testing.T) {
	h := newHarness(t)

	teams := h.list("list_teams", nil)
	if len(teams) != 1 {
		t.Fatalf("got %d teams, want 1", len(teams))
	}
	if str(t, teams[0], "key") != "ENG" || str(t, teams[0], "id") != h.f.TeamID.String() {
		t.Fatalf("team = %v", teams[0])
	}
}

func TestListUsers_IncludesTheFixtureMember(t *testing.T) {
	h := newHarness(t)

	users := h.list("list_users", nil)
	found := false
	for _, u := range users {
		if str(t, u, "id") == h.f.UserID.String() {
			found = true
			if str(t, u, "displayName") != "dev" {
				t.Fatalf("displayName = %v, want dev", u["displayName"])
			}
		}
	}
	if !found {
		t.Fatalf("the fixture's own user is missing from %v", users)
	}
}

func TestListWorkflowStates_ResolvesTheTeamByKey(t *testing.T) {
	h := newHarness(t)

	states := h.list("list_workflow_states", map[string]any{"team": "ENG"})
	if len(states) != 5 {
		t.Fatalf("got %d states, want the 5 seeded ones: %v", len(states), states)
	}
	byName := map[string]map[string]any{}
	for _, st := range states {
		byName[str(t, st, "name")] = st
	}
	backlog, ok := byName["Backlog"]
	if !ok {
		t.Fatalf("no Backlog state in %v", states)
	}
	if backlog["isDefault"] != true || str(t, backlog, "category") != "backlog" {
		t.Fatalf("Backlog = %v", backlog)
	}
}

func TestListLabels_KeepsWorkspaceLabelsInATeamNarrowedListing(t *testing.T) {
	h := newHarness(t)

	if _, _, err := h.svc.CreateLabel(h.ctx, h.p, domain.CreateLabelInput{Name: "bug"}); err != nil {
		t.Fatalf("workspace label: %v", err)
	}
	if _, _, err := h.svc.CreateLabel(h.ctx, h.p, domain.CreateLabelInput{
		Name: "flaky", TeamID: &h.f.TeamID,
	}); err != nil {
		t.Fatalf("team label: %v", err)
	}

	all := h.list("list_labels", nil)
	if len(all) != 2 {
		t.Fatalf("got %d labels, want 2: %v", len(all), all)
	}

	// A workspace label is one of the labels the team can apply, so narrowing by team
	// must not hide it.
	narrowed := h.list("list_labels", map[string]any{"team": "ENG"})
	if len(narrowed) != 2 {
		t.Fatalf("narrowed to %d labels, want 2 (the team's plus the workspace's): %v", len(narrowed), narrowed)
	}
}

func TestListCycles_ReturnsTheCadenceEnablingATeamCreated(t *testing.T) {
	h := newHarness(t)
	enableCycles(t, h)

	cycles := h.list("list_cycles", map[string]any{"team": "ENG"})
	if len(cycles) != 3 {
		t.Fatalf("got %d cycles, want current + 2 upcoming: %v", len(cycles), cycles)
	}
	if cycles[0]["number"] != 1 {
		t.Fatalf("first cycle number = %v, want 1", cycles[0]["number"])
	}
}

func TestGetIssue_TakesAUUIDOrAnIdentifier(t *testing.T) {
	h := newHarness(t)
	created := h.newIssue("Login is broken")

	byUUID := h.object("get_issue", map[string]any{"id": str(t, created, "id")})
	byIdentifier := h.object("get_issue", map[string]any{"id": str(t, created, "identifier")})

	if str(t, byUUID, "id") != str(t, byIdentifier, "id") {
		t.Fatalf("the two refs found different issues: %v and %v", byUUID, byIdentifier)
	}
	if str(t, byUUID, "url") != "/issue/"+str(t, created, "identifier") {
		t.Fatalf("url = %v", byUUID["url"])
	}
}

func TestListComments_ReturnsWhatWasWritten(t *testing.T) {
	h := newHarness(t)
	issue := h.newIssue("Needs a decision")

	h.call("create_comment", map[string]any{"id": str(t, issue, "identifier"), "body": "Shipping Friday."})

	comments := h.list("list_comments", map[string]any{"id": str(t, issue, "identifier")})
	if len(comments) != 1 {
		t.Fatalf("got %d comments, want 1", len(comments))
	}
	if comments[0]["body"] != "Shipping Friday." {
		t.Fatalf("body = %v", comments[0]["body"])
	}
	if str(t, comments[0], "issueId") != str(t, issue, "id") {
		t.Fatalf("comment landed on %v, want %v", comments[0]["issueId"], issue["id"])
	}
}

func TestListMyIssues_HidesCompletedUnlessAsked(t *testing.T) {
	h := newHarness(t)

	mine := h.newIssue("Mine")
	h.call("assign_issue", map[string]any{"id": str(t, mine, "identifier"), "assignee": "me"})
	done := h.newIssue("Mine and finished")
	h.call("assign_issue", map[string]any{"id": str(t, done, "identifier"), "assignee": "me"})
	h.call("set_issue_state", map[string]any{"id": str(t, done, "identifier"), "state": "Done"})
	h.newIssue("Somebody else's")

	open := identifiers(h.list("list_my_issues", nil))
	if !contains(open, str(t, mine, "identifier")) {
		t.Fatalf("my open issue is missing from %v", open)
	}
	if contains(open, str(t, done, "identifier")) {
		t.Fatalf("a completed issue leaked into the default listing: %v", open)
	}

	all := identifiers(h.list("list_my_issues", map[string]any{"includeCompleted": true}))
	if !contains(all, str(t, done, "identifier")) {
		t.Fatalf("includeCompleted did not bring the done issue back: %v", all)
	}
}

func TestListIssues_ReturnsWhatWasFiledAndHonoursTheLimit(t *testing.T) {
	h := newHarness(t)
	for _, title := range []string{"One", "Two", "Three"} {
		h.newIssue(title)
	}

	all := h.list("list_issues", nil)
	if len(all) != 3 {
		t.Fatalf("got %d issues, want 3: %v", len(all), identifiers(all))
	}
	if got := h.list("list_issues", map[string]any{"limit": 2}); len(got) != 2 {
		t.Fatalf("limit 2 returned %d", len(got))
	}
	// Models send numbers as strings often enough that the coercion is part of the
	// contract, not a convenience.
	if got := h.list("list_issues", map[string]any{"limit": "1"}); len(got) != 1 {
		t.Fatalf(`limit "1" returned %d`, len(got))
	}
	if got := h.list("list_issues", map[string]any{"team": "ENG"}); len(got) != 3 {
		t.Fatalf("narrowing to the only team returned %d", len(got))
	}
}

func TestListIssues_SearchesTitles(t *testing.T) {
	h := newHarness(t)
	h.newIssue("Checkout crashes on Safari")
	h.newIssue("Invoice PDF is blank")

	got := h.list("list_issues", map[string]any{"query": "checkout"})
	if len(got) != 1 || got[0]["title"] != "Checkout crashes on Safari" {
		t.Fatalf("search returned %v", got)
	}
}

func TestListIssues_FiltersByState(t *testing.T) {
	h := newHarness(t)
	moving := h.newIssue("Being worked on")
	h.newIssue("Still in the backlog")
	h.call("set_issue_state", map[string]any{"id": str(t, moving, "identifier"), "state": "In Progress"})

	byName := identifiers(h.list("list_issues", map[string]any{"state": "In Progress"}))
	if len(byName) != 1 || byName[0] != str(t, moving, "identifier") {
		t.Fatalf("state by name returned %v", byName)
	}
	// A category is the ref an agent reaches for when it does not know a team's column
	// names, and it has to find the same row.
	byCategory := identifiers(h.list("list_issues", map[string]any{"state": "started"}))
	if len(byCategory) != 1 || byCategory[0] != str(t, moving, "identifier") {
		t.Fatalf("state by category returned %v", byCategory)
	}
}

func TestListIssues_FiltersByAssignee(t *testing.T) {
	h := newHarness(t)
	mine := h.newIssue("Assigned to me")
	loose := h.newIssue("Nobody's")
	h.call("assign_issue", map[string]any{"id": str(t, mine, "identifier"), "assignee": "me"})

	got := identifiers(h.list("list_issues", map[string]any{"assignee": "dev"}))
	if len(got) != 1 || got[0] != str(t, mine, "identifier") {
		t.Fatalf("assignee by display name returned %v", got)
	}
	unassigned := identifiers(h.list("list_issues", map[string]any{"assignee": "none"}))
	if len(unassigned) != 1 || unassigned[0] != str(t, loose, "identifier") {
		t.Fatalf("assignee none returned %v", unassigned)
	}
}

func TestListIssues_FiltersByLabel(t *testing.T) {
	h := newHarness(t)
	labelled := h.newIssue("A real bug")
	h.newIssue("Not a bug")
	if _, _, err := h.svc.CreateLabel(h.ctx, h.p, domain.CreateLabelInput{Name: "bug"}); err != nil {
		t.Fatalf("label: %v", err)
	}
	h.call("set_issue_labels", map[string]any{"id": str(t, labelled, "identifier"), "labels": []any{"bug"}})

	got := identifiers(h.list("list_issues", map[string]any{"label": "bug"}))
	if len(got) != 1 || got[0] != str(t, labelled, "identifier") {
		t.Fatalf("label filter returned %v", got)
	}
}

func TestListIssues_FiltersByCycle(t *testing.T) {
	h := newHarness(t)
	enableCycles(t, h)
	cycles := h.list("list_cycles", map[string]any{"team": "ENG"})

	planned := h.newIssue("In the cycle")
	h.newIssue("Out of it")
	if _, _, err := h.svc.UpdateIssue(h.ctx, h.p, domain.UpdateIssueInput{
		ID:      mustUUID(t, str(t, planned, "id")),
		CycleID: ptr(mustUUID(t, str(t, cycles[0], "id"))),
	}); err != nil {
		t.Fatalf("put the issue in a cycle: %v", err)
	}

	byNumber := identifiers(h.list("list_issues", map[string]any{"cycle": "1", "team": "ENG"}))
	if len(byNumber) != 1 || byNumber[0] != str(t, planned, "identifier") {
		t.Fatalf("cycle by number returned %v", byNumber)
	}
}

// A filter that names nothing anywhere is a typo, and an empty list would hide it.
func TestListIssues_RefusesAFilterThatMatchesNoState(t *testing.T) {
	h := newHarness(t)
	h.newIssue("Something to find")

	_, err := h.callAs(h.p, "list_issues", map[string]any{"state": "Blocked On Legal"})
	if err == nil {
		t.Fatal("a state nobody has should not come back as an empty list")
	}
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("got %v, want not-found", err)
	}
}

func TestGetProject_AndListMilestones(t *testing.T) {
	h := newHarness(t)
	created := h.object("create_project", map[string]any{
		"name": "Billing v2", "teams": []any{"ENG"}, "summary": "Rewrite invoicing",
	})

	byName := h.object("get_project", map[string]any{"id": "Billing v2"})
	if str(t, byName, "id") != str(t, created, "id") {
		t.Fatalf("get_project by name found %v, want %v", byName["id"], created["id"])
	}
	if byName["summary"] != "Rewrite invoicing" {
		t.Fatalf("summary = %v", byName["summary"])
	}

	if _, _, err := h.svc.CreateProjectMilestone(h.ctx, h.p, domain.CreateProjectMilestoneInput{
		ProjectID: mustUUID(t, str(t, created, "id")), Name: "Beta",
	}); err != nil {
		t.Fatalf("milestone: %v", err)
	}
	milestones := h.list("list_milestones", map[string]any{"project": "Billing v2"})
	if len(milestones) != 1 || milestones[0]["name"] != "Beta" {
		t.Fatalf("milestones = %v", milestones)
	}
}

func TestListProjects_ReturnsTheProjectsCreated(t *testing.T) {
	h := newHarness(t)
	h.call("create_project", map[string]any{"name": "Billing v2", "teams": []any{"ENG"}})

	projects := h.list("list_projects", nil)
	if len(projects) != 1 || projects[0]["name"] != "Billing v2" {
		t.Fatalf("projects = %v", projects)
	}
}

func enableCycles(t *testing.T, h *harness) {
	t.Helper()
	enabled, duration, cooldown, upcoming, start := true, 2, 0, 2, "monday"
	if _, _, err := h.svc.UpdateTeamCycles(h.ctx, h.p, domain.UpdateTeamCyclesInput{
		TeamID:        h.f.TeamID,
		Enabled:       &enabled,
		DurationWeeks: &duration,
		CooldownWeeks: &cooldown,
		StartDay:      &start,
		UpcomingCount: &upcoming,
	}); err != nil {
		t.Fatalf("enable cycles: %v", err)
	}
}
