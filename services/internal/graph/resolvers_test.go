package graph

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/lru"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/google/uuid"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// These tests drive the resolvers against a real database rather than through the HTTP
// executor. What is under test is the layer's own behaviour — who it lets in, what it
// hands back, and what it says when it refuses — and going through the executor would add
// a query parser and a JSON encoder to every assertion without exercising a line of this
// package that a direct call does not.

type harness struct {
	*Resolver
	svc *domain.Service
	f   *testutil.Fixture

	// ctx carries the fixture's admin, resolved exactly as a request would resolve them.
	ctx context.Context
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	f := testutil.NewFixture(t, db)

	p, err := svc.ResolvePrincipal(context.Background(), f.AccountID, f.WorkspaceID)
	if err != nil {
		t.Fatalf("resolve principal for the fixture's admin: %v", err)
	}

	return &harness{
		Resolver: &Resolver{Svc: svc},
		svc:      svc,
		f:        f,
		ctx:      authz.WithPrincipal(context.Background(), p),
	}
}

func (h *harness) createIssue(t *testing.T, in generated.CreateIssueInput) *generated.IssuePayload {
	t.Helper()
	payload, err := h.Mutation().CreateIssue(h.ctx, in, nil, nil)
	if err != nil {
		t.Fatalf("create issue %q: %v", in.Title, err)
	}
	return payload
}

// errorCode reads the classification a client would branch on, and insists the error was
// presented at all: an error that reaches this point unpresented is one whose text — a
// constraint name, a fragment of SQL — would have been serialised straight to the caller.
func errorCode(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		t.Fatal("expected the resolver to refuse, but it returned no error")
	}
	var gqlErr *gqlerror.Error
	if !errors.As(err, &gqlErr) {
		t.Fatalf("resolver returned a bare %T; every error must be presented before it leaves this package, "+
			"or a database string reaches the client: %v", err, err)
	}
	code, _ := gqlErr.Extensions["code"].(string)
	return code
}

func ptr[T any](v T) *T { return &v }

func TestCreateIssue_IsThenReadableByIDAndByIdentifier(t *testing.T) {
	h := newHarness(t)

	created := h.createIssue(t, generated.CreateIssueInput{
		TeamID: h.f.TeamID,
		Title:  "Ship the sync engine",
	})

	if created.Issue.Identifier != "ENG-1" {
		t.Errorf("the first issue in team ENG must be ENG-1, got %q — the identifier is the name people paste to each other", created.Issue.Identifier)
	}
	if created.Version <= 0 {
		t.Errorf("a mutation returned version %d; an optimistic client cannot tell whether an incoming delta supersedes its own write without one", created.Version)
	}

	byID, err := h.Query().Issue(h.ctx, created.Issue.ID)
	if err != nil {
		t.Fatalf("read back the issue just created: %v", err)
	}
	if byID.Title != "Ship the sync engine" {
		t.Errorf("the issue read back has title %q, not the one it was created with", byID.Title)
	}

	// Case-folded on purpose: the identifier arrives from a URL bar and a chat message as
	// often as from the client.
	byIdentifier, err := h.Query().IssueByIdentifier(h.ctx, "eng-1")
	if err != nil {
		t.Fatalf("read the same issue by its identifier: %v", err)
	}
	if byIdentifier.ID != created.Issue.ID {
		t.Errorf("issueByIdentifier returned %s and issue(id) returned %s for the same issue", byIdentifier.ID, created.Issue.ID)
	}

	if byID.State == nil || byID.State.Name != "Backlog" {
		t.Errorf("a new issue must land in the team's default status; got %v", byID.State)
	}
	if byID.Team == nil || byID.Team.Key != h.f.TeamKey {
		t.Errorf("the issue came back without its team; got %v", byID.Team)
	}
}

