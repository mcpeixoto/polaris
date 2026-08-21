package domain_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestListAuthorisedOauthApps_GroupsLiveTokensAndHidesClientCredentials(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	app, secret := mintAuthorisedApp(t, svc, f.Principal(), "Notes")
	authoriseApp(t, svc, f.Principal(), app, secret, "read write")

	on := true
	bot, ccSecret, _, err := svc.CreateOauthClient(ctx, f.Principal(), domain.CreateOauthClientInput{
		Name:                     "Server bot",
		RedirectURIs:             []string{"http://localhost:3000/cb"},
		AllowedScopes:            []string{domain.OauthScopeRead},
		ClientCredentialsEnabled: &on,
	})
	if err != nil {
		t.Fatalf("create client-credentials app: %v", err)
	}
	if _, err := svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType:    "client_credentials",
		ClientID:     bot.ClientID,
		ClientSecret: ccSecret,
		Scope:        "read",
	}); err != nil {
		t.Fatalf("client credentials: %v", err)
	}

	apps, err := svc.ListAuthorisedOauthApps(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(apps) != 1 {
		t.Fatalf("got %d apps, want only the one this person authorised, not the client-credentials bot", len(apps))
	}
	if apps[0].ID != app.ID {
		t.Errorf("id = %s, want %s", apps[0].ID, app.ID)
	}
	if apps[0].Name != "Notes" {
		t.Errorf("name = %q, want Notes", apps[0].Name)
	}
	if got := strings.Join(apps[0].Scopes, " "); got != "read write" {
		t.Errorf("scopes = %q, want read write", got)
	}
}

func TestRevokeAuthorisedOauthApp_KillsTheGrantAndAForeignIdIsNotFound(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	app, secret := mintAuthorisedApp(t, svc, f.Principal(), "Notes")
	authoriseApp(t, svc, f.Principal(), app, secret, "read")

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)
	_, _, err := svc.RevokeAuthorisedOauthApp(ctx, pBob, app.ID)
	if code := platform.CodeOf(err); code != platform.CodeNotFound {
		t.Fatalf("bob revoking ada's grant: code = %s, want %s", code, platform.CodeNotFound)
	}

	revoked, _, err := svc.RevokeAuthorisedOauthApp(ctx, f.Principal(), app.ID)
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if revoked != app.ID {
		t.Errorf("revoked = %s, want %s", revoked, app.ID)
	}

	apps, err := svc.ListAuthorisedOauthApps(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list after revoke: %v", err)
	}
	if len(apps) != 0 {
		t.Fatalf("got %d apps after revoke, want none", len(apps))
	}

	_, _, err = svc.RevokeAuthorisedOauthApp(ctx, f.Principal(), app.ID)
	if code := platform.CodeOf(err); code != platform.CodeNotFound {
		t.Fatalf("second revoke: code = %s, want %s", code, platform.CodeNotFound)
	}

	_, _, err = svc.RevokeAuthorisedOauthApp(ctx, f.Principal(), uuid.Must(uuid.NewV7()))
	if code := platform.CodeOf(err); code != platform.CodeNotFound {
		t.Fatalf("unknown id: code = %s, want %s", code, platform.CodeNotFound)
	}
}

func mintAuthorisedApp(t *testing.T, svc *domain.Service, p *authz.Principal, name string) (model.OauthClient, string) {
	t.Helper()
	client, secret, _, err := svc.CreateOauthClient(context.Background(), p, domain.CreateOauthClientInput{
		Name:          name,
		RedirectURIs:  []string{"http://localhost:3000/cb"},
		AllowedScopes: []string{domain.OauthScopeRead, domain.OauthScopeWrite},
	})
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	return client, secret
}

func authoriseApp(t *testing.T, svc *domain.Service, p *authz.Principal, app model.OauthClient, secret, scope string) {
	t.Helper()
	verifier := "this-is-a-pkce-code-verifier-of-sufficient-length"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	authzOut, err := svc.CreateOauthAuthorization(context.Background(), p, domain.CreateOauthAuthorizationInput{
		ClientID:            app.ClientID,
		RedirectURI:         "http://localhost:3000/cb",
		ResponseType:        "code",
		Scope:               scope,
		State:               "csrf",
		CodeChallenge:       challenge,
		CodeChallengeMethod: "S256",
	})
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	code := queryParam(authzOut.RedirectURI, "code")
	if _, err := svc.ExchangeOauthToken(context.Background(), domain.OauthTokenRequest{
		GrantType:    "authorization_code",
		Code:         code,
		RedirectURI:  "http://localhost:3000/cb",
		ClientID:     app.ClientID,
		ClientSecret: secret,
		CodeVerifier: verifier,
	}); err != nil {
		t.Fatalf("exchange: %v", err)
	}
}
