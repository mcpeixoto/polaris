package linear_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/importer/linear"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// fakeLinear serves a small Linear workspace: two teams, one of which already exists here by
// key; three people, one of whom is a member here by email; a project, a cycle, a parent and
// its child, a closed issue, an archived one, a blocking relation and a threaded comment.
//
// Every connection is one page. Pagination itself is client_test.go's business; this file
// is about what the pages become.
type fakeLinear struct {
	bobEmail string
	requests atomic.Int64
}

var topField = regexp.MustCompile(`\{\s*(\w+)`)

func (f *fakeLinear) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.requests.Add(1)
	var req struct {
		Query string `json:"query"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	m := topField.FindStringSubmatch(req.Query)
	if m == nil {
		http.Error(w, "no field", http.StatusBadRequest)
		return
	}
	field := m[1]
	if field == "viewer" {
		writeJSON(w, map[string]any{"data": map[string]any{"viewer": map[string]any{
			"id": "lu-ada", "name": "Ada", "email": "ada@linear.example",
			"organization": map[string]any{"id": "org", "name": "Acme", "urlKey": "acme"},
		}}})
		return
	}
	nodes, ok := f.nodes()[field]
	if !ok {
		http.Error(w, "unknown field "+field, http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]any{"data": map[string]any{field: map[string]any{
		"nodes": nodes, "pageInfo": map[string]any{"hasNextPage": false, "endCursor": nil},
	}}})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func id(s string) map[string]any { return map[string]any{"id": s} }

func ids(s ...string) map[string]any {
	out := make([]any, 0, len(s))
	for _, x := range s {
		out = append(out, id(x))
	}
	return map[string]any{"nodes": out}
}

func issue(lid, ident string, number int, team, state string, extra map[string]any) map[string]any {
	out := map[string]any{
		"id": lid, "identifier": ident, "number": number, "title": "Issue " + ident,
		"description": "Body of " + ident, "priority": 0, "estimate": nil, "dueDate": nil,
		"createdAt": "2025-03-01T10:00:00Z", "completedAt": nil, "canceledAt": nil, "archivedAt": nil,
		"team": id(team), "state": id(state), "assignee": nil, "creator": id("lu-ada"),
		"labels": ids(), "project": nil, "cycle": nil, "parent": nil,
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func (f *fakeLinear) nodes() map[string][]any {
	return map[string][]any{
		"teams": {
			map[string]any{"id": "lt-eng", "key": "eng", "name": "Engineering"},
			map[string]any{"id": "lt-des", "key": "DES", "name": "Design"},
		},
		"workflowStates": {
			map[string]any{"id": "ls-eng-todo", "name": "Todo", "type": "unstarted", "color": "#e2e2e2", "position": 1, "team": id("lt-eng")},
			map[string]any{"id": "ls-eng-qa", "name": "QA", "type": "started", "color": "#aa00aa", "position": 2, "team": id("lt-eng")},
			map[string]any{"id": "ls-eng-done", "name": "Done", "type": "completed", "color": "#188a55", "position": 3, "team": id("lt-eng")},
			map[string]any{"id": "ls-des-triage", "name": "Triage", "type": "triage", "color": "#ff0000", "position": 0, "team": id("lt-des")},
			map[string]any{"id": "ls-des-backlog", "name": "Backlog", "type": "backlog", "color": "#bec2c8", "position": 1, "team": id("lt-des")},
		},
		"issueLabels": {
			map[string]any{"id": "ll-bug", "name": "Bug", "color": "#eb5757", "team": nil, "parent": nil},
			map[string]any{"id": "ll-area", "name": "Area", "color": "#4f46e5", "team": nil, "parent": nil},
			map[string]any{"id": "ll-front", "name": "Frontend", "color": "#4f46e5", "team": nil, "parent": id("ll-area")},
			map[string]any{"id": "ll-infra", "name": "Infra", "color": "#000000", "team": id("lt-eng"), "parent": nil},
		},
		"users": {
			map[string]any{"id": "lu-ada", "name": "Ada", "displayName": "ada", "email": "ada@linear.example", "active": true},
			map[string]any{"id": "lu-bob", "name": "Bob", "displayName": "bob", "email": strings.ToUpper(f.bobEmail), "active": true},
			map[string]any{"id": "lu-carl", "name": "Carl Jones", "displayName": "carl", "email": "carl@elsewhere.example", "active": true},
		},
		"projects": {
			map[string]any{"id": "lp-web", "name": "Website", "description": "The site", "state": "started",
				"startDate": "2025-01-01", "targetDate": "2025-06-30", "teams": ids("lt-eng", "lt-des"), "lead": id("lu-bob")},
		},
		"cycles": {
			map[string]any{"id": "lc-3", "number": 3, "name": "Sprint 3", "startsAt": "2025-03-03T00:00:00Z",
				"endsAt": "2025-03-17T00:00:00Z", "team": id("lt-eng")},
		},
		"issues": {
			issue("li-7", "ENG-7", 7, "lt-eng", "ls-eng-todo", map[string]any{
				"assignee": id("lu-bob"), "priority": 2, "estimate": 3.0, "dueDate": "2025-04-01",
				"labels": ids("ll-bug", "ll-front"), "project": id("lp-web"), "cycle": id("lc-3"),
			}),
			issue("li-8", "ENG-8", 8, "lt-eng", "ls-eng-qa", map[string]any{
				"assignee": id("lu-carl"), "parent": id("li-7"), "priority": 1,
			}),
			issue("li-12", "ENG-12", 12, "lt-eng", "ls-eng-done", map[string]any{
				"completedAt": "2025-03-05T12:00:00Z", "labels": ids("ll-infra"),
			}),
			issue("li-13", "ENG-13", 13, "lt-eng", "ls-eng-todo", map[string]any{
				"archivedAt": "2025-03-06T12:00:00Z",
			}),
			issue("li-d2", "DES-2", 2, "lt-des", "ls-des-triage", nil),
			issue("li-d5", "DES-5", 5, "lt-des", "ls-des-backlog", map[string]any{"project": id("lp-web")}),
		},
		"comments": {
			map[string]any{"id": "lm-1", "body": "Looks good", "createdAt": "2025-03-02T10:00:00Z",
				"user": id("lu-bob"), "issue": id("li-7"), "parent": nil},
			map[string]any{"id": "lm-2", "body": "Agreed", "createdAt": "2025-03-02T11:00:00Z",
				"user": id("lu-carl"), "issue": id("li-7"), "parent": id("lm-1")},
		},
		"issueRelations": {
			map[string]any{"id": "lr-1", "type": "blocks", "issue": id("li-d5"), "relatedIssue": id("li-7")},
		},
	}
}

type harness struct {
	t     *testing.T
	db    *store.DB
	f     *testutil.Fixture
	svc   *domain.Service
	fake  *fakeLinear
	bobID uuid.UUID
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	bobID := f.NewUser(t, "bob", "member", true)

	var email string
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT a.email FROM "user" u JOIN account a ON a.id = u.account_id WHERE u.id = $1`, bobID,
	).Scan(&email); err != nil {
		t.Fatalf("read bob's email: %v", err)
	}
	fake := &fakeLinear{bobEmail: email}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	domain.RegisterImportSource(svc, &linear.Source{BaseURL: srv.URL})
	return &harness{t: t, db: db, f: f, svc: svc, fake: fake, bobID: bobID}
}