func TestIssue_FromAnotherWorkspaceIsNotFoundRatherThanForbidden(t *testing.T) {
	h := newHarness(t)
	created := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Ours"})

	// A second, unrelated workspace in the same database, built through the signup path so
	// that its admin is as real as the first one's.
	ctx := context.Background()
	accountID, _, err := h.svc.Register(ctx, domain.RegisterInput{
		Email:    "stranger@example.com",
		Password: "a passphrase nobody guesses",
	})
	if err != nil {
		t.Fatalf("register the other account: %v", err)
	}
	other, err := h.svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID:     accountID,
		Name:          "Other Company",
		UserName:      "Stranger",
		FirstTeamKey:  "OTH",
		FirstTeamName: "Other",
	})
	if err != nil {
		t.Fatalf("create the other workspace: %v", err)
	}
	stranger, err := h.svc.ResolvePrincipal(ctx, accountID, other.Workspace.ID)
	if err != nil {
		t.Fatalf("resolve the other workspace's admin: %v", err)
	}
	strangerCtx := authz.WithPrincipal(ctx, stranger)

	_, err = h.Query().Issue(strangerCtx, created.Issue.ID)
	if code := errorCode(t, err); code != string(platform.CodeNotFound) {
		t.Errorf("a principal from another workspace was told %s; it must be NOT_FOUND, because confirming that an id exists somewhere else is itself a leak", code)
	}

	_, err = h.Query().Issues(strangerCtx, h.f.TeamID)
	if code := errorCode(t, err); code != string(platform.CodeNotFound) {
		t.Errorf("listing another workspace's team was answered with %s; it must be NOT_FOUND", code)
	}
}

func TestReads_AMemberOfNoTeamsSeesNoIssues(t *testing.T) {
	h := newHarness(t)
	created := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Not for them"})

	// A workspace member who belongs to no team at all — what every member looks like once
	// the teams around them are private.
	outsider := &authz.Principal{
		AccountID:      uuid.Must(uuid.NewV7()),
		UserID:         h.f.NewUser(t, "outsider", string(authz.RoleMember), false),
		WorkspaceID:    h.f.WorkspaceID,
		Role:           authz.RoleMember,
		Teams:          authz.NewTeamSet(),
		SharedEntities: map[uuid.UUID]struct{}{},
	}
	outsiderCtx := authz.WithPrincipal(context.Background(), outsider)

	teams, err := h.Query().Teams(outsiderCtx)
	if err != nil {
		t.Fatalf("list teams as a member of none: %v", err)
	}
	if len(teams) != 0 {
		t.Errorf("a member of no teams was shown %d teams; the API must hide exactly what the sync stream hides", len(teams))
	}

	if _, err := h.Query().Issue(outsiderCtx, created.Issue.ID); errorCode(t, err) != string(platform.CodeNotFound) {
		t.Error("a member of no teams must not be able to read an issue by id")
	}
	if _, err := h.Query().Issues(outsiderCtx, h.f.TeamID); errorCode(t, err) != string(platform.CodeNotFound) {
		t.Error("a member of no teams must not be able to list a team's issues")
	}
	if _, err := h.Query().IssueByIdentifier(outsiderCtx, "ENG-1"); errorCode(t, err) != string(platform.CodeNotFound) {
		t.Error("a member of no teams must not be able to reach an issue by its identifier either")
	}
}

func TestMutations_ReturnAVersionThatMovesForward(t *testing.T) {
	h := newHarness(t)

	created := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "First"})

	updated, err := h.Mutation().UpdateIssue(h.ctx, generated.UpdateIssueInput{
		ID:      created.Issue.ID,
		StateID: &h.f.InProgress,
	}, nil, nil)
	if err != nil {
		t.Fatalf("move the issue to In Progress: %v", err)
	}

	if updated.Version <= created.Version {
		t.Errorf("the second write landed at version %d and the first at %d; a client orders deltas against its own writes by this number, so it has to increase",
			updated.Version, created.Version)
	}
	if updated.Issue.State == nil || updated.Issue.State.Name != "In Progress" {
		t.Errorf("the payload must carry the issue as it now is; got %v", updated.Issue.State)
	}
}

func TestIssueByIdentifier_RejectsAMalformedIdentifier(t *testing.T) {
	h := newHarness(t)

	// Every one of these arrives from a URL somebody typed or a link somebody truncated.
	for _, bad := range []string{"", "ENG", "ENG-", "-1", "ENG-abc", "ENG-0", "ENG-1-2", "ENG-99999999999999999999"} {
		t.Run(bad, func(t *testing.T) {
			_, err := h.Query().IssueByIdentifier(h.ctx, bad)
			if code := errorCode(t, err); code != string(platform.CodeValidation) {
				t.Errorf("%q was answered with %s; a malformed identifier is the caller's mistake and must come back as VALIDATION", bad, code)
			}
		})
	}
}

func TestResolvers_RefuseAnUnauthenticatedCaller(t *testing.T) {
	h := newHarness(t)
	anonymous := context.Background()

	if _, err := h.Query().Viewer(anonymous); errorCode(t, err) != string(platform.CodeUnauthorized) {
		t.Error("a query with no principal on the context must be UNAUTHENTICATED")
	}
	_, err := h.Mutation().CreateIssue(anonymous, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "x"}, nil, nil)
	if errorCode(t, err) != string(platform.CodeUnauthorized) {
		t.Error("a mutation with no principal on the context must be UNAUTHENTICATED, and must not reach the domain layer at all")
	}
}

