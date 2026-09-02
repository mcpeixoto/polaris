package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Three refusals that told the caller nothing they could act on.

// G11 — workspaceFromRequest returned uuid.Nil for both "no header" and "a header that will
// not parse", so `X-Polaris-Workspace: abc` was answered 401 "this request must name a
// workspace" when the client HAD named one, just badly. A 401 sends the web client into a
// token-refresh loop to fix a typo.
func TestWorkspaceFromRequest_SaysSoWhenTheIdWillNotParse(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	r.Header.Set(WorkspaceHeader, "abc")

	id, err := workspaceFromRequest(r)
	if err == nil {
		t.Fatal("a malformed workspace id was accepted as no workspace at all")
	}
	if got := platform.CodeOf(err); got != platform.CodeValidation {
		t.Fatalf("code = %s, want VALIDATION", got)
	}
	var perr *platform.Error
	if !errors.As(err, &perr) || perr.Field != "workspace" {
		t.Fatalf("the error does not name the field: %v", err)
	}
	if id != uuid.Nil {
		t.Fatalf("id = %s, want the nil uuid on a parse failure", id)
	}
}

func TestWorkspaceFromRequest_AbsentIsStillNotAnError(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/graphql", nil)

	id, err := workspaceFromRequest(r)
	if err != nil {
		t.Fatalf("a request naming no workspace was refused: %v", err)
	}
	if id != uuid.Nil {
		t.Fatalf("id = %s, want the nil uuid", id)
	}
}

func TestWorkspaceFromRequest_ReadsTheQueryStringToo(t *testing.T) {
	// The WebSocket handshake cannot set headers, which is why the query form exists.
	r := httptest.NewRequest(http.MethodGet, "/sync?workspace=not-a-uuid", nil)

	if _, err := workspaceFromRequest(r); err == nil {
		t.Fatal("a malformed workspace in the query string was accepted")
	}
}

// G12 — the comment above this branch says 403 was chosen over a silent 200 because "only
// one of them tells whoever is configuring a self-hosted install what went wrong", and then
// it wrote no body at all. The operator's only symptom was an empty 403.
func TestCORS_ARejectedPreflightSaysWhy(t *testing.T) {
	h := CORS(nil, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("a rejected preflight reached the handler")
	}))

	r := httptest.NewRequest(http.MethodOptions, "/graphql", nil)
	r.Header.Set("Origin", "https://not-allowed.example.com")
	r.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("the refusal has no readable body (%q): %v", rec.Body.String(), err)
	}
	if body.Error.Code != string(platform.CodeForbidden) {
		t.Fatalf("error.code = %q, want FORBIDDEN", body.Error.Code)
	}
	// The message has to name the setting, or it is no more useful than the empty body.
	if body.Error.Message == "" {
		t.Fatal("the refusal carries no message")
	}
}

// usableOrigin did not lowercase the host, so POLARIS_ALLOWED_ORIGINS=https://App.Example.com
// built an entry a browser's lowercase Origin could never match.
func TestCORS_AConfiguredOriginMatchesRegardlessOfCase(t *testing.T) {
	reached := false
	h := CORS([]string{"https://App.Example.COM"}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
	}))

	r := httptest.NewRequest(http.MethodOptions, "/graphql", nil)
	r.Header.Set("Origin", "https://app.example.com")
	r.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204 (body %q)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if reached {
		t.Error("a preflight was passed through to the handler")
	}
}

// G13 — abort() accepted the error and never read it, so the `end` line carried a message
// and no code. streamBootstrap could then only raise a generic INTERNAL, and the engine's
// retry policy had nothing to tell "rate limited, back off" from "retry now".
func TestBootstrapAbort_CarriesTheCode(t *testing.T) {
	rec := httptest.NewRecorder()
	w := &ndjsonWriter{w: rec}

	w.abort(platform.RateLimited("too many bootstraps"))

	var end struct {
		Kind  string `json:"kind"`
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &end); err != nil {
		t.Fatalf("decode the end line %q: %v", rec.Body.String(), err)
	}
	if end.Kind != "end" {
		t.Fatalf("kind = %q, want \"end\"", end.Kind)
	}
	if end.Code != string(platform.CodeRateLimited) {
		t.Fatalf("code = %q, want %q", end.Code, platform.CodeRateLimited)
	}
	// The message stays generic: the cause belongs in the server log, not in the response.
	if end.Error != "snapshot failed" {
		t.Fatalf("error = %q, want the generic message", end.Error)
	}
}

func TestBootstrapAbort_AnUnclassifiedErrorIsINTERNAL(t *testing.T) {
	rec := httptest.NewRecorder()
	w := &ndjsonWriter{w: rec}

	w.abort(errors.New("something from pgx"))

	var end struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &end); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if end.Code != string(platform.CodeInternal) {
		t.Fatalf("code = %q, want INTERNAL", end.Code)
	}
	// And nothing of the cause reaches the client.
	if end.Error != "snapshot failed" {
		t.Fatalf("error = %q; the cause leaked", end.Error)
	}
}