// runImport starts a job as the fixture's owner and runs it to the end.
func (h *harness) runImport() model.ImportJob {
	h.t.Helper()
	ctx := context.Background()
	job, err := h.svc.StartLinearImport(ctx, h.f.Principal(), "lin_api_test")
	if err != nil {
		h.t.Fatalf("start import: %v", err)
	}
	ran, err := domain.RunQueuedImport(ctx, h.svc)
	if !ran {
		h.t.Fatalf("no queued import was claimed (err %v)", err)
	}
	got, gerr := h.svc.GetImportJob(ctx, h.f.Principal(), job.ID)
	if gerr != nil {
		h.t.Fatalf("get import: %v", gerr)
	}
	if err != nil && got.Status != model.ImportStatusFailed {
		h.t.Fatalf("run returned %v but the job says %q", err, got.Status)
	}
	return got
}

func (h *harness) count(query string, args ...any) int {
	h.t.Helper()
	var n int
	if err := h.db.Pool().QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		h.t.Fatalf("%s: %v", query, err)
	}
	return n
}

func (h *harness) apiKeyIsNull(jobID uuid.UUID) bool {
	h.t.Helper()
	var key *string
	if err := h.db.Pool().QueryRow(context.Background(),
		`SELECT api_key FROM import_job WHERE id = $1`, jobID).Scan(&key); err != nil {
		h.t.Fatalf("read api_key: %v", err)
	}
	return key == nil
}