func TestIssues_ListArrivesWithItsStatusTeamAndPeople(t *testing.T) {
	h := newHarness(t)
	mate := h.f.NewUser(t, "mate", string(authz.RoleMember), true)

	h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Unassigned"})
	h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Assigned", AssigneeID: &mate})

	issues, err := h.Query().Issues(h.ctx, h.f.TeamID)
	if err != nil {
		t.Fatalf("list the team's issues: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected the two issues just created, got %d", len(issues))
	}

	byTitle := make(map[string]generated.Issue, len(issues))
	for _, i := range issues {
		byTitle[i.Title] = i

		if i.State == nil {
			t.Errorf("%s came back without its status; the list groups by status and cannot render without one", i.Identifier)
		}
		if i.Team == nil {
			t.Errorf("%s came back without its team", i.Identifier)
		}
		if i.Creator == nil {
			t.Errorf("%s came back without its creator", i.Identifier)
		}
	}

	if a := byTitle["Assigned"]; a.Assignee == nil || a.Assignee.ID != mate {
		t.Errorf("the assigned issue must carry its assignee; got %v", a.Assignee)
	}
	if u := byTitle["Unassigned"]; u.Assignee != nil {
		t.Errorf("an unassigned issue must carry no assignee; got %v", u.Assignee)
	}
}

func TestViewer_CarriesEverythingTheClientNeedsBeforeItOpensTheSocket(t *testing.T) {
	h := newHarness(t)
	created := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Something"})

	viewer, err := h.Query().Viewer(h.ctx)
	if err != nil {
		t.Fatalf("read the viewer: %v", err)
	}

	if viewer.User.ID != h.f.UserID {
		t.Errorf("viewer.user is %s, not the caller %s", viewer.User.ID, h.f.UserID)
	}
	if viewer.User.Email == nil {
		t.Error("the viewer must receive their own email address; it is the only address the client can show in the account menu")
	}
	if viewer.Workspace.ID != h.f.WorkspaceID {
		t.Errorf("viewer.workspace is %s, not the one the principal was resolved against", viewer.Workspace.ID)
	}
	if len(viewer.Workspaces) == 0 {
		t.Error("the switcher's list must contain at least the workspace the caller is in")
	}
	if viewer.SyncVersion < created.Version {
		t.Errorf("viewer.syncVersion is %d but a write already landed at %d; a client resuming from it would never be sent that change",
			viewer.SyncVersion, created.Version)
	}

	var found bool
	for _, team := range viewer.Workspace.Teams {
		if team.Key == h.f.TeamKey {
			found = true
			if len(team.States) == 0 {
				t.Error("a team came back with no statuses; the client cannot render a list without the columns")
			}
		}
	}
	if !found {
		t.Errorf("the viewer's workspace did not include team %s", h.f.TeamKey)
	}
}

func TestComments_ReadBackOnTheIssueTheyWereWrittenOn(t *testing.T) {
	h := newHarness(t)
	created := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Needs discussion"})

	posted, err := h.Mutation().CreateComment(h.ctx, generated.CreateCommentInput{
		IssueID: created.Issue.ID,
		Body:    "Looks right to me",
	}, nil, nil)
	if err != nil {
		t.Fatalf("post a comment: %v", err)
	}
	if posted.Version <= created.Version {
		t.Errorf("the comment landed at version %d, at or behind the issue's %d", posted.Version, created.Version)
	}
	if posted.Comment.Actor == nil || posted.Comment.Actor.Type != generated.ActorTypeUser {
		t.Errorf("a comment must name who wrote it; got %v", posted.Comment.Actor)
	}

	comments, err := h.Query().Comments(h.ctx, created.Issue.ID)
	if err != nil {
		t.Fatalf("read the issue's comments: %v", err)
	}
	if len(comments) != 1 || comments[0].Body != "Looks right to me" {
		t.Errorf("expected the one comment just posted, got %v", comments)
	}
}

func TestUpdateWorkflowState_RefusesADefaultTheProductForbids(t *testing.T) {
	h := newHarness(t)

	_, err := h.Mutation().UpdateWorkflowState(h.ctx, generated.UpdateWorkflowStateInput{
		ID:          h.f.Done,
		MakeDefault: ptr(true),
	})
	if code := errorCode(t, err); code != string(platform.CodeValidation) {
		t.Errorf("making a completed status the default was answered with %s; a new issue may not be born finished, and the refusal is a VALIDATION error the form can attach to the control", code)
	}
}

