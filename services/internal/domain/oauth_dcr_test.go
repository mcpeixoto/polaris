package domain_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func pkcePair(verifier string) (string, string) {
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

// The point of the whole feature: a client nobody created in settings gets a token, and at
// no stage does anybody hold a secret.
func TestDynamicClient_RegistersConsentsAndExchangesWithoutASecret(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	reg, err := svc.RegisterDynamicClient(ctx, domain.RegisterDynamicClientInput{
		ClientName:   "Claude Code",
		RedirectURIs: []string{"http://localhost:33418/callback"},
		Scope:        "read write",
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if !strings.HasPrefix(reg.ClientID, "pol_") {
		t.Errorf("client id %q should use the pol_ prefix", reg.ClientID)
	}
	if reg.TokenEndpointAuthMeth != "none" {
		t.Errorf("auth method %q, want none", reg.TokenEndpointAuthMeth)
	}

	verifier, challenge := pkcePair("a-verifier-long-enough-to-be-worth-something")
	authzOut, err := svc.CreateOauthAuthorization(ctx, f.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:            reg.ClientID,
		RedirectURI:         "http://localhost:33418/callback",
		ResponseType:        "code",
		Scope:               "read write",
		CodeChallenge:       challenge,
		CodeChallengeMethod: "S256",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}

	tok, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         queryParam(authzOut.RedirectURI, "code"),
		RedirectURI:  "http://localhost:33418/callback",
		ClientID:     reg.ClientID,
		CodeVerifier: verifier,
	})
	if err != nil {
		t.Fatalf("exchange without a secret: %v", err)
	}

	p, err := svc.AuthenticateOauthToken(ctx, tok.AccessToken)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if p.UserID != f.UserID {
		t.Errorf("actor %s, want the consenting user %s", p.UserID, f.UserID)
	}
	if p.WorkspaceID != f.WorkspaceID {
		t.Errorf("workspace %s, want the consenting user's %s", p.WorkspaceID, f.WorkspaceID)
	}
	if !p.HasScope(domain.OauthScopeWrite) {
		t.Error("token should carry write")
	}
}

// Without a secret, PKCE is the only thing tying the redemption to the client that started
// the flow. A code issued without a challenge must not be redeemable.
func TestDynamicClient_RefusesAnExchangeWithoutPKCE(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	reg, err := svc.RegisterDynamicClient(ctx, domain.RegisterDynamicClientInput{
		ClientName:   "No PKCE",
		RedirectURIs: []string{"http://localhost:1/cb"},
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	authzOut, err := svc.CreateOauthAuthorization(ctx, f.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:     reg.ClientID,
		RedirectURI:  "http://localhost:1/cb",
		ResponseType: "code",
		Scope:        "read",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if _, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:   "authorization_code",
		Code:        queryParam(authzOut.RedirectURI, "code"),
		RedirectURI: "http://localhost:1/cb",
		ClientID:    reg.ClientID,
	}); err == nil {
		t.Fatal("a public client redeemed a code that carried no PKCE challenge")
	}
}

// `plain` puts the verifier on the wire, which is the thing the exchange exists to avoid.
// A confidential client keeps it, backstopped by its secret; a public one may not.
func TestDynamicClient_RefusesPlainPKCE(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	reg, err := svc.RegisterDynamicClient(ctx, domain.RegisterDynamicClientInput{
		ClientName:   "Plain",
		RedirectURIs: []string{"http://localhost:2/cb"},
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	verifier := "a-verifier-used-as-its-own-challenge"
	authzOut, err := svc.CreateOauthAuthorization(ctx, f.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:            reg.ClientID,
		RedirectURI:         "http://localhost:2/cb",
		ResponseType:        "code",
		Scope:               "read",
		CodeChallenge:       verifier,
		CodeChallengeMethod: "plain",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if _, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         queryParam(authzOut.RedirectURI, "code"),
		RedirectURI:  "http://localhost:2/cb",
		ClientID:     reg.ClientID,
		CodeVerifier: verifier,
	}); err == nil {
		t.Fatal("a public client redeemed a code challenged with plain")
	}
}

func TestDynamicClient_ScopesAreClampedToReadAndWrite(t *testing.T) {
	svc := domain.NewService(testutil.NewDB(t))
	ctx := context.Background()

	_, err := svc.RegisterDynamicClient(ctx, domain.RegisterDynamicClientInput{
		ClientName:   "Greedy",
		RedirectURIs: []string{"http://localhost:3/cb"},
		Scope:        "read write admin",
	})
	if err == nil {
		t.Fatal("an anonymous registration was allowed to ask for admin")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Errorf("error code %v, want a validation error", code)
	}
}

func TestDynamicClient_RedirectURIRules(t *testing.T) {
	svc := domain.NewService(testutil.NewDB(t))
	ctx := context.Background()

	cases := []struct {
		name string
		uri  string
		ok   bool
	}{
		{"loopback http", "http://127.0.0.1:9000/cb", true},
		{"https", "https://example.com/cb", true},
		{"reverse-domain native scheme", "com.example.editor:/oauth/cb", true},
		{"remote http", "http://example.com/cb", false},
		{"squattable scheme", "myapp:/cb", false},
		{"fragment", "https://example.com/cb#tok", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.RegisterDynamicClient(ctx, domain.RegisterDynamicClientInput{
				ClientName:   "Redirects",
				RedirectURIs: []string{tc.uri},
			})
			if tc.ok && err != nil {
				t.Fatalf("%s should be accepted: %v", tc.uri, err)
			}
			if !tc.ok && err == nil {
				t.Fatalf("%s should be refused", tc.uri)
			}
		})
	}
}

// A self-registered client belongs to nobody, so it must not turn up in the OAuth
// applications screen of the workspace that happened to consent to it — where it would be
// revocable by people who never installed it and invisible to the ones who did.
func TestDynamicClient_IsNotListedAsAWorkspaceApplication(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	if _, err := svc.RegisterDynamicClient(ctx, domain.RegisterDynamicClientInput{
		ClientName:   "Invisible",
		RedirectURIs: []string{"http://localhost:4/cb"},
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	listed, err := svc.ListOauthClients(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("workspace application list has %d rows, want 0", len(listed))
	}
}

// The sweep bounds an unauthenticated table. It must not log anybody out on the way.
func TestDynamicClient_SweepKeepsClientsHoldingLiveTokens(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	reg, err := svc.RegisterDynamicClient(ctx, domain.RegisterDynamicClientInput{
		ClientName:   "Still here",
		RedirectURIs: []string{"http://localhost:5/cb"},
		Scope:        "read",
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	verifier, challenge := pkcePair("another-perfectly-adequate-code-verifier")
	authzOut, err := svc.CreateOauthAuthorization(ctx, f.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:            reg.ClientID,
		RedirectURI:         "http://localhost:5/cb",
		ResponseType:        "code",
		Scope:               "read",
		CodeChallenge:       challenge,
		CodeChallengeMethod: "S256",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	tok, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         queryParam(authzOut.RedirectURI, "code"),
		RedirectURI:  "http://localhost:5/cb",
		ClientID:     reg.ClientID,
		CodeVerifier: verifier,
	})
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}

	// Old enough to sweep on age alone; the live token is the only thing saving it.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE oauth_application SET created_at = now() - interval '400 days',
		        last_used_at = now() - interval '400 days'
		 WHERE dynamically_registered`); err != nil {
		t.Fatalf("age the row: %v", err)
	}
	if _, err := svc.SweepIdleDynamicClients(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if _, err := svc.AuthenticateOauthToken(ctx, tok.AccessToken); err != nil {
		t.Fatalf("the sweep revoked a live token: %v", err)
	}

	// With the token revoked there is nothing left to protect it.
	if err := svc.RevokeOauthToken(ctx, tok.AccessToken, ""); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	n, err := svc.SweepIdleDynamicClients(ctx)
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("swept %d clients, want 1", n)
	}
}
