package httpapi_test

import (
	"net/http"
	"testing"
)

// RFC 7591 §3.2.1 lets the server answer with metadata other than what was asked for. The
// endpoint used to 400 instead, and that is what "Couldn't register with polaris's sign-in
// service" was: Claude's registration asks for client_secret_post and the OIDC scopes its
// OAuth library emits, and got a hard refusal for both.

func TestOauthRegister_DowngradesASecretBasedAuthMethod(t *testing.T) {
	h := registerRouter(t)

	for _, method := range []string{"client_secret_post", "client_secret_basic"} {
		status, body := postJSON(t, h, "/oauth/register", `{
			"client_name": "Confidential",
			"redirect_uris": ["https://example.com/cb"],
			"token_endpoint_auth_method": "`+method+`"
		}`)

		if status != http.StatusCreated {
			t.Fatalf("%s: status %d, want 201: %v", method, status, body)
		}
		// The answer to the worry the old 400 was built on: the client learns at
		// registration that it has no secret, not at its first token exchange.
		if body["token_endpoint_auth_method"] != "none" {
			t.Errorf("%s: token_endpoint_auth_method = %v, want none", method, body["token_endpoint_auth_method"])
		}
		if _, ok := body["client_secret"]; ok {
			t.Errorf("%s: a secret was issued", method)
		}
	}
}

// openid/profile/email are another vocabulary, not a request for privilege here. Dropping
// them and saying what was granted beats refusing the registration outright.
func TestOauthRegister_AcceptsTheOIDCScopesClientsSend(t *testing.T) {
	h := registerRouter(t)

	status, body := postJSON(t, h, "/oauth/register", `{
		"client_name": "Claude",
		"redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
		"scope": "openid profile email"
	}`)

	if status != http.StatusCreated {
		t.Fatalf("status %d, want 201: %v", status, body)
	}
	if body["scope"] != "read write" {
		t.Errorf("scope = %v, want \"read write\"", body["scope"])
	}
}

func TestOauthRegister_KeepsTheScopesItRecognises(t *testing.T) {
	h := registerRouter(t)

	status, body := postJSON(t, h, "/oauth/register", `{
		"client_name": "Reader",
		"redirect_uris": ["https://example.com/cb"],
		"scope": "openid read email"
	}`)

	if status != http.StatusCreated {
		t.Fatalf("status %d, want 201: %v", status, body)
	}
	if body["scope"] != "read" {
		t.Errorf("scope = %v, want \"read\"", body["scope"])
	}
}

// A scope this server knows but will never hand to an anonymous registration is still a
// refusal. The client understands the vocabulary, so it can understand the answer.
func TestOauthRegister_StillRefusesAPrivilegedScope(t *testing.T) {
	h := registerRouter(t)

	status, body := postJSON(t, h, "/oauth/register", `{
		"client_name": "Ambitious",
		"redirect_uris": ["https://example.com/cb"],
		"scope": "read admin"
	}`)

	if status != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %v", status, body)
	}
}

// private_key_jwt cannot degrade to a public client, so it stays a real mismatch rather
// than a preference this server can quietly narrow.
func TestOauthRegister_StillRefusesAnUnsupportedAuthMethod(t *testing.T) {
	h := registerRouter(t)

	for _, method := range []string{"private_key_jwt", "tls_client_auth", "self_signed_tls_client_auth"} {
		status, body := postJSON(t, h, "/oauth/register", `{
			"client_name": "Exotic",
			"redirect_uris": ["https://example.com/cb"],
			"token_endpoint_auth_method": "`+method+`"
		}`)

		if status != http.StatusBadRequest {
			t.Fatalf("%s: status %d, want 400: %v", method, status, body)
		}
		if body["error"] != "invalid_client_metadata" {
			t.Errorf("%s: error = %v, want invalid_client_metadata", method, body["error"])
		}
	}
}

// The exact body that failed in production, kept whole so the regression has a name.
func TestOauthRegister_ClaudeRegistrationSucceedsEndToEnd(t *testing.T) {
	h := registerRouter(t)

	status, body := postJSON(t, h, "/oauth/register", `{
		"client_name": "Claude",
		"client_uri": "https://claude.ai",
		"redirect_uris": ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"],
		"grant_types": ["authorization_code", "refresh_token"],
		"response_types": ["code"],
		"token_endpoint_auth_method": "client_secret_post",
		"scope": "openid profile email"
	}`)

	if status != http.StatusCreated {
		t.Fatalf("status %d, want 201: %v", status, body)
	}
	if body["client_id"] == nil || body["token_endpoint_auth_method"] != "none" {
		t.Errorf("registration body = %v", body)
	}
}