type importedIssue struct {
	ID          uuid.UUID
	TeamID      uuid.UUID
	Number      int64
	Description string
	AssigneeID  *uuid.UUID
	ParentID    *uuid.UUID
	Priority    int
	Estimate    *int
	ProjectID   *uuid.UUID
	CycleID     *uuid.UUID
	Archived    bool
	Completed   bool
	CreatedYear int
	StateName   string
}

func (h *harness) issueFor(linearID string) importedIssue {
	h.t.Helper()
	var out importedIssue
	if err := h.db.Pool().QueryRow(context.Background(), `
		SELECT i.id, i.team_id, i.number, i.description, i.assignee_id, i.parent_id, i.priority,
		       i.estimate, i.project_id, i.cycle_id, i.archived_at IS NOT NULL,
		       i.completed_at IS NOT NULL, extract(year FROM i.created_at)::int, s.name
		FROM import_link l
		JOIN issue i ON i.id = l.polaris_id
		JOIN workflow_state s ON s.id = i.state_id
		WHERE l.workspace_id = $1 AND l.entity = 'issue' AND l.external_id = $2`,
		h.f.WorkspaceID, linearID,
	).Scan(&out.ID, &out.TeamID, &out.Number, &out.Description, &out.AssigneeID, &out.ParentID,
		&out.Priority, &out.Estimate, &out.ProjectID, &out.CycleID, &out.Archived, &out.Completed,
		&out.CreatedYear, &out.StateName); err != nil {
		h.t.Fatalf("imported issue %s: %v", linearID, err)
	}
	return out
}

