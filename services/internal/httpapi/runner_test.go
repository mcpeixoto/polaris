package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The external runner is an installed app polling for work it was delegated. A person's
// token is a different kind of caller, and the routes refuse it before any run is touched.

func TestRunner_AHumanTokenIsForbidden(t *testing.T) {
	env := newRunnerEnv(t)
	_, human, _, err := env.svc.CreateApiKey(t.Context(), env.f.Principal(), domain.CreateApiKeyInput{
		Name: "human", Scopes: []string{domain.APIKeyScopeWrite},
	})
	if err != nil {
		t.Fatalf("api key: %v", err)
	}

	for _, path := range []string{
		"/runner/v1/claim",
		"/runner/v1/runs/" + uuid.Must(uuid.NewV7()).String() + "/heartbeat",
		"/runner/v1/runs/" + uuid.Must(uuid.NewV7()).String() + "/events",
		"/runner/v1/runs/" + uuid.Must(uuid.NewV7()).String() + "/finish",
	} {
		rec := env.post(t, human, path, map[string]any{"version": "0"})
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s = %d, want 403: %s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestRunner_ClaimReturnsNothingWhenNothingIsDue(t *testing.T) {
	env := newRunnerEnv(t)
	rec := env.post(t, env.token, "/runner/v1/claim", map[string]any{"version": "0.0.1"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("claim = %d, want 204: %s", rec.Code, rec.Body.String())
	}
}

func TestRunner_ADueRunIsClaimedOnce(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	issue := env.delegate(t, "Write the notes", "Cover the empty state.", 2)
	if _, _, err := env.svc.CreateComment(t.Context(), env.f.Principal(), domain.CreateCommentInput{
		IssueID: issue.ID, Body: "Start with the empty list.",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}

	rec := env.post(t, env.token, "/runner/v1/claim", map[string]any{"version": "0.0.1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body claimResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Run.ID == uuid.Nil {
		t.Fatal("claim returned no run id")
	}
	if body.Run.SessionRef != nil {
		t.Fatalf("first claim sessionRef = %q, want none yet", *body.Run.SessionRef)
	}
	if body.Issue.ID != issue.ID || body.Issue.Identifier != issue.Identifier {
		t.Fatalf("issue = %s %s, want %s %s", body.Issue.Identifier, body.Issue.ID, issue.Identifier, issue.ID)
	}
	if body.Issue.Title != "Write the notes" || body.Issue.Description != "Cover the empty state." {
		t.Fatalf("title/description = %q / %q", body.Issue.Title, body.Issue.Description)
	}
	if body.Issue.URL != "http://polaris.test/issue/"+issue.Identifier {
		t.Fatalf("url = %q", body.Issue.URL)
	}
	if body.Issue.Team.Key != "ENG" || body.Issue.Team.Name != "Engineering" {
		t.Fatalf("team = %+v", body.Issue.Team)
	}
	if body.Issue.State.Name == "" || body.Issue.State.Type == "" {
		t.Fatalf("state = %+v, want the workflow status", body.Issue.State)
	}
	if body.Issue.Priority != 2 {
		t.Fatalf("priority = %d, want 2", body.Issue.Priority)
	}
	if len(body.Issue.Comments) != 1 || body.Issue.Comments[0].Body != "Start with the empty list." {
		t.Fatalf("comments = %+v", body.Issue.Comments)
	}
	if body.Issue.Comments[0].Author != "dev" {
		t.Fatalf("comment author = %q, want the person who wrote it", body.Issue.Comments[0].Author)
	}

	again := env.post(t, env.token, "/runner/v1/claim", map[string]any{"version": "0.0.1"})
	if again.Code != http.StatusNoContent {
		t.Fatalf("second claim = %d, want 204: %s", again.Code, again.Body.String())
	}
}

func TestRunner_ARunThatIsNotDueYetIsNotClaimed(t *testing.T) {
	env := newRunnerEnv(t)
	issue := env.delegate(t, "Later", "", 0)
	rec := env.post(t, env.token, "/runner/v1/claim", map[string]any{"version": "0.0.1"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("claim = %d, want 204: %s", rec.Code, rec.Body.String())
	}
	runs := listRunnerRuns(t, env, issue.ID)
	if len(runs) != 1 || runs[0].Status != "queued" {
		t.Fatalf("runs = %+v, want the one run still queued", runs)
	}
}

func TestRunner_AnotherAgentsRunIsNotFound(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	env.delegate(t, "Not yours", "", 0)
	claimed := env.claim(t)
	other := env.otherApp(t)
	env.postRun(t, other, claimed.Run.ID, http.StatusNotFound)
}

func TestRunner_ACancelledRunConflicts(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	issue := env.delegate(t, "Stop", "", 0)
	claimed := env.claim(t)
	if _, _, err := env.svc.UpdateIssue(t.Context(), env.f.Principal(), domain.UpdateIssueInput{
		ID: issue.ID, ClearDelegate: true,
	}); err != nil {
		t.Fatalf("clear delegate: %v", err)
	}

	env.postRun(t, env.token, claimed.Run.ID, http.StatusConflict)
}

func TestRunner_TheFirstHeartbeatMarksTheRunRunning(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	issue := env.delegate(t, "Beat", "", 0)
	claimed := env.claim(t)

	rec := env.post(t, env.token, "/runner/v1/runs/"+claimed.Run.ID.String()+"/heartbeat", map[string]any{})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("heartbeat = %d, want 204: %s", rec.Code, rec.Body.String())
	}
	runs := listRunnerRuns(t, env, issue.ID)
	if len(runs) != 1 || runs[0].Status != "running" {
		t.Fatalf("status = %+v, want running", runs)
	}
	if runs[0].HeartbeatAt == nil {
		t.Fatal("heartbeat did not record a time")
	}
}

func TestRunner_AnEventPostsACommentAsTheAgent(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	issue := env.delegate(t, "Talk", "", 0)
	claimed := env.claim(t)

	rec := env.post(t, env.token, "/runner/v1/runs/"+claimed.Run.ID.String()+"/events", map[string]any{
		"kind": "comment", "body": "Looking at the empty state.",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("events = %d, want 204: %s", rec.Code, rec.Body.String())
	}

	comments, err := env.svc.ListComments(t.Context(), env.f.Principal(), issue.ID)
	if err != nil {
		t.Fatalf("comments: %v", err)
	}
	if len(comments) != 1 {
		t.Fatalf("comments = %d, want the one the agent posted", len(comments))
	}
	if comments[0].Body != "Looking at the empty state." {
		t.Fatalf("body = %q", comments[0].Body)
	}
	if comments[0].Actor.ID == nil || *comments[0].Actor.ID != env.agent {
		t.Fatalf("author = %+v, want the agent %s", comments[0].Actor, env.agent)
	}
	if comments[0].Actor.Type != "app_user" {
		t.Fatalf("actor type = %q, want app_user", comments[0].Actor.Type)
	}
}

func TestRunner_FinishDoneStoresTheOutcomeAndPostsTheSummary(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	issue := env.delegate(t, "Done", "", 0)
	claimed := env.claim(t)

	rec := env.post(t, env.token, "/runner/v1/runs/"+claimed.Run.ID.String()+"/finish", map[string]any{
		"status":       "done",
		"summary":      "Shipped the empty state.",
		"sessionRef":   "sess-9",
		"inputTokens":  12,
		"outputTokens": 34,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("finish = %d, want 204: %s", rec.Code, rec.Body.String())
	}

	runs := listRunnerRuns(t, env, issue.ID)
	if len(runs) != 1 {
		t.Fatalf("runs = %d, want 1", len(runs))
	}
	run := runs[0]
	if run.Status != "done" {
		t.Fatalf("status = %q, want done", run.Status)
	}
	if run.Summary == nil || *run.Summary != "Shipped the empty state." {
		t.Fatalf("summary = %v", run.Summary)
	}
	if run.SessionRef == nil || *run.SessionRef != "sess-9" {
		t.Fatalf("sessionRef = %v", run.SessionRef)
	}
	if run.InputTokens != 12 || run.OutputTokens != 34 {
		t.Fatalf("tokens = %d/%d, want 12/34", run.InputTokens, run.OutputTokens)
	}

	comments, err := env.svc.ListComments(t.Context(), env.f.Principal(), issue.ID)
	if err != nil {
		t.Fatalf("comments: %v", err)
	}
	if len(comments) != 1 || comments[0].Body != "Shipped the empty state." {
		t.Fatalf("comments = %+v, want the summary posted once", comments)
	}
	if comments[0].Actor.ID == nil || *comments[0].Actor.ID != env.agent {
		t.Fatalf("summary author = %+v, want the agent", comments[0].Actor)
	}
}

func TestRunner_FinishDoneDoesNotRepeatACommentAlreadyPosted(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	issue := env.delegate(t, "Already said", "", 0)
	claimed := env.claim(t)
	ev := env.post(t, env.token, "/runner/v1/runs/"+claimed.Run.ID.String()+"/events", map[string]any{
		"kind": "comment", "body": "The notes are in.",
	})
	if ev.Code != http.StatusNoContent {
		t.Fatalf("events = %d: %s", ev.Code, ev.Body.String())
	}
	rec := env.post(t, env.token, "/runner/v1/runs/"+claimed.Run.ID.String()+"/finish", map[string]any{
		"status": "done", "summary": "Shipped the empty state.",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("finish = %d: %s", rec.Code, rec.Body.String())
	}
	comments, err := env.svc.ListComments(t.Context(), env.f.Principal(), issue.ID)
	if err != nil {
		t.Fatalf("comments: %v", err)
	}
	if len(comments) != 1 || comments[0].Body != "The notes are in." {
		t.Fatalf("comments = %+v, want only the comment posted during the run", comments)
	}
}

func TestRunner_PollingUpdatesLastSeen(t *testing.T) {
	env := newRunnerEnv(t)
	before := time.Now().Add(-time.Second)
	rec := env.post(t, env.token, "/runner/v1/claim", map[string]any{"version": "1.2.3"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("claim = %d: %s", rec.Code, rec.Body.String())
	}
	row, err := env.db.Queries().GetAgentRunner(context.Background(), env.agent)
	if err != nil {
		t.Fatalf("runner row: %v", err)
	}
	if row.Version != "1.2.3" {
		t.Fatalf("version = %q, want 1.2.3", row.Version)
	}
	if row.LastSeenAt.Before(before) {
		t.Fatalf("last_seen_at = %s, want it moved by the poll", row.LastSeenAt)
	}
	if row.WorkspaceID != env.f.WorkspaceID {
		t.Fatalf("workspace = %s, want %s", row.WorkspaceID, env.f.WorkspaceID)
	}
}

func TestRunner_AnUnreadableIssueFailsTheRun(t *testing.T) {
	env := newRunnerEnv(t)
	withRunnerDelay(t, -time.Minute)
	ctx := context.Background()
	team, _, err := env.svc.CreateTeam(ctx, env.f.Principal(), domain.CreateTeamInput{
		Key: "SEC", Name: "Security", Private: true,
	})
	if err != nil {
		t.Fatalf("team: %v", err)
	}
	// The fixture principal was built before this team existed, so it cannot see it.
	// Resolving again is what a request does: membership is read, not remembered.
	owner, err := env.svc.ResolvePrincipal(ctx, env.f.AccountID, env.f.WorkspaceID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if _, _, err := env.svc.AddTeamMember(ctx, owner, team.ID, env.agent, "member"); err != nil {
		t.Fatalf("add member: %v", err)
	}
	issue, _, err := env.svc.CreateIssue(ctx, owner, domain.CreateIssueInput{
		TeamID: team.ID, Title: "Quiet", DelegateID: &env.agent,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := env.svc.RemoveTeamMember(ctx, owner, team.ID, env.agent); err != nil {
		t.Fatalf("remove member: %v", err)
	}

	rec := env.post(t, env.token, "/runner/v1/claim", map[string]any{"version": "0.0.1"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("claim = %d, want 204 when the issue cannot be read: %s", rec.Code, rec.Body.String())
	}
	runs := listRunnerRuns(t, env, issue.ID)
	if len(runs) != 1 || runs[0].Status != "failed" {
		t.Fatalf("runs = %+v, want the run failed", runs)
	}
	if runs[0].Error == nil || *runs[0].Error == "" {
		t.Fatal("failed run has no reason")
	}
}

type claimResponse struct {
	Run struct {
		ID         uuid.UUID `json:"id"`
		SessionRef *string   `json:"sessionRef"`
	} `json:"run"`
	Issue struct {
		ID          uuid.UUID `json:"id"`
		Identifier  string    `json:"identifier"`
		Title       string    `json:"title"`
		Description string    `json:"description"`
		URL         string    `json:"url"`
		Team        struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		} `json:"team"`
		State struct {
			Name string `json:"name"`
			Type string `json:"type"`
		} `json:"state"`
		Priority int `json:"priority"`
		Comments []struct {
			Author    string    `json:"author"`
			Body      string    `json:"body"`
			CreatedAt time.Time `json:"createdAt"`
		} `json:"comments"`
	} `json:"issue"`
}

type runnerEnv struct {
	router http.Handler
	svc    *domain.Service
	db     *store.DB
	f      *testutil.Fixture
	token  string
	agent  uuid.UUID
}

func newRunnerEnv(t *testing.T) *runnerEnv {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "http://polaris.test"
	token, agent := mintRunnerApp(t, svc, f)
	router := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens("test-secret-not-used", time.Minute),
		Config:  platform.Config{PublicURL: "http://polaris.test"},
	})
	return &runnerEnv{router: router, svc: svc, db: db, f: f, token: token, agent: agent}
}

func (e *runnerEnv) post(t *testing.T, token, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func (e *runnerEnv) delegate(t *testing.T, title, description string, priority int) model.Issue {
	t.Helper()
	issue, _, err := e.svc.CreateIssue(context.Background(), e.f.Principal(), domain.CreateIssueInput{
		TeamID: e.f.TeamID, Title: title, Description: description,
		Priority: priority, DelegateID: &e.agent,
	})
	if err != nil {
		t.Fatalf("delegate: %v", err)
	}
	return issue
}

func (e *runnerEnv) claim(t *testing.T) claimResponse {
	t.Helper()
	rec := e.post(t, e.token, "/runner/v1/claim", map[string]any{"version": "0.0.1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d: %s", rec.Code, rec.Body.String())
	}
	var body claimResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode claim: %v", err)
	}
	return body
}

func (e *runnerEnv) postRun(t *testing.T, token string, runID uuid.UUID, want int) {
	t.Helper()
	base := "/runner/v1/runs/" + runID.String()
	calls := []struct {
		path string
		body map[string]any
	}{
		{base + "/heartbeat", map[string]any{}},
		{base + "/events", map[string]any{"kind": "comment", "body": "still going"}},
		{base + "/finish", map[string]any{"status": "done", "summary": "nope"}},
	}
	for _, call := range calls {
		rec := e.post(t, token, call.path, call.body)
		if rec.Code != want {
			t.Errorf("%s = %d, want %d: %s", call.path, rec.Code, want, rec.Body.String())
		}
	}
}

func (e *runnerEnv) otherApp(t *testing.T) string {
	t.Helper()
	token, _ := mintRunnerApp(t, e.svc, e.f)
	return token
}

func mintRunnerApp(t *testing.T, svc *domain.Service, f *testutil.Fixture) (string, uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	client, secret, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name: "Runner " + uuid.Must(uuid.NewV7()).String()[:8], RedirectURIs: []string{"https://example.com/cb"},
	})
	if err != nil {
		t.Fatalf("oauth client: %v", err)
	}
	on := true
	if _, _, err := svc.UpdateOauthClient(ctx, f.Principal(), domain.UpdateOauthClientInput{
		ID: client.ID, ClientCredentialsEnabled: &on,
	}); err != nil {
		t.Fatalf("enable client credentials: %v", err)
	}
	tok, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType: "client_credentials", ClientID: client.ClientID, ClientSecret: secret, Scope: "read",
	})
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	p, err := svc.AuthenticateOauthToken(ctx, tok.AccessToken)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	return tok.AccessToken, p.UserID
}

func listRunnerRuns(t *testing.T, env *runnerEnv, issueID uuid.UUID) []store.AgentRun {
	t.Helper()
	runs, err := env.db.Queries().ListAgentRunsForIssue(context.Background(), issueID)
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	return runs
}

func withRunnerDelay(t *testing.T, d time.Duration) {
	t.Helper()
	prev := domain.DelegationDelay
	domain.DelegationDelay = d
	t.Cleanup(func() { domain.DelegationDelay = prev })
}
