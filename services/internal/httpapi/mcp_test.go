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

func TestMCP_ListsAndCreatesIssuesWithAnAPIKey(t *testing.T) {
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

	tokens := httpapi.NewTokens("test-secret-not-used", time.Minute)
	router := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  tokens,
		Config:  platform.Config{PublicURL: "http://polaris.test"},
	})

	initBody := mcpCall(t, router, token, "initialize", nil)
	if !strings.Contains(initBody, `"name":"polaris"`) {
		t.Fatalf("initialize: %s", initBody)
	}

	listed := mcpCall(t, router, token, "tools/list", nil)
	if !strings.Contains(listed, `"create_issue"`) {
		t.Fatalf("tools/list missing create_issue: %s", listed)
	}

	created := mcpCall(t, router, token, "tools/call", map[string]any{
		"name": "create_issue",
		"arguments": map[string]any{
			"title": "From MCP",
			"team":  f.TeamKey,
		},
	})
	if !strings.Contains(created, "From MCP") || strings.Contains(created, `"isError":true`) {
		t.Fatalf("create_issue: %s", created)
	}

	readonly := mcpCallPath(t, router, token, "/mcp/readonly", "tools/list", nil)
	if strings.Contains(readonly, `"create_issue"`) {
		t.Fatalf("readonly tools/list exposed a write tool: %s", readonly)
	}

	blocked := mcpCallPath(t, router, token, "/mcp/readonly", "tools/call", map[string]any{
		"name": "create_issue",
		"arguments": map[string]any{"title": "nope", "team": f.TeamKey},
	})
	if !strings.Contains(blocked, "read-only") {
		t.Fatalf("readonly create_issue: %s", blocked)
	}

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte(
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status %d", rec.Code)
	}
	if rec.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("unauthenticated /mcp must send WWW-Authenticate")
	}

	meta := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, meta)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "/mcp") {
		t.Fatalf("protected resource metadata: %d %s", rec.Code, rec.Body.String())
	}
}

func mcpCall(t *testing.T, h http.Handler, token, method string, params any) string {
	t.Helper()
	return mcpCallPath(t, h, token, "/mcp", method, params)
}

func mcpCallPath(t *testing.T, h http.Handler, token, path, method string, params any) string {
	t.Helper()
	payload := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		payload["params"] = params
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s %s: status %d body %s", path, method, rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}
