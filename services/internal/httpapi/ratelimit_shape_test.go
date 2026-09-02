package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// A refusal that the caller cannot parse is a refusal that does not exist.
//
// /graphql used to answer 429 with the REST envelope, which no GraphQL client reads: the
// web client's gql() parses {data, errors} and surfaces anything else as a transport
// failure, so RATELIMITED never reached isRetriable and the outbox rolled the mutation
// back instead of queueing it. The same body on /mcp is not a JSON-RPC error object.

func TestRateLimited_OnGraphQLSpeaksGraphQL(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.GraphQL(reached())
	user := uuid.New()

	var rec *httptest.ResponseRecorder
	// tightConfig allows three requests; the fourth is the refusal under test.
	for range 4 {
		rec = serve(h, asUser(user))
	}

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("no Retry-After on the refusal")
	}

	var body struct {
		Data   any `json:"data"`
		Errors []struct {
			Message    string `json:"message"`
			Extensions struct {
				Code       string `json:"code"`
				RetryAfter int    `json:"retryAfter"`
			} `json:"extensions"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	if len(body.Errors) != 1 {
		t.Fatalf("expected one GraphQL error, got %d in %q", len(body.Errors), rec.Body.String())
	}
	// The one thing clients are told to branch on.
	if got := body.Errors[0].Extensions.Code; got != string(platform.CodeRateLimited) {
		t.Fatalf("extensions.code = %q, want %q", got, platform.CodeRateLimited)
	}
	if body.Errors[0].Extensions.RetryAfter < 1 {
		t.Fatalf("extensions.retryAfter = %d, want at least 1", body.Errors[0].Extensions.RetryAfter)
	}
	if body.Errors[0].Message == "" {
		t.Fatal("the refusal carries no message")
	}
	// The REST envelope must be gone, not merely accompanied.
	if _, ok := any(body.Data).(map[string]any); ok {
		t.Fatalf("data should be null on a refusal, got %v", body.Data)
	}
}

func TestRateLimited_OnMCPSpeaksJSONRPC(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.GraphQL(reached())
	user := uuid.New()

	var rec *httptest.ResponseRecorder
	for range 4 {
		r := asUser(user)
		r.URL.Path = "/mcp"
		rec = serve(h, r)
	}

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	var body struct {
		JSONRPC string `json:"jsonrpc"`
		Error   struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	if body.JSONRPC != "2.0" {
		t.Fatalf("jsonrpc = %q, want \"2.0\"", body.JSONRPC)
	}
	if body.Error.Code != -32000 {
		t.Fatalf("error.code = %d, want -32000", body.Error.Code)
	}
}

// Everything that is neither keeps the REST envelope it always had.
func TestRateLimited_ElsewhereKeepsTheRESTShape(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.GraphQL(reached())
	user := uuid.New()

	var rec *httptest.ResponseRecorder
	for range 4 {
		r := asUser(user)
		r.URL.Path = "/auth/refresh"
		rec = serve(h, r)
	}

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	if body.Error.Code != string(platform.CodeRateLimited) {
		t.Fatalf("error.code = %q, want %q", body.Error.Code, platform.CodeRateLimited)
	}
}

// G3: an unauthenticated POST /graphql used to be 401'd by RequireAuth before touching any
// bucket — and Authenticate has already spent a database read per attempt getting there.
// The anonymous budget now sits outside the auth gate, so the unidentified caller is
// metered by address while an identified one still bypasses it entirely.
func TestAnonymous_MetersTheUnauthenticatedGraphQLCaller(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.Anonymous(RequireAuth(limits.GraphQL(reached())))

	anon := func() *httptest.ResponseRecorder {
		return serve(h, httptest.NewRequest(http.MethodPost, "/graphql", nil))
	}

	// tightConfig allows two anonymous requests per address.
	if got := anon().Code; got != http.StatusUnauthorized {
		t.Fatalf("first attempt = %d, want 401 from RequireAuth", got)
	}
	if got := anon().Code; got != http.StatusUnauthorized {
		t.Fatalf("second attempt = %d, want 401 from RequireAuth", got)
	}
	if got := anon().Code; got != http.StatusTooManyRequests {
		t.Fatalf("third attempt = %d, want 429; the unauthenticated caller is charged to no bucket", got)
	}
}

func TestAnonymous_DoesNotMeterAnIdentifiedGraphQLCaller(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.Anonymous(reached())
	user := uuid.New()

	// Well past the two-request anonymous budget; an identified caller is budgeted by the
	// GraphQL limiter instead and must not be lumped in with their whole office.
	//
	// The account id is what Anonymous looks for, and Authenticate is what puts it there —
	// asUser only carries the principal, so it is set here the way the middleware would.
	for i := range 5 {
		r := asUser(user)
		r = r.WithContext(WithAccount(r.Context(), user))
		if got := serve(h, r).Code; got != http.StatusOK {
			t.Fatalf("attempt %d = %d, want 200", i+1, got)
		}
	}
}
