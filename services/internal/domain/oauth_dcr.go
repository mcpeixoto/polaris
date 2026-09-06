package domain

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Dynamic client registration, RFC 7591.
//
// This is the endpoint that turns "connect Polaris" into one click. An MCP client that
// has never seen this server posts the redirect URI it will listen on, gets a client_id
// back, and sends the person to the consent screen. The alternative — the API-key hop the
// settings page documents today — works, but it asks somebody to generate a credential
// and paste it into a config file before they have seen what the product does.
//
// The endpoint is unauthenticated, because it has to be: the client is registering
// before anyone has signed in. What keeps that safe is that registration grants nothing.
// A registered client is a name and a redirect URI until a signed-in person consents to
// it, and the consent screen is where the actual decision happens. The rate limiter in
// front of it and the idle sweep behind it are what stop the table filling with rows
// nobody consented to.

const (
	// Registration is anonymous, so these are deliberately tighter than the equivalents
	// for an application a person filled in a form to create.
	maxDynamicRedirectURIs = 5
	maxDynamicNameLength   = 100

	// A self-registered client nobody has used in this long is swept. Long enough that an
	// editor install used once a quarter survives; short enough that a scan does not.
	dynamicClientIdleTTL = 90 * 24 * time.Hour
)

type RegisterDynamicClientInput struct {
	ClientName   string
	RedirectURIs []string
	Scope        string
}

type DynamicClientRegistration struct {
	ClientID              string
	ClientIDIssuedAt      time.Time
	ClientName            string
	RedirectURIs          []string
	Scopes                []string
	TokenEndpointAuthMeth string
}

// RegisterDynamicClient creates a public client: no secret is issued, and none is accepted
// at the token endpoint. Proof that the caller is the client it claims to be comes from
// PKCE instead, which is checked in exchangeAuthorizationCode and required there for every
// client registered this way.
func (s *Service) RegisterDynamicClient(
	ctx context.Context, in RegisterDynamicClientInput,
) (DynamicClientRegistration, error) {
	name := strings.TrimSpace(in.ClientName)
	if name == "" {
		// RFC 7591 makes client_name optional. A client that omits it still has to appear
		// on a consent screen, and "unnamed application" is a more honest label than a
		// blank one.
		name = "Unnamed MCP client"
	}
	if len(name) > maxDynamicNameLength {
		name = name[:maxDynamicNameLength]
	}

	redirects, err := normaliseDynamicRedirectURIs(in.RedirectURIs)
	if err != nil {
		return DynamicClientRegistration{}, err
	}

	// Clamped to the two scopes the MCP surface uses, in two tiers.
	//
	// A scope this server knows but will not hand to an anonymous registration — admin,
	// issues:create, customer:write and the rest of oauthScopes — is still a validation
	// error rather than a silent downgrade, so the client learns it will never get it.
	//
	// A scope from another vocabulary entirely is dropped instead. Clients send `openid
	// profile email` at registration because that is what their OAuth library emits, not
	// because they are asking this server for anything; refusing the whole registration
	// over it is fatal to a connector, and RFC 7591 §3.2.1 exists precisely so the server
	// can answer with the scope it actually granted. That is echoed back in the response.
	requested := parseScopeList(in.Scope)
	granted := make([]string, 0, len(requested))
	for _, sc := range requested {
		switch {
		case sc == OauthScopeRead || sc == OauthScopeWrite:
			granted = append(granted, sc)
		case oauthScopes[sc]:
			return DynamicClientRegistration{}, platform.Validation(
				"scope", "a self-registered client may only request read or write",
			)
		}
	}
	if len(granted) == 0 {
		// Either nothing was asked for, or everything asked for belonged to somebody
		// else's vocabulary. Both get the default the MCP surface uses.
		granted = []string{OauthScopeRead, OauthScopeWrite}
	}
	scopes, err := normaliseOauthScopes(granted, false)
	if err != nil {
		return DynamicClientRegistration{}, err
	}

	clientID, err := newPrefixedOpaque(oauthClientIDPrefix)
	if err != nil {
		return DynamicClientRegistration{}, err
	}
	// The secret column is NOT NULL and this client has no secret. Writing a random value
	// that is discarded here keeps the schema honest for every other client while making
	// this one impossible to authenticate with a secret: nobody, including us, holds it.
	_, secretPrefix, secretHash, err := newPrefixedSecret(oauthClientSecretPrefix)
	if err != nil {
		return DynamicClientRegistration{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return DynamicClientRegistration{}, platform.Internal(err)
	}

	var issuedAt time.Time
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.CreateOauthApplication(ctx, store.CreateOauthApplicationParams{
			ID:                 id,
			WorkspaceID:        nil,
			CreatorID:          nil,
			Name:               name,
			ClientID:           clientID,
			ClientSecretHash:   secretHash,
			ClientSecretPrefix: secretPrefix,
			RedirectUris:       redirects,
			AllowedScopes:      scopes,
			// Any workspace may consent to it: which workspace a self-registered client
			// ends up acting in is decided by whoever signs in, not at registration.
			PublicEnabled:            true,
			ClientCredentialsEnabled: false,
			DynamicallyRegistered:    true,
		})
		if err != nil {
			return platform.Internal(err)
		}
		issuedAt = row.CreatedAt
		return nil
	})
	if err != nil {
		return DynamicClientRegistration{}, err
	}

	return DynamicClientRegistration{
		ClientID:              clientID,
		ClientIDIssuedAt:      issuedAt,
		ClientName:            name,
		RedirectURIs:          redirects,
		Scopes:                scopes,
		TokenEndpointAuthMeth: "none",
	}, nil
}

