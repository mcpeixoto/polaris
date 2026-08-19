package httpapi_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func githubRouter(t *testing.T, cfg platform.Config) (http.Handler, *testutil.Fixture, *domain.Service) {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	if cfg.JWTSecret == "" {
		cfg.JWTSecret = "test-secret-long-enough-for-hmac"
	}
	if cfg.AccessTokenTTL == 0 {
		cfg.AccessTokenTTL = time.Minute
	}
	if cfg.PublicURL == "" {
		cfg.PublicURL = "https://polaris.example"
	}
	h := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL),
		Config:  cfg,
	})
	return h, f, svc
}

func signGitHub(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestGitHubEvents_RefuseABadSignature(t *testing.T) {
	h, _, _ := githubRouter(t, platform.Config{GitHubWebhookSecret: "app-secret"})
	body := `{"zen":"x"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/github", strings.NewReader(body))
	req.Header.Set("X-Hub-Signature-256", "sha256=deadbeef")
	req.Header.Set("X-GitHub-Event", "ping")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestGitHubEvents_PingWithAValidSignature(t *testing.T) {
	const secret = "app-secret"
	h, _, _ := githubRouter(t, platform.Config{GitHubWebhookSecret: secret})
	body := []byte(`{"zen":"x"}`)
	req := httptest.NewRequest(http.MethodPost, "/webhooks/github", strings.NewReader(string(body)))
	req.Header.Set("X-Hub-Signature-256", signGitHub(secret, body))
	req.Header.Set("X-GitHub-Event", "ping")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestGitHubOAuthStart_RequiresConfiguredCredentials(t *testing.T) {
	h, f, _ := githubRouter(t, platform.Config{})
	tokens := httpapi.NewTokens("test-secret-long-enough-for-hmac", time.Minute)
	tok, err := tokens.Issue(auth.Claims{AccountID: f.AccountID})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/auth/github/start?workspace="+f.WorkspaceID.String(), nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s — missing OAuth env must be a clear error, not a redirect to GitHub", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "POLARIS_GITHUB_CLIENT_ID") {
		t.Fatalf("the error must name the env vars: %s", rec.Body.String())
	}
}
