package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The MCP and OAuth paths answer any origin, because the clients cannot be enumerated. The
// risk that buys is that the wildcard leaks onto a path that authenticates with a cookie,
// or that somebody pairs it with Allow-Credentials to "fix" the desktop app. Both are
// tested below, and both are the reason this file is separate from cors_test.go.

// publicPaths is isPublicCORSPath's list, restated. Deliberately not shared with the
// implementation: a table that reads the thing it is checking proves nothing.
var publicPaths = []string{
	"/mcp",
	"/mcp/readonly",
	"/oauth/register",
	"/oauth/token",
	"/oauth/revoke",
	"/.well-known/oauth-protected-resource",
	"/.well-known/oauth-protected-resource/mcp",
	"/.well-known/oauth-authorization-server",
	"/.well-known/oauth-authorization-server/mcp",
}

func doPath(h http.Handler, method, path, origin string, preflight bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if preflight {
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// evil.example succeeding is the correct answer here and the test says so out loud: on a
// path where no ambient credential exists, an unknown origin is every origin, and the
// alternative is the 403 that stopped Claude connecting.
func TestPublicCORS_PreflightSucceedsFromAnyOrigin(t *testing.T) {
	h := handler()
	for _, path := range publicPaths {
		for _, origin := range []string{
			"https://claude.ai",
			"https://claude.com",
			"https://inspector.modelcontextprotocol.io",
			"https://evil.example",
		} {
			rec := doPath(h, http.MethodOptions, path, origin, true)
			if rec.Code != http.StatusNoContent {
				t.Errorf("%s from %s: status %d, want 204", path, origin, rec.Code)
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
				t.Errorf("%s from %s: Allow-Origin = %q, want *", path, origin, got)
			}
			if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
				t.Errorf("%s from %s: Allow-Credentials = %q, want empty", path, origin, got)
			}
		}
	}
}

// A preflight with no Origin at all still gets the wildcard, so the response is identical
// whoever asks and a shared cache cannot hand one caller another's policy.
func TestPublicCORS_AnswersTheSameWithNoOrigin(t *testing.T) {
	rec := doPath(handler(), http.MethodOptions, "/mcp", "", true)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Allow-Origin = %q, want *", got)
	}
}

func TestPublicCORS_PreflightAdvertisesTheMCPHeaders(t *testing.T) {
	rec := doPath(handler(), http.MethodOptions, "/mcp", "https://claude.ai", true)

	// Named one at a time so a failure says which header went missing.
	allowed := rec.Header().Get("Access-Control-Allow-Headers")
	for _, h := range []string{
		"Authorization", "Content-Type", "Accept",
		"Mcp-Session-Id", "MCP-Protocol-Version", "Last-Event-ID",
	} {
		if !strings.Contains(allowed, h) {
			t.Errorf("Allow-Headers %q is missing %s", allowed, h)
		}
	}
	methods := rec.Header().Get("Access-Control-Allow-Methods")
	for _, m := range []string{"GET", "POST", "DELETE", "OPTIONS"} {
		if !strings.Contains(methods, m) {
			t.Errorf("Allow-Methods %q is missing %s", methods, m)
		}
	}
	if got := rec.Header().Get("Access-Control-Max-Age"); got != corsMaxAge {
		t.Errorf("Max-Age = %q, want %q", got, corsMaxAge)
	}
}

// Without this a browser client reads a bare 401 and never sees the resource_metadata=
// pointer, so discovery dead-ends on a header it is not allowed to look at.
func TestPublicCORS_ExposesWWWAuthenticate(t *testing.T) {
	rec := doPath(handler(), http.MethodGet, "/.well-known/oauth-protected-resource", "https://claude.ai", false)

	exposed := rec.Header().Get("Access-Control-Expose-Headers")
	for _, h := range []string{"WWW-Authenticate", "Mcp-Session-Id"} {
		if !strings.Contains(exposed, h) {
			t.Errorf("Expose-Headers %q is missing %s", exposed, h)
		}
	}
	if rec.Body.String() != "reached" {
		t.Error("a non-preflight request must still reach the handler")
	}
}

// The containment test. The near-misses matter as much as the real paths: a prefix match
// instead of an exact one would open every one of them.
func TestPublicCORS_DoesNotLeakOntoCookieRoutes(t *testing.T) {
	h := handler()
	for _, path := range []string{
		"/graphql",
		"/auth/login",
		"/auth/refresh",
		"/sync/bootstrap",
		"/billing/config",
		"/files/x",
		"/oauth/authorize",
		"/mcpx",
		"/oauth/registerx",
		"/.well-known/oauth-protected-resource-evil",
		"/.well-known/oauth-authorization-server-evil",
	} {
		rec := doPath(h, http.MethodOptions, path, "https://evil.example", true)
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s: preflight status %d, want 403", path, rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got == "*" {
			t.Errorf("%s: answered with a wildcard; it is a cookie-authenticated path", path)
		}
	}
}

// A wildcard with credentials is refused outright by every browser, so blessing an origin
// that IS on the allowlist would break the clients the wildcard exists for. This is the
// most likely regression: somebody adds claude.ai to POLARIS_ALLOWED_ORIGINS and the
// credentialed branch starts firing first.
func TestPublicCORS_NeverPairsWildcardWithCredentials(t *testing.T) {
	h := handler("https://claude.ai")
	for _, path := range publicPaths {
		for _, origin := range []string{desktopOrigin, "https://claude.ai"} {
			rec := doPath(h, http.MethodOptions, path, origin, true)
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
				t.Errorf("%s from %s: Allow-Origin = %q, want *", path, origin, got)
			}
			if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
				t.Errorf("%s from %s: Allow-Credentials = %q, want empty", path, origin, got)
			}
		}
	}
}

// /mcp/ would 404 at the mux. It must not fall into the credentialed branch on the way
// there and answer a preflight with a 403 that says the wrong thing.
func TestPublicCORS_ToleratesATrailingSlash(t *testing.T) {
	rec := doPath(handler(), http.MethodOptions, "/mcp/", "https://claude.ai", true)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status %d, want 204", rec.Code)
	}
}
