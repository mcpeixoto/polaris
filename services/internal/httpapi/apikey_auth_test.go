package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// An API key authenticates a request, which for a long time it did not.
//
// `domain.AuthenticateApiKey` was complete, careful and tested — and nothing called it.
// `Authenticate` parsed JWTs only, so a `plk_` key fell through to `Tokens.Parse`, failed to
// be a JWT, and came back "invalid or expired token". That answer is worse than a bare 401:
// it names the one remedy that cannot work, because a key has no refresh flow, so its holder
// goes looking for an expiry that is not there on a credential that was perfectly valid.
//
// Every integration, script and agent authenticates this way. The keys screen minted them,
// the listing showed them, and not one of them could make a request — which is the shape of
// bug that unit tests are structurally blind to, because both halves were correct and only
// the wire between them was missing.
//
// These tests go through the real middleware against a real database, because the thing under
// test is a wire and a wire cannot be faked without also faking what it proves.

func TestAuthenticate_AnAPIKeyResolvesToItsOwnersPrincipal(t *testing.T) {
	h := newAPIKeyHarness(t)

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)

	got := h.serve(req)

	if got.status != http.StatusOK {
		t.Fatalf("an API key was refused: %d %s", got.status, got.body)
	}
	if got.principal == nil {
		t.Fatal("no principal reached the handler, so every authorised route would have refused this request")
	}
	// The key contributes no identity of its own: it acts as the user who created it.
	if got.principal.UserID != h.fixture.UserID {
		t.Errorf("principal is user %s, want the key's owner %s", got.principal.UserID, h.fixture.UserID)
	}
	if got.principal.WorkspaceID != h.fixture.WorkspaceID {
		t.Errorf("principal is in workspace %s, want %s", got.principal.WorkspaceID, h.fixture.WorkspaceID)
	}
	// RequireAuth gates /graphql on the account, not the principal, so a key that resolved a
	// principal and no account would still be refused everywhere that matters.
	if got.accountID != h.fixture.AccountID {
		t.Errorf("account is %s, want %s — RequireAuth would refuse this", got.accountID, h.fixture.AccountID)
	}
}

func TestAuthenticate_AnAPIKeyNeedsNoWorkspaceHeader(t *testing.T) {
	// A key belongs to exactly one workspace, so making an integration send a header naming
	// the workspace its own credential already names would be ceremony that can only be got
	// wrong.
	h := newAPIKeyHarness(t)

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)

	got := h.serve(req)
	if got.status != http.StatusOK || got.principal == nil {
		t.Fatalf("a key with no workspace header was refused: %d %s", got.status, got.body)
	}
}

func TestAuthenticate_AnAPIKeyIsRefusedForAWorkspaceItIsNotIn(t *testing.T) {
	// Refused rather than ignored. Answering a request that asked about workspace B with
	// data from workspace A hands the caller the wrong answer with no way to notice — and
	// "the key acts in its owner's workspace and never another" is the rule the whole
	// apikeys file is built around.
	h := newAPIKeyHarness(t)

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)
	req.Header.Set(httpapi.WorkspaceHeader, uuid.Must(uuid.NewV7()).String())

	got := h.serve(req)
	if got.status != http.StatusUnauthorized {
		t.Fatalf("a key was accepted for a workspace it does not belong to: %d %s", got.status, got.body)
	}
	if got.principal != nil {
		t.Error("a principal reached the handler for a workspace the key is not in")
	}
}

func TestAuthenticate_ARevokedKeyIsRefused(t *testing.T) {
	h := newAPIKeyHarness(t)

	if _, _, err := h.svc.RevokeApiKey(context.Background(), h.fixture.Principal(), h.keyID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)

	got := h.serve(req)
	if got.status != http.StatusUnauthorized {
		t.Fatalf("a revoked key still authenticates: %d %s", got.status, got.body)
	}
}

func TestAuthenticate_AMalformedKeyDoesNotReachTheJWTPath(t *testing.T) {
	// The prefix decides which authenticator runs, so something shaped like a key is
	// answered as a bad key rather than as an expired session. The two remedies are
	// different and only one of them exists for a key.
	h := newAPIKeyHarness(t)

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer plk_notarealkeyatall")

	got := h.serve(req)
	if got.status != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401: %s", got.status, got.body)
	}
	if !strings.Contains(got.body, "API key") {
		t.Errorf("a bad key was reported as %q — it should say it is the key that is wrong, "+
			"not send the caller to a refresh flow that keys do not have", got.body)
	}
}

// --- harness ---------------------------------------------------------------------------

type apiKeyHarness struct {
	t       *testing.T
	svc     *domain.Service
	fixture *testutil.Fixture
	token   string
	keyID   uuid.UUID
	handler http.Handler

	// What the probe handler saw on the most recent request. The question these tests ask
	// is entirely "what reached the handler", so the handler is what records it.
	lastPrincipal *authz.Principal
	lastAccount   uuid.UUID
}

type probeResult struct {
	status    int
	body      string
	principal *authz.Principal
	accountID uuid.UUID
}

func newAPIKeyHarness(t *testing.T) *apiKeyHarness {
	t.Helper()

	db := testutil.NewDB(t)
	fixture := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	key, token, _, err := svc.CreateApiKey(context.Background(), fixture.Principal(), domain.CreateApiKeyInput{
		Name: "integration",
	})
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	h := &apiKeyHarness{t: t, svc: svc, fixture: fixture, token: token, keyID: key.ID}

	// The real middleware, in the order the router builds it.
	tokens := httpapi.NewTokens("test-secret-not-used-by-these-tests", time.Minute)
	h.handler = httpapi.Authenticate(tokens, svc)(http.HandlerFunc(h.probe))
	return h
}

// probe records what actually reached a handler, which is the whole question here.
func (h *apiKeyHarness) probe(w http.ResponseWriter, r *http.Request) {
	if p, ok := authz.PrincipalFrom(r.Context()); ok {
		h.lastPrincipal = p
	}
	if id, ok := httpapi.AccountFrom(r.Context()); ok {
		h.lastAccount = id
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (h *apiKeyHarness) serve(req *http.Request) probeResult {
	h.lastPrincipal = nil
	h.lastAccount = uuid.Nil

	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	return probeResult{
		status:    rec.Code,
		body:      rec.Body.String(),
		principal: h.lastPrincipal,
		accountID: h.lastAccount,
	}
}
