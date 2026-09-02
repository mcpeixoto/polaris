package graph

import (
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

// Four fields that were in the schema and populated by nothing.
//
// The parity harness in this package enforces name-level parity — every model field has a
// GraphQL field — and cannot see behaviour, so a converter that sets fifteen fields and
// omits the sixteenth passes every gate. Two of these are NON-NULL, which is the difference
// between a field that reads empty and a query that comes back `data: null`.
//
// Each test drives the real executor through the harness, so what is asserted is what a
// client receives rather than what a Go call returns.

func TestIssueRelation_BothEndsResolve(t *testing.T) {
	h := newHarness(t)

	blocker := h.f.NewIssue(t, "The blocker")
	blocked := h.f.NewIssue(t, "The blocked one")

	if _, _, err := h.Svc.CreateIssueRelation(h.ctx, h.f.Principal(), blocker, blocked, "blocks"); err != nil {
		t.Fatalf("create the relation: %v", err)
	}

	// `issue: Issue!` and `relatedIssue: Issue!`. The converter set neither, and there are
	// no field resolvers on IssueRelation — so the generated code read the struct directly
	// and marshalled nil into a non-null position, which nulls the CONTAINING issue.
	body := h.execute(t, `query ($id: UUID!) {
		issue(id: $id) {
			id
			relations {
				type
				issue { id title }
				relatedIssue { id title }
			}
		}
	}`, map[string]any{"id": blocker.String()})

	if errs, ok := body["errors"]; ok {
		t.Fatalf("the query errored: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	issue, _ := data["issue"].(map[string]any)
	if issue == nil {
		t.Fatalf("data.issue is null — the non-null relation fields failed the whole issue: %v", body)
	}
	relations, _ := issue["relations"].([]any)
	if len(relations) != 1 {
		t.Fatalf("expected 1 relation, got %d: %v", len(relations), issue["relations"])
	}
	rel, _ := relations[0].(map[string]any)

	near, _ := rel["issue"].(map[string]any)
	far, _ := rel["relatedIssue"].(map[string]any)
	if near == nil || near["id"] != blocker.String() {
		t.Errorf("relation.issue = %v, want the blocker %s", rel["issue"], blocker)
	}
	if far == nil || far["id"] != blocked.String() {
		t.Errorf("relation.relatedIssue = %v, want the blocked issue %s", rel["relatedIssue"], blocked)
	}
	if far != nil && far["title"] != "The blocked one" {
		t.Errorf("relatedIssue.title = %v, want the far issue's own title", far["title"])
	}
}

func TestNotification_IssueIsPopulated(t *testing.T) {
	h := newHarness(t)
	p := h.f.Principal()

	// A second member, so the actor and the recipient are different people: a
	// notification is not raised for the person who caused it.
	other := h.f.NewUser(t, "Other", "member", true)
	otherP := h.f.PrincipalFor(other, h.f.Principal().Role, h.f.TeamID)

	issueID := h.f.NewIssue(t, "Something to talk about")
	if _, _, err := h.Svc.SetIssueSubscription(h.ctx, p, issueID, true); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if _, _, err := h.Svc.CreateComment(h.ctx, otherP, domain.CreateCommentInput{
		IssueID: issueID, Body: "a comment",
	}); err != nil {
		t.Fatalf("comment as somebody else: %v", err)
	}
	// The inbox is written by a worker pass, not by the write that caused it.
	if _, err := h.Svc.FanOut(h.ctx, h.f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	body := h.execute(t, `{ notifications(includeRead: true) { id issueId issue { id title } } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("the query errored: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	rows, _ := data["notifications"].([]any)
	if len(rows) == 0 {
		t.Fatalf("no notifications were raised: %v", body)
	}

	// Nullable, so this failed silently: the inbox rendered "unknown issue" and the client
	// was pushed into one issue(id:) round trip per row.
	found := false
	for _, raw := range rows {
		row, _ := raw.(map[string]any)
		if row["issueId"] == nil {
			continue
		}
		found = true
		issue, _ := row["issue"].(map[string]any)
		if issue == nil {
			t.Fatalf("notification %v names issue %v and Notification.issue is null", row["id"], row["issueId"])
		}
		if issue["id"] != row["issueId"] {
			t.Errorf("notification.issue.id = %v, want %v", issue["id"], row["issueId"])
		}
		if issue["title"] != "Something to talk about" {
			t.Errorf("notification.issue.title = %v", issue["title"])
		}
	}
	if !found {
		t.Fatal("no notification named an issue, so the field under test was never exercised")
	}
}

func TestInitiative_ProjectsResolveRatherThanNullingTheField(t *testing.T) {
	h := newHarness(t)
	p := h.f.Principal()

	init, _, err := h.Svc.CreateInitiative(h.ctx, p, domain.CreateInitiativeInput{Name: "Q3 platform"})
	if err != nil {
		t.Fatalf("create the initiative: %v", err)
	}
	project, _, err := h.Svc.CreateProject(h.ctx, p, domain.CreateProjectInput{
		Name: "Sync rewrite", TeamIDs: []uuid.UUID{h.f.TeamID},
	})
	if err != nil {
		t.Fatalf("create the project: %v", err)
	}
	if _, _, err := h.Svc.AddInitiativeProject(h.ctx, p, init.ID, project.ID); err != nil {
		t.Fatalf("link the project: %v", err)
	}

	// `projects: [InitiativeProject!]!`. A nil slice in a non-null position does not read
	// as an empty list — gqlgen fails the whole field, so the client received data: null.
	body := h.execute(t, `{ initiatives { id name projects { projectId project { id name } } } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("the query errored: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	rows, _ := data["initiatives"].([]any)
	if len(rows) != 1 {
		t.Fatalf("expected 1 initiative, got %d: %v", len(rows), body)
	}
	row, _ := rows[0].(map[string]any)
	projects, _ := row["projects"].([]any)
	if len(projects) != 1 {
		t.Fatalf("initiative.projects = %v, want the one link", row["projects"])
	}
	link, _ := projects[0].(map[string]any)
	if link["projectId"] != project.ID.String() {
		t.Errorf("projects[0].projectId = %v, want %s", link["projectId"], project.ID)
	}
	// InitiativeProject.project is non-null too — the same failure one level down.
	nested, _ := link["project"].(map[string]any)
	if nested == nil || nested["name"] != "Sync rewrite" {
		t.Errorf("projects[0].project = %v, want the project it points at", link["project"])
	}
}

// An initiative with no links must return an empty list, not null and not an error: the
// field is non-null, and "no projects yet" is an ordinary state.
func TestInitiative_ProjectsIsEmptyRatherThanNull(t *testing.T) {
	h := newHarness(t)

	if _, _, err := h.Svc.CreateInitiative(h.ctx, h.f.Principal(), domain.CreateInitiativeInput{
		Name: "Nothing linked",
	}); err != nil {
		t.Fatalf("create the initiative: %v", err)
	}

	body := h.execute(t, `{ initiatives { id projects { projectId } } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("the query errored: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	rows, _ := data["initiatives"].([]any)
	if len(rows) != 1 {
		t.Fatalf("expected 1 initiative, got %d", len(rows))
	}
	row, _ := rows[0].(map[string]any)
	projects, ok := row["projects"].([]any)
	if !ok {
		t.Fatalf("initiative.projects = %v (%T), want an empty list", row["projects"], row["projects"])
	}
	if len(projects) != 0 {
		t.Fatalf("expected no links, got %d", len(projects))
	}
}

// hydrateProjects took no selection, so it ran ListProjectTeams, ListProjectMembers and
// ListProjectMilestones for every project whether or not the query named them: on a
// two-hundred-project workspace `{ projects { id name } }` issued six hundred queries and
// returned none of what they read.
//
// The property asserted is the visible half — a query that names them still gets them, one
// that does not still gets a correct answer — because the query count itself is not
// observable from here. What makes the gate real is that the fields are now behind
// sel.has(), so removing the parameter breaks compilation rather than only performance.
func TestProject_HydratesOnlyWhatTheQueryNames(t *testing.T) {
	h := newHarness(t)
	p := h.f.Principal()

	project, _, err := h.Svc.CreateProject(h.ctx, p, domain.CreateProjectInput{
		Name: "Sync rewrite", TeamIDs: []uuid.UUID{h.f.TeamID},
	})
	if err != nil {
		t.Fatalf("create the project: %v", err)
	}

	// Named: they must be there.
	body := h.execute(t, `{ projects { id name teams { teamId } members { userId } milestones { id } } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("the query errored: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	rows, _ := data["projects"].([]any)
	if len(rows) != 1 {
		t.Fatalf("expected 1 project, got %d: %v", len(rows), body)
	}
	row, _ := rows[0].(map[string]any)
	teams, _ := row["teams"].([]any)
	if len(teams) != 1 {
		t.Fatalf("project.teams = %v, want the one team it was created with", row["teams"])
	}
	if _, ok := row["members"].([]any); !ok {
		t.Errorf("project.members = %v, want a list", row["members"])
	}
	if _, ok := row["milestones"].([]any); !ok {
		t.Errorf("project.milestones = %v, want a list", row["milestones"])
	}

	// Not named: the query still answers, and answers correctly.
	body = h.execute(t, `{ projects { id name } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("the narrow query errored: %v", errs)
	}
	data, _ = body["data"].(map[string]any)
	rows, _ = data["projects"].([]any)
	if len(rows) != 1 {
		t.Fatalf("expected 1 project, got %d", len(rows))
	}
	row, _ = rows[0].(map[string]any)
	if row["id"] != project.ID.String() || row["name"] != "Sync rewrite" {
		t.Errorf("the narrow query returned %v", row)
	}
}