// SweepIdleDynamicClients removes self-registered clients that nobody came back for. A
// client holding a live token is never swept, however long it has been quiet — the sweep
// exists to bound an unauthenticated table, not to log people out.
func (s *Service) SweepIdleDynamicClients(ctx context.Context) (int64, error) {
	cutoff := time.Now().Add(-dynamicClientIdleTTL)
	n, err := s.db.Queries().DeleteIdleDynamicOauthApplications(ctx, &cutoff)
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

// normaliseDynamicRedirectURIs applies the same rules as a hand-registered application —
// absolute, no fragment, http only on loopback — and additionally accepts the private-use
// scheme native apps register (RFC 8252 §7.1), which is how editors outside the browser
// receive a callback.
func normaliseDynamicRedirectURIs(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, platform.Validation("redirect_uris", "at least one redirect URI is required")
	}
	if len(raw) > maxDynamicRedirectURIs {
		return nil, platform.Validation("redirect_uris", "too many redirect URIs")
	}

	var web []string
	var native []string
	for _, r := range raw {
		u := strings.TrimSpace(r)
		if u == "" {
			continue
		}
		scheme, rest, found := strings.Cut(u, ":")
		scheme = strings.ToLower(scheme)
		if !found || rest == "" {
			return nil, platform.Validation("redirect_uris", "redirect URIs must be absolute")
		}
		if scheme == "http" || scheme == "https" {
			web = append(web, u)
			continue
		}
		// A private-use scheme has to be one the client demonstrably owns, which in
		// practice means a reversed domain name. Anything without a dot is a scheme
		// somebody could squat, so it is refused.
		if !strings.Contains(scheme, ".") {
			return nil, platform.Validation("redirect_uris", "redirect URIs must be http(s) or a reverse-domain scheme")
		}
		if strings.Contains(u, "#") {
			return nil, platform.Validation("redirect_uris", "redirect URIs must not contain a fragment")
		}
		native = append(native, u)
	}

	out := make([]string, 0, len(web)+len(native))
	if len(web) > 0 {
		checked, err := normaliseRedirectURIs(web)
		if err != nil {
			return nil, err
		}
		out = append(out, checked...)
	}
	out = append(out, native...)
	if len(out) == 0 {
		return nil, platform.Validation("redirect_uris", "at least one redirect URI is required")
	}
	return out, nil
}
