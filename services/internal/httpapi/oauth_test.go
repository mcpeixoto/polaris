package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestAuthenticate_AnOauthAccessTokenResolvesItsPrincipal(t *testing.T) {
	h := newOauthHarness(t)

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer "+h.access)

	got := h.serve(req)
	if got.status != http.StatusOK {
		t.Fatalf("an OAuth token was refused: %d %s", got.status, got.body)
	}
	if got.principal == nil {
		t.Fatal("no principal reached the handler")
	}
	if got.principal.UserID != h.fixture.UserID {
		t.Errorf("principal is user %s, want the authorizing user %s", got.principal.UserID, h.fixture.UserID)
	}
	if got.accountID != h.fixture.AccountID {
		t.Errorf("account is %s, want %s — RequireAuth would refuse this", got.accountID, h.fixture.AccountID)
	}
}

func TestAuthenticate_ABogusOauthTokenIsUnauthorized(t *testing.T) {
	h := newOauthHarness(t)

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer pla_notarealtokenatall")

	got := h.serve(req)
	if got.status != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401: %s", got.status, got.body)
	}
}

func TestOauthTokenEndpoint_IssuesABearerToken(t *testing.T) {
	h := newOauthHarness(t)

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {h.code},
		"redirect_uri":  {"https://example.com/cb"},
		"client_id":     {h.clientID},
		"client_secret": {h.clientSecret},
	}
	req := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("token endpoint %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		RefreshToken string `json:"refresh_token"`
		Scope        string `json:"scope"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.HasPrefix(body.AccessToken, "pla_") || body.TokenType != "Bearer" {
		t.Errorf("unexpected token response %+v", body)
	}
}

type oauthHarness struct {
	t             *testing.T
	svc           *domain.Service
	fixture       *testutil.Fixture
	access        string
	clientID      string
	clientSecret  string
	code          string
	handler       http.Handler
	router        http.Handler
	lastPrincipal *authz.Principal
	lastAccount   uuid.UUID
}

type oauthProbeResult struct {
	status    int
	body      string
	principal *authz.Principal
	accountID uuid.UUID
}

func newOauthHarness(t *testing.T) *oauthHarness {
	t.Helper()

	db := testutil.NewDB(t)
	fixture := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	client, secret, _, err := svc.CreateOauthClient(ctx, fixture.Principal(), domain.CreateOauthClientInput{
		Name:         "integration",
		RedirectURIs: []string{"https://example.com/cb"},
	})
	if err != nil {
		t.Fatalf("create oauth client: %v", err)
	}
	authzOut, err := svc.CreateOauthAuthorization(ctx, fixture.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:     client.ClientID,
		RedirectURI:  "https://example.com/cb",
		ResponseType: "code",
		Scope:        "read",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	code := oauthQueryParam(authzOut.RedirectURI, "code")

	tok, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         code,
		RedirectURI:  "https://example.com/cb",
		ClientID:     client.ClientID,
		ClientSecret: secret,
	})
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}

	// A second code so the HTTP token endpoint test can exchange without colliding.
	authzOut2, err := svc.CreateOauthAuthorization(ctx, fixture.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:     client.ClientID,
		RedirectURI:  "https://example.com/cb",
		ResponseType: "code",
		Scope:        "read",
	})
	if err != nil {
		t.Fatalf("authorize 2: %v", err)
	}

	h := &oauthHarness{
		t:            t,
		svc:          svc,
		fixture:      fixture,
		access:       tok.AccessToken,
		clientID:     client.ClientID,
		clientSecret: secret,
		code:         oauthQueryParam(authzOut2.RedirectURI, "code"),
	}

	tokens := httpapi.NewTokens("test-secret-not-used-by-these-tests", time.Minute)
	h.handler = httpapi.Authenticate(tokens, svc)(http.HandlerFunc(h.probe))
	h.router = httpapi.NewRouter(httpapi.Deps{Service: svc, Tokens: tokens})
	return h
}

func (h *oauthHarness) probe(w http.ResponseWriter, r *http.Request) {
	if p, ok := authz.PrincipalFrom(r.Context()); ok {
		h.lastPrincipal = p
	}
	if id, ok := httpapi.AccountFrom(r.Context()); ok {
		h.lastAccount = id
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "ok")
}

func (h *oauthHarness) serve(req *http.Request) oauthProbeResult {
	h.lastPrincipal = nil
	h.lastAccount = uuid.Nil

	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	return oauthProbeResult{
		status:    rec.Code,
		body:      rec.Body.String(),
		principal: h.lastPrincipal,
		accountID: h.lastAccount,
	}
}

func oauthQueryParam(rawURL, key string) string {
	_, after, ok := strings.Cut(rawURL, "?")
	if !ok {
		return ""
	}
	for _, part := range strings.Split(after, "&") {
		k, v, found := strings.Cut(part, "=")
		if found && k == key {
			return v
		}
	}
	return ""
}