func TestLinearImport_MapsEveryEntityAndStaysQuiet(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	var startVersion int64
	if err := h.db.Pool().QueryRow(ctx, `SELECT version FROM workspace_version WHERE workspace_id = $1`,
		h.f.WorkspaceID).Scan(&startVersion); err != nil {
		t.Fatalf("read version: %v", err)
	}

	job := h.runImport()
	if job.Status != model.ImportStatusDone {
		t.Fatalf("job status %q (error %v), want done", job.Status, job.Error)
	}
	if !h.apiKeyIsNull(job.ID) {
		t.Error("a finished import still holds the Linear key")
	}

	// Teams: ENG matched by key, case and all; DES created.
	var engID, desID uuid.UUID
	if err := h.db.Pool().QueryRow(ctx, `SELECT polaris_id FROM import_link WHERE workspace_id = $1 AND entity = 'team' AND external_id = 'lt-eng'`,
		h.f.WorkspaceID).Scan(&engID); err != nil {
		t.Fatalf("team link: %v", err)
	}
	if engID != h.f.TeamID {
		t.Errorf("Linear's eng team became %s, want the existing ENG team %s", engID, h.f.TeamID)
	}
	if err := h.db.Pool().QueryRow(ctx, `SELECT id FROM team WHERE workspace_id = $1 AND key = 'DES'`,
		h.f.WorkspaceID).Scan(&desID); err != nil {
		t.Fatalf("the DES team was not created: %v", err)
	}

	// Every entity kind has links.
	for entity, want := range map[string]int{
		"team": 2, "state": 5, "label": 4, "user": 1, "project": 1, "cycle": 1, "issue": 6, "comment": 2,
	} {
		if got := h.count(`SELECT count(*) FROM import_link WHERE workspace_id = $1 AND entity = $2`,
			h.f.WorkspaceID, entity); got != want {
			t.Errorf("%d %s links, want %d", got, entity, want)
		}
	}

	// Statuses: Todo and Done matched the seeded ones, QA was created as a started status,
	// and Linear's triage landed on DES's default because DES is not running triage.
	if got := h.count(`SELECT count(*) FROM workflow_state WHERE team_id = $1 AND name = 'QA' AND category = 'started'`,
		h.f.TeamID); got != 1 {
		t.Errorf("%d QA statuses in ENG, want 1", got)
	}
	if got := h.count(`SELECT count(*) FROM workflow_state WHERE team_id = $1 AND name = 'Todo'`, h.f.TeamID); got != 1 {
		t.Errorf("%d Todo statuses in ENG, want the seeded one alone", got)
	}

	// Issues keep their numbers, state, priority, estimate, labels, project and cycle.
	eng7 := h.issueFor("li-7")
	if eng7.TeamID != h.f.TeamID || eng7.Number != 7 {
		t.Errorf("ENG-7 imported as team %s number %d", eng7.TeamID, eng7.Number)
	}
	if eng7.AssigneeID == nil || *eng7.AssigneeID != h.bobID {
		t.Errorf("ENG-7 assignee %v, want bob (matched by email, ignoring case)", eng7.AssigneeID)
	}
	if eng7.Priority != 2 || eng7.Estimate == nil || *eng7.Estimate != 3 {
		t.Errorf("ENG-7 priority %d estimate %v, want 2 and 3", eng7.Priority, eng7.Estimate)
	}
	if eng7.ProjectID == nil || eng7.CycleID == nil {
		t.Errorf("ENG-7 project %v cycle %v, want both set", eng7.ProjectID, eng7.CycleID)
	}
	if eng7.StateName != "Todo" || eng7.CreatedYear != 2025 {
		t.Errorf("ENG-7 state %q created %d, want Todo and 2025", eng7.StateName, eng7.CreatedYear)
	}
	if got := h.count(`SELECT count(*) FROM issue_label WHERE issue_id = $1`, eng7.ID); got != 2 {
		t.Errorf("ENG-7 has %d labels, want 2", got)
	}

	// The child: parent linked, and its unmatched assignee written into the description.
	eng8 := h.issueFor("li-8")
	if eng8.ParentID == nil || *eng8.ParentID != eng7.ID {
		t.Errorf("ENG-8 parent %v, want ENG-7 %s", eng8.ParentID, eng7.ID)
	}
	if eng8.AssigneeID != nil {
		t.Errorf("ENG-8 is assigned to %s; its Linear assignee has no account here", eng8.AssigneeID)
	}
	if !strings.HasSuffix(eng8.Description, "Imported from Linear: assigned to Carl Jones") {
		t.Errorf("ENG-8 description %q does not name its Linear assignee", eng8.Description)
	}
	if eng12 := h.issueFor("li-12"); !eng12.Completed || eng12.Number != 12 {
		t.Errorf("ENG-12 completed=%v number=%d", eng12.Completed, eng12.Number)
	}
	if eng13 := h.issueFor("li-13"); !eng13.Archived {
		t.Error("ENG-13 was archived in Linear and is not archived here")
	}
	des2 := h.issueFor("li-d2")
	if des2.TeamID != desID || des2.Number != 2 || des2.StateName != "Backlog" {
		t.Errorf("DES-2 imported as team %s number %d state %q", des2.TeamID, des2.Number, des2.StateName)
	}

	// The blocking relation, in its direction.
	des5 := h.issueFor("li-d5")
	if got := h.count(`SELECT count(*) FROM issue_relation WHERE issue_id = $1 AND related_issue_id = $2 AND type = 'blocks'`,
		des5.ID, eng7.ID); got != 1 {
		t.Errorf("%d DES-5 blocks ENG-7 relations, want 1", got)
	}

	// Comments: bob's under his own name; Carl's by the admin with his name on it, and
	// threaded under bob's.
	var bobActor *uuid.UUID
	var bobCommentID uuid.UUID
	if err := h.db.Pool().QueryRow(ctx, `SELECT id, actor_id FROM comment WHERE issue_id = $1 AND body = 'Looks good'`,
		eng7.ID).Scan(&bobCommentID, &bobActor); err != nil {
		t.Fatalf("bob's comment: %v", err)
	}
	if bobActor == nil || *bobActor != h.bobID {
		t.Errorf("bob's comment is by %v, want bob", bobActor)
	}
	var carlActor, carlParent *uuid.UUID
	var carlBody string
	if err := h.db.Pool().QueryRow(ctx, `SELECT body, actor_id, parent_id FROM comment WHERE issue_id = $1 AND body LIKE '%Agreed'`,
		eng7.ID).Scan(&carlBody, &carlActor, &carlParent); err != nil {
		t.Fatalf("carl's comment: %v", err)
	}
	if !strings.HasPrefix(carlBody, "**Carl Jones** wrote:") || carlActor == nil || *carlActor != h.f.UserID {
		t.Errorf("carl's comment %q by %v, want the admin's with a byline", carlBody, carlActor)
	}
	if carlParent == nil || *carlParent != bobCommentID {
		t.Errorf("carl's reply has parent %v, want bob's comment", carlParent)
	}

	// The counter is past every imported number, so the next native issue is ENG-14.
	next, _, err := h.svc.CreateIssue(ctx, h.f.Principal(), domain.CreateIssueInput{TeamID: h.f.TeamID, Title: "Native"})
	if err != nil {
		t.Fatalf("native create after import: %v", err)
	}
	if next.Number != 14 {
		t.Errorf("the first native issue after the import is number %d, want 14", next.Number)
	}

	// Quiet: every change the import wrote is silent, nobody was subscribed, and the
	// fan-out writes nothing for any of it.
	if got := h.count(`SELECT count(*) FROM change_log WHERE workspace_id = $1 AND version > $2 AND version < (
		SELECT min(version) FROM change_log WHERE workspace_id = $1 AND entity_id = $3) AND NOT silent`,
		h.f.WorkspaceID, startVersion, next.ID); got != 0 {
		t.Errorf("the import wrote %d change rows that are not silent", got)
	}
	if got := h.count(`SELECT count(*) FROM change_log WHERE workspace_id = $1 AND version > $2 AND silent`,
		h.f.WorkspaceID, startVersion); got == 0 {
		t.Error("the import wrote no silent change rows at all, so nothing above was measured")
	}
	if got := h.count(`SELECT count(*) FROM issue_subscription i JOIN import_link l ON l.polaris_id = i.issue_id
		WHERE l.workspace_id = $1`, h.f.WorkspaceID); got != 0 {
		t.Errorf("the import subscribed people to imported issues %d times", got)
	}
	if got := h.count(`SELECT count(*) FROM project_subscription WHERE workspace_id = $1`, h.f.WorkspaceID); got != 0 {
		t.Errorf("the import added %d project subscriptions", got)
	}
	if _, err := h.svc.FanOut(ctx, h.f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	if got := h.count(`SELECT count(*) FROM notification WHERE workspace_id = $1 AND issue_id IN (
		SELECT polaris_id FROM import_link WHERE workspace_id = $1 AND entity = 'issue')`, h.f.WorkspaceID); got != 0 {
		t.Errorf("the import produced %d notifications", got)
	}
}

func TestLinearImport_RunningTwiceCreatesNothingTheSecondTime(t *testing.T) {
	h := newHarness(t)
	if job := h.runImport(); job.Status != model.ImportStatusDone {
		t.Fatalf("first run: %q %v", job.Status, job.Error)
	}
	tables := []string{"team", "workflow_state", "label", "project", "cycle", "issue", "comment", "issue_relation", "issue_label"}
	before := map[string]int{}
	for _, tbl := range tables {
		before[tbl] = h.count(`SELECT count(*) FROM `+tbl+` WHERE workspace_id = $1`, h.f.WorkspaceID)
	}

	if job := h.runImport(); job.Status != model.ImportStatusDone {
		t.Fatalf("second run: %q %v", job.Status, job.Error)
	}
	for _, tbl := range tables {
		if got := h.count(`SELECT count(*) FROM `+tbl+` WHERE workspace_id = $1`, h.f.WorkspaceID); got != before[tbl] {
			t.Errorf("%s: %d rows after the second import, %d after the first", tbl, got, before[tbl])
		}
	}
}

func TestStartLinearImport_RefusesAMember(t *testing.T) {
	h := newHarness(t)
	member := h.f.PrincipalFor(h.bobID, authz.RoleMember, h.f.TeamID)
	_, err := h.svc.StartLinearImport(context.Background(), member, "lin_api_test")
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("a member starting an import got %v, want forbidden", err)
	}
	if got := h.count(`SELECT count(*) FROM import_job WHERE workspace_id = $1`, h.f.WorkspaceID); got != 0 {
		t.Errorf("a refused start queued %d jobs", got)
	}
	if n := h.fake.requests.Load(); n != 0 {
		t.Errorf("a refused start sent the key to Linear %d times", n)
	}
}

