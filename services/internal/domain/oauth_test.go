package domain_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestOauthClient_SecretExistsInTheCreateResponseAndNowhereElse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	client, secret, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name:          "CI bot",
		RedirectURIs:  []string{"https://example.com/callback"},
		AllowedScopes: []string{domain.OauthScopeRead, domain.OauthScopeWrite},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.HasPrefix(secret, "pls_") {
		t.Errorf("secret %q should use the pls_ prefix", secret)
	}
	if !strings.HasPrefix(client.ClientID, "pol_") {
		t.Errorf("client id %q should use the pol_ prefix", client.ClientID)
	}

	listed, err := svc.ListOauthClients(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("list len %d, want 1", len(listed))
	}
	raw, err := db.Pool().Query(ctx, `SELECT client_secret_hash FROM oauth_application WHERE id = $1`, client.ID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer raw.Close()
	if !raw.Next() {
		t.Fatal("missing application row")
	}
	var hash []byte
	if err := raw.Scan(&hash); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if string(hash) == secret || strings.Contains(string(hash), secret) {
		t.Error("the plaintext secret must not be stored")
	}
}

func TestOauthClient_AMemberCannotCreateOne(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	member := f.Principal()
	member.Role = authz.RoleMember

	_, _, _, err := svc.CreateOauthClient(context.Background(), member, domain.CreateOauthClientInput{
		Name:         "nope",
		RedirectURIs: []string{"https://example.com/callback"},
	})
	if err == nil {
		t.Fatal("a member created an OAuth application")
	}
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Errorf("code %s, want forbidden", platform.CodeOf(err))
	}
}

func TestOauthFlow_AuthorizationCodeWithPKCE(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	client, secret, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name:          "PKCE app",
		RedirectURIs:  []string{"http://localhost:3000/cb"},
		AllowedScopes: []string{domain.OauthScopeWrite},
	})
	if err != nil {
		t.Fatalf("create app: %v", err)
	}

	verifier := "this-is-a-pkce-code-verifier-of-sufficient-length"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	authzOut, err := svc.CreateOauthAuthorization(ctx, f.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:            client.ClientID,
		RedirectURI:         "http://localhost:3000/cb",
		ResponseType:        "code",
		Scope:               "read write",
		State:               "csrf-1",
		CodeChallenge:       challenge,
		CodeChallengeMethod: "S256",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if !strings.Contains(authzOut.RedirectURI, "code=") || !strings.Contains(authzOut.RedirectURI, "state=csrf-1") {
		t.Fatalf("redirect %q missing code or state", authzOut.RedirectURI)
	}

	code := queryParam(authzOut.RedirectURI, "code")
	if !strings.HasPrefix(code, "plc_") {
		t.Errorf("code %q should use the plc_ prefix", code)
	}

	tok, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         code,
		RedirectURI:  "http://localhost:3000/cb",
		ClientID:     client.ClientID,
		ClientSecret: secret,
		CodeVerifier: verifier,
	})
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if !strings.HasPrefix(tok.AccessToken, "pla_") {
		t.Errorf("access token %q should use the pla_ prefix", tok.AccessToken)
	}
	if !strings.HasPrefix(tok.RefreshToken, "plr_") {
		t.Errorf("refresh token %q should use the plr_ prefix", tok.RefreshToken)
	}
	if !strings.Contains(tok.Scope, "read") || !strings.Contains(tok.Scope, "write") {
		t.Errorf("scope %q should include read and write", tok.Scope)
	}

	p, err := svc.AuthenticateOauthToken(ctx, tok.AccessToken)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if p.UserID != f.UserID {
		t.Errorf("actor %s, want the authorizing user %s", p.UserID, f.UserID)
	}
	if p.ApplicationID != client.ID {
		t.Errorf("application %s, want %s", p.ApplicationID, client.ID)
	}
	if !p.HasScope("write") {
		t.Error("token should carry write")
	}

	if _, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         code,
		RedirectURI:  "http://localhost:3000/cb",
		ClientID:     client.ClientID,
		ClientSecret: secret,
		CodeVerifier: verifier,
	}); err == nil {
		t.Fatal("a consumed authorization code was accepted a second time")
	}
}

