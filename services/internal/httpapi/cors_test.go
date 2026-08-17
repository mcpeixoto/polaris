package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The CORS policy is the one place where a mistake hands somebody else's website a
// working, authenticated client of a user's workspace. Every case below is a way that has
// actually happened to somebody.

func handler(extra ...string) http.Handler {
	return CORS(extra, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("reached"))
	}))
}

func do(h http.Handler, method, origin string, preflight bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/graphql", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if preflight {
		req.Header.Set("Access-Control-Request-Method", "POST")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCORS_AllowsTheDesktopApp(t *testing.T) {
	rec := do(handler(), http.MethodPost, desktopOrigin, false)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != desktopOrigin {
		t.Errorf("Allow-Origin = %q, want %q", got, desktopOrigin)
	}
	// Without this the browser discards the response of every authenticated request, and
	// the symptom is a desktop app that signs in and then behaves as if signed out.
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Allow-Credentials = %q, want true", got)
	}
	if rec.Body.String() != "reached" {
		t.Error("an allowed origin must still reach the handler")
	}
}

// The reflex fix for a CORS problem is to echo back whatever Origin arrived. With
// credentials that turns every website the user visits into a client of their workspace,
// authenticated with their own cookies.
func TestCORS_DoesNotEchoAnUnknownOrigin(t *testing.T) {
	for _, origin := range []string{
		"https://evil.example",
		"https://polaris-app.evil.example",
		desktopOrigin + ".evil.example",
		"null",
		"file://",
	} {
		rec := do(handler(), http.MethodPost, origin, false)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("origin %q was allowed with %q", origin, got)
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
			t.Errorf("origin %q was given credentials", origin)
		}
	}
}

// `null` is the origin of a file:// page — and of every sandboxed iframe on the internet.
// Allowlisting it to make a file-loaded desktop build work would hand a session to any page
// that framed one. The desktop app serves its renderer from its own scheme instead.
func TestCORS_NeverAllowsTheNullOrigin(t *testing.T) {
	rec := do(handler("null"), http.MethodPost, "null", false)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got == "null" {
		t.Fatal("the null origin was allowed even though it was configured; it must never be")
	}
}

func TestCORS_PreflightAnswersWithoutReachingTheHandler(t *testing.T) {
	rec := do(handler(), http.MethodOptions, desktopOrigin, true)

	if rec.Code != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", rec.Code)
	}
	if rec.Body.String() != "" {
		t.Error("a preflight must not reach the handler")
	}
	for header, want := range map[string]string{
		"Access-Control-Allow-Methods": "POST",
		"Access-Control-Allow-Headers": "X-Polaris-Workspace",
	} {
		if !strings.Contains(rec.Header().Get(header), want) {
			t.Errorf("%s = %q, want it to contain %q", header, rec.Header().Get(header), want)
		}
	}
}

// Reflecting Access-Control-Request-Headers would let a cross-origin caller nominate its
// own headers and have the server bless them, which is the whole thing a preflight exists
// to prevent.
func TestCORS_DoesNotReflectRequestedHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/graphql", nil)
	req.Header.Set("Origin", desktopOrigin)
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "X-Attacker-Chosen")

	rec := httptest.NewRecorder()
	handler().ServeHTTP(rec, req)

	if strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), "X-Attacker-Chosen") {
		t.Error("requested headers were reflected instead of allowlisted")
	}
}

func TestCORS_RefusesAPreflightFromAnUnknownOrigin(t *testing.T) {
	rec := do(handler(), http.MethodOptions, "https://evil.example", true)
	// 403 rather than a 200 with no headers: both stop the real request, and only one of
	// them tells a self-hoster what they got wrong.
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}

// Without Vary, a shared cache can serve one origin's Access-Control-Allow-Origin to
// another — or serve a cached no-CORS response to the desktop app, which then fails with
// nothing in any log to explain it.
func TestCORS_AlwaysVariesOnOrigin(t *testing.T) {
	for _, origin := range []string{"", desktopOrigin, "https://evil.example"} {
		rec := do(handler(), http.MethodPost, origin, false)
		if !strings.Contains(rec.Header().Get("Vary"), "Origin") {
			t.Errorf("origin %q: Vary = %q, want it to contain Origin", origin, rec.Header().Get("Vary"))
		}
	}
}

func TestCORS_AllowsConfiguredExtraOrigins(t *testing.T) {
	h := handler("https://polaris.acme.example/", "  https://staging.acme.example  ")

	for _, origin := range []string{"https://polaris.acme.example", "https://staging.acme.example"} {
		rec := do(h, http.MethodPost, origin, false)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("configured origin %q was not allowed (got %q) — trailing slashes and "+
				"whitespace are exactly what somebody pastes into an env var", origin, got)
		}
	}
}

// A same-origin request has no Origin header at all and must be completely unaffected —
// the web client is served by this process and is the overwhelming majority of traffic.
func TestCORS_LeavesSameOriginRequestsAlone(t *testing.T) {
	rec := do(handler(), http.MethodPost, "", false)

	if rec.Body.String() != "reached" {
		t.Error("a same-origin request must reach the handler")
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("a same-origin request must not be given CORS headers")
	}
}