func TestStartLinearImport_RefusesAKeyLinearRejects(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)
	domain.RegisterImportSource(svc, &linear.Source{BaseURL: srv.URL})

	_, err := svc.StartLinearImport(context.Background(), f.Principal(), "lin_api_wrong")
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("a rejected key got %v, want a validation error", err)
	}
}

func TestLinearImport_OverThePlansIssueLimitFailsAndDropsTheKey(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	h.f.SetPlan(t, entitlement.PlanFree)

	// Two short of the free plan's ceiling, so the six imported issues do not fit.
	limit := entitlement.For(entitlement.PlanFree).IssueLimit
	if _, err := h.db.Pool().Exec(ctx, `
		INSERT INTO issue (id, workspace_id, team_id, number, title, description, state_id, priority, sort_order)
		SELECT gen_random_uuid(), $1, $2, 1000 + g, 'seed ' || g, '', $3, 0, 'a' || lpad(g::text, 6, '0')
		FROM generate_series(1, $4::int) g`,
		h.f.WorkspaceID, h.f.TeamID, h.f.Backlog, limit-2); err != nil {
		t.Fatalf("seed issues: %v", err)
	}
	if _, err := h.db.Pool().Exec(ctx, `UPDATE team SET issue_counter = 1000 + $2 WHERE id = $1`,
		h.f.TeamID, limit); err != nil {
		t.Fatalf("bump counter: %v", err)
	}

	job := h.runImport()
	if job.Status != model.ImportStatusFailed {
		t.Fatalf("job status %q, want failed", job.Status)
	}
	if job.Error == nil || !strings.Contains(*job.Error, "issues") {
		t.Errorf("job error %v does not say it is the issue limit", job.Error)
	}
	if got := h.count(`SELECT count(*) FROM import_link WHERE workspace_id = $1 AND entity = 'issue'`, h.f.WorkspaceID); got != 0 {
		t.Errorf("%d issues were imported past the plan's limit, want none", got)
	}
	if !h.apiKeyIsNull(job.ID) {
		t.Error("a failed import still holds the Linear key")
	}
}

