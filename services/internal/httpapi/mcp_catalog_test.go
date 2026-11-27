package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

func TestMCPCatalog_RouteRequiresTheSameAuthChallengeAsMCP(t *testing.T) {
	h := NewRouter(Deps{Config: platform.Config{PublicURL: "http://polaris.test"}})

	code, challenge := mcpChallenge(t, h, "/mcp/catalog")
	if code == http.StatusNotFound {
		t.Fatal("/mcp/catalog is not registered")
	}
	if code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", code)
	}
	if challenge == "" {
		t.Fatal("unauthenticated /mcp/catalog must send WWW-Authenticate")
	}

	_, plain := mcpChallenge(t, h, "/mcp")
	if challenge != plain {
		t.Fatalf("WWW-Authenticate %q, /mcp sends %q", challenge, plain)
	}
}

func TestMCPCatalog_PreflightIsAllowedFromAnyOrigin(t *testing.T) {
	h := NewRouter(Deps{Config: platform.Config{PublicURL: "http://polaris.test"}})

	req := httptest.NewRequest(http.MethodOptions, "/mcp/catalog", nil)
	req.Header.Set("Origin", "https://claude.ai")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Allow-Origin = %q, want *", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("Allow-Credentials = %q, want empty", got)
	}
}

func TestMCPCatalog_CountsAsAnMCPPathForRateLimiting(t *testing.T) {
	if !isMCPPath("/mcp/catalog") {
		t.Fatal("/mcp/catalog is not classified as an MCP path, so a 429 would not be JSON-RPC")
	}
	for _, path := range []string{"/mcp", "/mcp/readonly"} {
		if !isMCPPath(path) {
			t.Errorf("%s stopped counting as an MCP path", path)
		}
	}
	if isMCPPath("/mcp/catalog/extra") || isMCPPath("/graphql") {
		t.Fatal("isMCPPath matched a path that is not an MCP endpoint")
	}
}

func mcpChallenge(t *testing.T, h http.Handler, path string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(
		`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Header().Get("WWW-Authenticate")
}
