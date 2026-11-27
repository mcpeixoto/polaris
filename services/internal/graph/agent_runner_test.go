package graph

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func TestUser_AgentLastSeenAtIsNullForAPersonAndSetAfterAPoll(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	human, err := h.Query().User(h.ctx, h.f.UserID)
	if err != nil {
		t.Fatalf("human: %v", err)
	}
	seen, err := h.User().AgentLastSeenAt(h.ctx, human)
	if err != nil {
		t.Fatalf("human last seen: %v", err)
	}
	if seen != nil {
		t.Fatalf("a person has no runner, got %s", seen)
	}

	client, secret, _, err := h.svc.CreateOauthClient(ctx, h.f.Principal(), domain.CreateOauthClientInput{
		Name: "Runner", RedirectURIs: []string{"https://example.com/cb"},
	})
	if err != nil {
		t.Fatalf("oauth client: %v", err)
	}
	on := true
	if _, _, err := h.svc.UpdateOauthClient(ctx, h.f.Principal(), domain.UpdateOauthClientInput{
		ID: client.ID, ClientCredentialsEnabled: &on,
	}); err != nil {
		t.Fatalf("enable client credentials: %v", err)
	}
	tok, err := h.svc.ExchangeOauthToken(ctx, domain.OauthTokenRequest{
		GrantType: "client_credentials", ClientID: client.ClientID, ClientSecret: secret, Scope: "read",
	})
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	app, err := h.svc.AuthenticateOauthToken(ctx, tok.AccessToken)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}

	agent, err := h.Query().User(h.ctx, app.UserID)
	if err != nil {
		t.Fatalf("agent user: %v", err)
	}
	before, err := h.User().AgentLastSeenAt(h.ctx, agent)
	if err != nil {
		t.Fatalf("agent before poll: %v", err)
	}
	if before != nil {
		t.Fatal("an agent that has never polled must have no last seen")
	}

	if _, err := h.svc.StartRunnerClaim(ctx, app, "0.0.1"); err != nil {
		t.Fatalf("claim: %v", err)
	}
	after, err := h.User().AgentLastSeenAt(h.ctx, agent)
	if err != nil {
		t.Fatalf("agent after poll: %v", err)
	}
	if after == nil || time.Since(*after) > time.Minute {
		t.Fatalf("agentLastSeenAt = %v, want the poll", after)
	}

	// A user id that does not exist is not a liveness fact; it is a missing user.
	if _, err := h.User().AgentLastSeenAt(h.ctx, &generated.User{ID: uuid.Must(uuid.NewV7())}); err == nil {
		t.Fatal("an unknown user must not resolve a last seen")
	}
}