func TestRequeueStaleImports_PutsAQuietRunningJobBackInTheQueue(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	job, err := h.svc.StartLinearImport(ctx, h.f.Principal(), "lin_api_test")
	if err != nil {
		t.Fatalf("start import: %v", err)
	}
	// What a worker that died mid-run leaves behind: running, key still held, silent for
	// longer than the sweep tolerates.
	if _, err := h.db.Pool().Exec(ctx,
		`UPDATE import_job SET status = 'running', updated_at = now() - interval '1 hour' WHERE id = $1`, job.ID,
	); err != nil {
		t.Fatalf("age the job: %v", err)
	}
	n, err := domain.RequeueStaleImports(ctx, h.svc)
	if err != nil || n != 1 {
		t.Fatalf("requeued %d (err %v), want 1", n, err)
	}
	if got := h.runQueuedJob(job.ID); got.Status != model.ImportStatusDone {
		t.Errorf("the requeued job ended %q (%v), want done", got.Status, got.Error)
	}
}

// runQueuedJob runs whatever is queued and returns the named job.
func (h *harness) runQueuedJob(id uuid.UUID) model.ImportJob {
	h.t.Helper()
	if _, err := domain.RunQueuedImport(context.Background(), h.svc); err != nil {
		h.t.Fatalf("run: %v", err)
	}
	got, err := h.svc.GetImportJob(context.Background(), h.f.Principal(), id)
	if err != nil {
		h.t.Fatalf("get import: %v", err)
	}
	return got
}