func TestOauthFlow_RefreshGraceReturnsTheSamePair(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	client, secret, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name:         "refresh app",
		RedirectURIs: []string{"https://example.com/cb"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	access, refresh := mintUserToken(t, svc, f, client.ClientID, secret)

	first, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "refresh_token",
		RefreshToken: refresh,
		ClientID:     client.ClientID,
		ClientSecret: secret,
	})
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if first.AccessToken == access {
		t.Error("refresh must rotate the access token")
	}

	second, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "refresh_token",
		RefreshToken: refresh,
		ClientID:     client.ClientID,
		ClientSecret: secret,
	})
	if err != nil {
		t.Fatalf("grace replay: %v", err)
	}
	if second.AccessToken != first.AccessToken || second.RefreshToken != first.RefreshToken {
		t.Error("a refresh replayed inside the grace window must return the same successor pair")
	}
}

func TestOauthFlow_RevokeStopsAuthentication(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	client, secret, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name:         "revoke app",
		RedirectURIs: []string{"https://example.com/cb"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	access, _ := mintUserToken(t, svc, f, client.ClientID, secret)

	if err := svc.RevokeOauthToken(ctx, access, "access_token"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := svc.AuthenticateOauthToken(ctx, access); err == nil {
		t.Fatal("a revoked access token still authenticated")
	}
}

func TestOauthFlow_AppActorCannotRequestAdmin(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	client, _, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name:          "agent",
		RedirectURIs:  []string{"https://example.com/cb"},
		AllowedScopes: []string{domain.OauthScopeAdmin, domain.OauthScopeWrite},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.CreateOauthAuthorization(ctx, f.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:     client.ClientID,
		RedirectURI:  "https://example.com/cb",
		ResponseType: "code",
		Scope:        "admin",
		Actor:        "app",
	})
	if err == nil {
		t.Fatal("actor=app was allowed to request admin")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Errorf("code %s, want validation", platform.CodeOf(err))
	}
}

func TestOauthFlow_ClientCredentialsNeedsToBeEnabled(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	client, secret, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name:         "off",
		RedirectURIs: []string{"https://example.com/cb"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID,
		ClientSecret: secret,
		Scope:        "read",
	})
	if err == nil {
		t.Fatal("client credentials succeeded on an app that did not enable them")
	}

	on := true
	_, _, err = svc.UpdateOauthClient(ctx, f.Principal(), domain.UpdateOauthClientInput{
		ID:                       client.ID,
		ClientCredentialsEnabled: &on,
	})
	if err != nil {
		t.Fatalf("enable: %v", err)
	}

	tok, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID,
		ClientSecret: secret,
		Scope:        "read",
	})
	if err != nil {
		t.Fatalf("client credentials: %v", err)
	}
	if tok.RefreshToken != "" {
		t.Error("client-credentials tokens must not include a refresh token")
	}
	p, err := svc.AuthenticateOauthToken(ctx, tok.AccessToken)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if p.ActorType != authz.ActorAppUser {
		t.Errorf("actor type %s, want app_user", p.ActorType)
	}
	if p.AccountID.String() != "00000000-0000-0000-0000-000000000000" {
		t.Error("an app user must not have an account")
	}
}

func mintUserToken(t *testing.T, svc *domain.Service, f *testutil.Fixture, clientID, secret string) (access, refresh string) {
	t.Helper()
	ctx := context.Background()
	out, err := svc.CreateOauthAuthorization(ctx, f.Principal(), domain.CreateOauthAuthorizationInput{
		ClientID:     clientID,
		RedirectURI:  "https://example.com/cb",
		ResponseType: "code",
		Scope:        "read",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	tok, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         queryParam(out.RedirectURI, "code"),
		RedirectURI:  "https://example.com/cb",
		ClientID:     clientID,
		ClientSecret: secret,
	})
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	return tok.AccessToken, tok.RefreshToken
}

func queryParam(rawURL, key string) string {
	_, after, ok := strings.Cut(rawURL, "?")
	if !ok {
		return ""
	}
	for _, part := range strings.Split(after, "&") {
		k, v, found := strings.Cut(part, "=")
		if found && k == key {
			unescaped := v
			unescaped = strings.ReplaceAll(unescaped, "%3D", "=")
			return unescaped
		}
	}
	return ""
}

func TestOauthClient_HttpRedirectsAreLocalhostOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	_, _, _, err := svc.CreateOauthClient(context.Background(), f.Principal(), domain.CreateOauthClientInput{
		Name:         "bad",
		RedirectURIs: []string{"http://evil.example/cb"},
	})
	if err == nil {
		t.Fatal("an http redirect on a public host was accepted")
	}
}
