package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// /mcp answers any origin with a wildcard, which is only safe because nothing on that path
// reads an ambient credential. Until now the 403 preflight stood in front of that property
// by accident; these tests stand in front of it on purpose.

// The invariant the wildcard rests on. A session cookie is not a credential anywhere on
// the MCP surface: Authenticate resolves a caller from Authorization: Bearer and nothing
// else. If anybody ever adds a cookie fallback, this fails, and it should — a wildcard
// over a cookie-authenticated endpoint is a cross-site request forgery with extra steps.
func TestMCP_CookieAloneIsNotACredential(t *testing.T) {
	db := testutil.NewDB(t)
	router := httpapi.NewRouter(httpapi.Deps{
		Service: domain.NewService(db),
		Tokens:  httpapi.NewTokens("test-secret-long-enough-for-hmac", time.Minute),
		Config: platform.Config{
			Env:              "development",
			JWTSecret:        "test-secret-long-enough-for-hmac",
			PublicURL:        "https://polaris.example.com",
			RegistrationMode: platform.RegistrationOpen,
		},
	})

	// A genuinely valid refresh cookie, minted the way a browser gets one. A made-up
	// cookie value would pass this test even if the fallback existed.
	signUp := httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(
		`{"email":"cookie@example.com","password":"correct-horse-battery-staple","displayName":"Cookie"}`))
	signUp.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, signUp)
	if rec.Code != http.StatusOK {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}
	var refresh *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "polaris_refresh" {
			refresh = c
		}
	}
	if refresh == nil {
		t.Fatal("register issued no refresh cookie; this test can no longer prove anything")
	}

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte(
		`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req.AddCookie(refresh)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401: a cookie must not authenticate /mcp", rec.Code)
	}
	if rec.Header().Get("WWW-Authenticate") == "" {
		t.Error("the 401 must still carry the OAuth challenge")
	}
}

// Discovery retries. If the preflight were charged to the anonymous budget, a client
// walking the OAuth flow could 429 itself out of ever connecting.
func TestMCP_PreflightIsNotRateLimited(t *testing.T) {
	router := registerRouter(t)

	for i := range 30 {
		req := httptest.NewRequest(http.MethodOptions, "/mcp", nil)
		req.Header.Set("Origin", "https://claude.ai")
		req.Header.Set("Access-Control-Request-Method", "POST")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("preflight %d: status %d, want 204", i+1, rec.Code)
		}
	}
}

// The end-to-end shape of the browser flow: preflight, then the real call. Both halves
// have to carry the wildcard or the browser discards the response it just allowed.
func TestMCP_PreflightThenPostFromClaudeAI(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	_, token, _, err := svc.CreateApiKey(t.Context(), f.Principal(), domain.CreateApiKeyInput{
		Name:   "mcp",
		Scopes: []string{domain.APIKeyScopeWrite},
	})
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}
	router := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens("test-secret-not-used", time.Minute),
		Config:  platform.Config{PublicURL: "https://polaris.example.com"},
	})

	pre := httptest.NewRequest(http.MethodOptions, "/mcp", nil)
	pre.Header.Set("Origin", "https://claude.ai")
	pre.Header.Set("Access-Control-Request-Method", "POST")
	pre.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pre)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status %d, want 204", rec.Code)
	}

	call := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte(
		`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`)))
	call.Header.Set("Content-Type", "application/json")
	call.Header.Set("Authorization", "Bearer "+token)
	call.Header.Set("Origin", "https://claude.ai")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, call)

	if rec.Code != http.StatusOK {
		t.Fatalf("tools/list status %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Allow-Origin = %q, want *", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("Allow-Credentials = %q, want empty", got)
	}
}

// The icon and the identity a connector card shows. Before this the serverInfo was a name
// and a version, and every client fell back to its own generic placeholder.
func TestMCP_InitializeAdvertisesIconsAndWebsite(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	_, token, _, err := svc.CreateApiKey(t.Context(), f.Principal(), domain.CreateApiKeyInput{
		Name:   "mcp",
		Scopes: []string{domain.APIKeyScopeRead},
	})
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}
	router := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens("test-secret-not-used", time.Minute),
		Config:  platform.Config{PublicURL: "https://polaris.example.com"},
	})

	body := mcpCall(t, router, token, "initialize", nil)
	var out struct {
		Result struct {
			ServerInfo struct {
				Title       string `json:"title"`
				Description string `json:"description"`
				WebsiteURL  string `json:"websiteUrl"`
				Icons       []struct {
					Src      string   `json:"src"`
					MimeType string   `json:"mimeType"`
					Sizes    []string `json:"sizes"`
				} `json:"icons"`
			} `json:"serverInfo"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("decode initialize: %v (%s)", err, body)
	}

	info := out.Result.ServerInfo
	if info.Title != "Polaris" || info.Description == "" {
		t.Errorf("serverInfo title/description = %q/%q", info.Title, info.Description)
	}
	if info.WebsiteURL != "https://polaris.example.com" {
		t.Errorf("websiteUrl = %q", info.WebsiteURL)
	}
	if len(info.Icons) == 0 {
		t.Fatal("serverInfo carries no icons; the connector card falls back to a placeholder")
	}
	for _, icon := range info.Icons {
		// Absolute by requirement: the client fetching these is not the browser that
		// loaded the site and has no base URL to resolve a relative path against.
		if !strings.HasPrefix(icon.Src, "https://polaris.example.com/") {
			t.Errorf("icon src %q is not absolute against PublicURL", icon.Src)
		}
		if len(icon.Sizes) == 0 || icon.MimeType == "" {
			t.Errorf("icon %q is missing mimeType or sizes", icon.Src)
		}
		if strings.HasSuffix(icon.Src, ".svg") != (icon.MimeType == "image/svg+xml") {
			t.Errorf("icon %q declares mimeType %q", icon.Src, icon.MimeType)
		}
	}
}
