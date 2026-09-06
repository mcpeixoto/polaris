package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// These go through the real router because the thing being proven is that an MCP client
// which has never heard of this server can complete registration over HTTP with no
// credential in hand. A domain-level test cannot show that: the route being reachable
// unauthenticated is half of what makes it work.

func registerRouter(t *testing.T) http.Handler {
	t.Helper()
	db := testutil.NewDB(t)
	return httpapi.NewRouter(httpapi.Deps{
		Service: domain.NewService(db),
		Tokens:  httpapi.NewTokens("test-secret-long-enough-for-hmac", 0),
		Config: platform.Config{
			Env:       "development",
			JWTSecret: "test-secret-long-enough-for-hmac",
			PublicURL: "https://polaris.example.com",
		},
	})
}

func postJSON(t *testing.T, h http.Handler, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestOauthRegister_AnonymousClientGetsAnIdentityAndNoSecret(t *testing.T) {
	h := registerRouter(t)

	status, body := postJSON(t, h, "/oauth/register", `{
		"client_name": "Claude Code",
		"redirect_uris": ["http://localhost:33418/callback"],
		"grant_types": ["authorization_code", "refresh_token"],
		"response_types": ["code"],
		"token_endpoint_auth_method": "none",
		"scope": "read write"
	}`)

	if status != http.StatusCreated {
		t.Fatalf("status %d, want 201: %v", status, body)
	}
	id, _ := body["client_id"].(string)
	if !strings.HasPrefix(id, "pol_") {
		t.Errorf("client_id %q should use the pol_ prefix", id)
	}
	// The whole point of a public client: there is no secret to leak, so none is returned.
	if _, ok := body["client_secret"]; ok {
		t.Error("a public client registration returned a client_secret")
	}
	if got := body["token_endpoint_auth_method"]; got != "none" {
		t.Errorf("token_endpoint_auth_method %v, want none", got)
	}
	if _, ok := body["client_id_issued_at"]; !ok {
		t.Error("client_id_issued_at is required by RFC 7591")
	}
}

// Telling the client now beats letting it discover at its first token exchange that the
// secret it expected was never issued — that failure looks like a bad credential.
func TestOauthRegister_RefusesASecretBasedAuthMethod(t *testing.T) {
	h := registerRouter(t)

	status, body := postJSON(t, h, "/oauth/register", `{
		"client_name": "Confidential",
		"redirect_uris": ["https://example.com/cb"],
		"token_endpoint_auth_method": "client_secret_basic"
	}`)

	if status != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %v", status, body)
	}
	if body["error"] != "invalid_client_metadata" {
		t.Errorf("error %v, want invalid_client_metadata", body["error"])
	}
}

func TestOauthRegister_RefusesARemoteHTTPRedirect(t *testing.T) {
	h := registerRouter(t)

	status, _ := postJSON(t, h, "/oauth/register", `{
		"client_name": "Cleartext",
		"redirect_uris": ["http://example.com/cb"]
	}`)

	if status != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 for a non-loopback http redirect", status)
	}
}

// A client discovers where to register by reading this document. If the endpoint is
// missing from it, dynamic registration may as well not exist.
func TestWellKnown_AdvertisesTheRegistrationEndpoint(t *testing.T) {
	h := registerRouter(t)

	for _, path := range []string{
		"/.well-known/oauth-authorization-server",
		"/.well-known/oauth-authorization-server/mcp",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status %d, want 200", rec.Code)
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got := body["registration_endpoint"]; got != "https://polaris.example.com/oauth/register" {
				t.Errorf("registration_endpoint %v", got)
			}
		})
	}
}