// Everything above calls the resolvers directly. This one goes through the executor,
// because the selection logic — which relations a query pays for — only exists when there
// is a query to read, and because it is the only way to check that the error presenter
// and the loader middleware are wired to something that works.
func TestExecutedQuery_ResolvesTheRelationsItNamesAndPresentsItsErrors(t *testing.T) {
	h := newHarness(t)
	created := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Discussed"})
	if _, err := h.Mutation().CreateComment(h.ctx, generated.CreateCommentInput{
		IssueID: created.Issue.ID,
		Body:    "First",
	}, nil, nil); err != nil {
		t.Fatalf("post a comment: %v", err)
	}

	// A named fragment on purpose: the collector has to be told which type the selections
	// belong to, and a fragment spread is where getting that wrong shows up.
	body := h.execute(t, `
		query Board($team: UUID!) {
			issues(teamId: $team) {
				...IssueRow
				comments { body }
				team { key states { name } }
			}
		}
		fragment IssueRow on Issue {
			identifier
			state { name category }
		}`,
		map[string]any{"team": h.f.TeamID.String()})

	if errs, ok := body["errors"]; ok {
		t.Fatalf("the query failed: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	issues, _ := data["issues"].([]any)
	if len(issues) != 1 {
		t.Fatalf("expected one issue, got %v", data["issues"])
	}
	issue, _ := issues[0].(map[string]any)

	state, _ := issue["state"].(map[string]any)
	if state["name"] != "Backlog" || state["category"] != string(generated.StateCategoryBacklog) {
		t.Errorf("the status came back as %v; the category is uppercase on the wire and lowercase in the database, and the mapping is what keeps those apart", state)
	}
	team, _ := issue["team"].(map[string]any)
	if team["key"] != h.f.TeamKey {
		t.Errorf("the issue's team came back as %v", team)
	}
	if states, _ := team["states"].([]any); len(states) != 5 {
		t.Errorf("the team came back with %d statuses; a seeded team has five", len(states))
	}
	if comments, _ := issue["comments"].([]any); len(comments) != 1 {
		t.Errorf("the comment the query asked for is missing: %v", issue["comments"])
	}

	// An error raised inside a resolver has to arrive classified, and with nothing of the
	// server's internals attached to it.
	body = h.execute(t, `query Missing($id: UUID!) { issue(id: $id) { id } }`,
		map[string]any{"id": uuid.Must(uuid.NewV7()).String()})
	errs, _ := body["errors"].([]any)
	if len(errs) != 1 {
		t.Fatalf("expected one error for an unknown issue id, got %v", body)
	}
	first, _ := errs[0].(map[string]any)
	extensions, _ := first["extensions"].(map[string]any)
	if extensions["code"] != string(platform.CodeNotFound) {
		t.Errorf("the executed query reported %v; clients branch on extensions.code and it has to survive the transport", extensions)
	}
}

// execute runs a query the way the api process does, through the same handler
// configuration, so the wiring under test is the wiring that ships.
func (h *harness) execute(t *testing.T, query string, variables map[string]any) map[string]any {
	t.Helper()

	srv := handler.New(generated.NewExecutableSchema(generated.Config{Resolvers: h.Resolver}))
	srv.AddTransport(transport.POST{})
	srv.SetQueryCache(lru.New[*ast.QueryDocument](16))
	srv.SetErrorPresenter(PresentError)
	srv.SetRecoverFunc(RecoverPanic)

	var api http.Handler = srv
	api = LoaderMiddleware(h.svc)(api)

	payload, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		t.Fatalf("encode the request: %v", err)
	}
	// The principal is on the context because the HTTP middleware put it there; a resolver
	// never authenticates for itself.
	req := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(payload)).WithContext(h.ctx)
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode the response %q: %v", rec.Body.String(), err)
	}
	return body
}

// The loaders' whole purpose is that a list pays for its relations once rather than once
// per row. This is the property that makes that true.
func TestBatch_RunsItsQueryOnceHoweverManyFieldsAsk(t *testing.T) {
	var (
		b     batch[int]
		calls int
	)
	for range 5 {
		got, err := b.load(func() (int, error) {
			calls++
			return 7, nil
		})
		if err != nil || got != 7 {
			t.Fatalf("batch returned (%d, %v)", got, err)
		}
	}
	if calls != 1 {
		t.Errorf("the batch ran its query %d times; five fields asking for the same workspace list must produce one query, or a 250-issue list becomes a thousand", calls)
	}
}
