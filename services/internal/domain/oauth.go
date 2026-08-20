package domain

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// OAuth 2.0 applications this workspace owns, and the tokens third parties use.
//
// Applications are not replicated: they are credentials plus an admin settings row.
// Tokens are stored as SHA-256 digests. The plaintext exists in the create/rotate/token
// response and nowhere else, except the 30-minute refresh grace pair on a rotated row.

const (
	oauthClientIDPrefix     = "pol_"
	oauthClientSecretPrefix = "pls_"
	oauthAccessTokenPrefix  = "pla_"
	oauthRefreshTokenPrefix = "plr_"
	oauthAuthCodePrefix     = "plc_"

	oauthEntropyBytes = 32
	oauthPrefixLength = 12

	maxOauthNameLength        = 128
	maxOauthRedirectURIs      = 20
	maxOauthDescriptionLength = 2000

	oauthAuthCodeTTL           = 10 * time.Minute
	oauthAccessTTL             = 24 * time.Hour
	oauthRefreshTTL            = 90 * 24 * time.Hour
	oauthClientCredentialsTTL  = 30 * 24 * time.Hour
	oauthRefreshGrace          = 30 * time.Minute
	maxClientCredentialsTokens = 1000
)

// OAuth scopes. Coarse, matching docs/03-platform/03-oauth-and-scopes.md. `read` is always
// present after normalisation. `write` implies read. `admin` is the wildcard and is refused
// for actor=app.
const (
	OauthScopeRead              = "read"
	OauthScopeWrite             = "write"
	OauthScopeIssuesCreate      = "issues:create"
	OauthScopeCommentsCreate    = "comments:create"
	OauthScopeTimeScheduleWrite = "timeSchedule:write"
	OauthScopeAdmin             = "admin"
	OauthScopeAppAssignable     = "app:assignable"
	OauthScopeAppMentionable    = "app:mentionable"
	OauthScopeCustomerRead      = "customer:read"
	OauthScopeCustomerWrite     = "customer:write"
	OauthScopeInitiativeRead    = "initiative:read"
	OauthScopeInitiativeWrite   = "initiative:write"
)

var oauthScopes = map[string]bool{
	OauthScopeRead:              true,
	OauthScopeWrite:             true,
	OauthScopeIssuesCreate:      true,
	OauthScopeCommentsCreate:    true,
	OauthScopeTimeScheduleWrite: true,
	OauthScopeAdmin:             true,
	OauthScopeAppAssignable:     true,
	OauthScopeAppMentionable:    true,
	OauthScopeCustomerRead:      true,
	OauthScopeCustomerWrite:     true,
	OauthScopeInitiativeRead:    true,
	OauthScopeInitiativeWrite:   true,
}

type CreateOauthClientInput struct {
	Name                     string
	Description              *string
	Developer                *string
	DeveloperURL             *string
	ImageURL                 *string
	RedirectURIs             []string
	AllowedScopes            []string
	PublicEnabled            *bool
	ClientCredentialsEnabled *bool
	WebhookURL               *string
}

type UpdateOauthClientInput struct {
	ID                       uuid.UUID
	Name                     *string
	Description              *string
	Developer                *string
	DeveloperURL             *string
	ImageURL                 *string
	RedirectURIs             []string
	AllowedScopes            []string
	PublicEnabled            *bool
	ClientCredentialsEnabled *bool
	WebhookURL               *string
}

func (s *Service) CreateOauthClient(
	ctx context.Context, p *authz.Principal, in CreateOauthClientInput,
) (model.OauthClient, string, int64, error) {
	if !authz.Can(p, authz.ActionOauthClientManage) {
		return model.OauthClient{}, "", 0, platform.Forbidden("only admins can create OAuth applications")
	}

	name, redirects, scopes, err := validateOauthClientFields(in.Name, in.RedirectURIs, in.AllowedScopes)
	if err != nil {
		return model.OauthClient{}, "", 0, err
	}
	if err := validateOptionalOauthText(in.Description, "description", maxOauthDescriptionLength); err != nil {
		return model.OauthClient{}, "", 0, err
	}

	clientID, err := newPrefixedOpaque(oauthClientIDPrefix)
	if err != nil {
		return model.OauthClient{}, "", 0, err
	}
	secret, secretPrefix, secretHash, err := newPrefixedSecret(oauthClientSecretPrefix)
	if err != nil {
		return model.OauthClient{}, "", 0, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return model.OauthClient{}, "", 0, platform.Internal(err)
	}

	publicEnabled := false
	if in.PublicEnabled != nil {
		publicEnabled = *in.PublicEnabled
	}
	ccEnabled := false
	if in.ClientCredentialsEnabled != nil {
		ccEnabled = *in.ClientCredentialsEnabled
	}

	var out model.OauthClient
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.CreateOauthApplication(ctx, store.CreateOauthApplicationParams{
			ID:                       id,
			WorkspaceID:              p.WorkspaceID,
			CreatorID:                p.UserID,
			Name:                     name,
			Description:              trimOauthString(in.Description),
			Developer:                trimOauthString(in.Developer),
			DeveloperUrl:             trimOauthString(in.DeveloperURL),
			ImageUrl:                 trimOauthString(in.ImageURL),
			ClientID:                 clientID,
			ClientSecretHash:         secretHash,
			ClientSecretPrefix:       secretPrefix,
			RedirectUris:             redirects,
			AllowedScopes:            scopes,
			PublicEnabled:            publicEnabled,
			ClientCredentialsEnabled: ccEnabled,
			WebhookUrl:               trimOauthString(in.WebhookURL),
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toOauthClient(row)
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return model.OauthClient{}, "", 0, err
	}
	return out, secret, version, nil
}

func (s *Service) UpdateOauthClient(
	ctx context.Context, p *authz.Principal, in UpdateOauthClientInput,
) (model.OauthClient, int64, error) {
	if !authz.Can(p, authz.ActionOauthClientManage) {
		return model.OauthClient{}, 0, platform.Forbidden("only admins can update OAuth applications")
	}

	var out model.OauthClient
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		cur, err := q.GetOauthApplication(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("oauth application")
			}
			return platform.Internal(err)
		}
		if cur.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("oauth application")
		}

		name := cur.Name
		if in.Name != nil {
			name = strings.TrimSpace(*in.Name)
		}
		redirects := cur.RedirectUris
		if in.RedirectURIs != nil {
			redirects = in.RedirectURIs
		}
		scopes := cur.AllowedScopes
		if in.AllowedScopes != nil {
			scopes = in.AllowedScopes
		}
		name, redirects, scopes, err = validateOauthClientFields(name, redirects, scopes)
		if err != nil {
			return err
		}

		desc := cur.Description
		if in.Description != nil {
			desc = trimOauthString(in.Description)
		}
		dev := cur.Developer
		if in.Developer != nil {
			dev = trimOauthString(in.Developer)
		}
		devURL := cur.DeveloperUrl
		if in.DeveloperURL != nil {
			devURL = trimOauthString(in.DeveloperURL)
		}
		image := cur.ImageUrl
		if in.ImageURL != nil {
			image = trimOauthString(in.ImageURL)
		}
		hook := cur.WebhookUrl
		if in.WebhookURL != nil {
			hook = trimOauthString(in.WebhookURL)
		}
		publicEnabled := cur.PublicEnabled
		if in.PublicEnabled != nil {
			publicEnabled = *in.PublicEnabled
		}
		ccEnabled := cur.ClientCredentialsEnabled
		if in.ClientCredentialsEnabled != nil {
			ccEnabled = *in.ClientCredentialsEnabled
		}

		row, err := q.UpdateOauthApplication(ctx, store.UpdateOauthApplicationParams{
			Name:                     name,
			Description:              desc,
			Developer:                dev,
			DeveloperUrl:             devURL,
			ImageUrl:                 image,
			RedirectUris:             redirects,
			AllowedScopes:            scopes,
			PublicEnabled:            publicEnabled,
			ClientCredentialsEnabled: ccEnabled,
			WebhookUrl:               hook,
			ID:                       in.ID,
			WorkspaceID:              p.WorkspaceID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("oauth application")
			}
			return platform.Internal(err)
		}
		out = toOauthClientFromUpdate(row)
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return model.OauthClient{}, 0, err
	}
	return out, version, nil
}

func (s *Service) RotateOauthClientSecret(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.OauthClient, string, int64, error) {
	if !authz.Can(p, authz.ActionOauthClientManage) {
		return model.OauthClient{}, "", 0, platform.Forbidden("only admins can rotate an OAuth secret")
	}

	secret, secretPrefix, secretHash, err := newPrefixedSecret(oauthClientSecretPrefix)
	if err != nil {
		return model.OauthClient{}, "", 0, err
	}

	var out model.OauthClient
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.RotateOauthApplicationSecret(ctx, store.RotateOauthApplicationSecretParams{
			ClientSecretHash:   secretHash,
			ClientSecretPrefix: secretPrefix,
			ID:                 id,
			WorkspaceID:        p.WorkspaceID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("oauth application")
			}
			return platform.Internal(err)
		}
		// Rotating the secret invalidates every client-credentials token for this app.
		if _, err := q.RevokeClientCredentialsTokensForApplication(ctx, id); err != nil {
			return platform.Internal(err)
		}
		out = toOauthClientFromRotate(row)
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return model.OauthClient{}, "", 0, err
	}
	return out, secret, version, nil
}

func (s *Service) DeleteOauthClient(ctx context.Context, p *authz.Principal, id uuid.UUID) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionOauthClientManage) {
		return uuid.Nil, 0, platform.Forbidden("only admins can delete OAuth applications")
	}

	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := q.ArchiveOauthApplication(ctx, store.ArchiveOauthApplicationParams{
			ID: id, WorkspaceID: p.WorkspaceID,
		}); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("oauth application")
			}
			return platform.Internal(err)
		}
		if _, err := q.RevokeOauthTokensForApplication(ctx, id); err != nil {
			return platform.Internal(err)
		}
		var err error
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return id, version, nil
}

func (s *Service) ListOauthClients(ctx context.Context, p *authz.Principal) ([]model.OauthClient, error) {
	if !authz.Can(p, authz.ActionOauthClientManage) {
		return nil, platform.Forbidden("only admins can list OAuth applications")
	}
	rows, err := s.db.Queries().ListOauthApplicationsForWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.OauthClient, 0, len(rows))
	for _, r := range rows {
		out = append(out, toOauthClientListed(r))
	}
	return out, nil
}

func (s *Service) GetOauthClient(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.OauthClient, error) {
	if !authz.Can(p, authz.ActionOauthClientManage) {
		return model.OauthClient{}, platform.Forbidden("only admins can read OAuth applications")
	}
	row, err := s.db.Queries().GetOauthApplication(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.OauthClient{}, platform.NotFound("oauth application")
		}
		return model.OauthClient{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return model.OauthClient{}, platform.NotFound("oauth application")
	}
	return toOauthClientFromGet(row), nil
}

// GetOauthClientInfo is the consent-screen lookup: any signed-in member may see the
// application's public name and scopes, never its secret.
func (s *Service) GetOauthClientInfo(ctx context.Context, p *authz.Principal, clientID string) (model.OauthClientInfo, error) {
	if p == nil {
		return model.OauthClientInfo{}, platform.Unauthorized("")
	}
	row, err := s.db.Queries().GetOauthApplicationByClientID(ctx, strings.TrimSpace(clientID))
	if err != nil {
		if store.IsNotFound(err) {
			return model.OauthClientInfo{}, platform.NotFound("oauth application")
		}
		return model.OauthClientInfo{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID && !row.PublicEnabled {
		return model.OauthClientInfo{}, platform.NotFound("oauth application")
	}
	return model.OauthClientInfo{
		ClientID:      row.ClientID,
		Name:          row.Name,
		Description:   row.Description,
		Developer:     row.Developer,
		DeveloperURL:  row.DeveloperUrl,
		ImageURL:      row.ImageUrl,
		AllowedScopes: row.AllowedScopes,
	}, nil
}

func validateOauthClientFields(name string, redirects, scopes []string) (string, []string, []string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil, nil, platform.Validation("name", "an application needs a name")
	}
	if len(name) > maxOauthNameLength {
		return "", nil, nil, platform.Validation("name", "name is too long")
	}
	uris, err := normaliseRedirectURIs(redirects)
	if err != nil {
		return "", nil, nil, err
	}
	sc, err := normaliseOauthScopes(scopes, false)
	if err != nil {
		return "", nil, nil, err
	}
	return name, uris, sc, nil
}

func normaliseRedirectURIs(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, platform.Validation("redirectUris", "at least one redirect URI is required")
	}
	if len(raw) > maxOauthRedirectURIs {
		return nil, platform.Validation("redirectUris", "too many redirect URIs")
	}
	out := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, r := range raw {
		u := strings.TrimSpace(r)
		if u == "" {
			continue
		}
		parsed, err := url.Parse(u)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return nil, platform.Validation("redirectUris", "redirect URIs must be absolute http(s) URLs")
		}
		if parsed.Fragment != "" {
			return nil, platform.Validation("redirectUris", "redirect URIs must not contain a fragment")
		}
		host := strings.ToLower(parsed.Hostname())
		switch parsed.Scheme {
		case "https":
		case "http":
			if host != "localhost" && host != "127.0.0.1" && host != "::1" {
				return nil, platform.Validation("redirectUris", "http redirect URIs are only allowed for localhost")
			}
		default:
			return nil, platform.Validation("redirectUris", "redirect URIs must be http or https")
		}
		if seen[u] {
			continue
		}
		seen[u] = true
		out = append(out, u)
	}
	if len(out) == 0 {
		return nil, platform.Validation("redirectUris", "at least one redirect URI is required")
	}
	return out, nil
}

func redirectURIAllowed(allowed []string, got string) bool {
	for _, a := range allowed {
		if a == got {
			return true
		}
	}
	return false
}

func normaliseOauthScopes(requested []string, refuseAdmin bool) ([]string, error) {
	out := make([]string, 0, len(requested)+1)
	seen := map[string]bool{}
	add := func(scope string) {
		if !seen[scope] {
			seen[scope] = true
			out = append(out, scope)
		}
	}
	for _, raw := range requested {
		scope := strings.TrimSpace(raw)
		if scope == "" {
			continue
		}
		if !oauthScopes[scope] {
			return nil, platform.Validation("scope", "unknown scope: "+scope)
		}
		if refuseAdmin && scope == OauthScopeAdmin {
			return nil, platform.Validation("scope", "actor=app cannot request admin")
		}
		add(scope)
		if scope == OauthScopeWrite || scope == OauthScopeCustomerWrite || scope == OauthScopeInitiativeWrite {
			add(OauthScopeRead)
		}
	}
	add(OauthScopeRead)
	return out, nil
}

func parseScopeList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	raw = strings.ReplaceAll(raw, ",", " ")
	parts := strings.Fields(raw)
	return parts
}

func newPrefixedOpaque(prefix string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", platform.Internal(err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func newPrefixedSecret(prefix string) (plain, shownPrefix string, hash []byte, err error) {
	buf := make([]byte, oauthEntropyBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", nil, platform.Internal(err)
	}
	plain = prefix + base64.RawURLEncoding.EncodeToString(buf)
	shown := plain
	if len(shown) > oauthPrefixLength {
		shown = shown[:oauthPrefixLength]
	}
	return plain, shown, auth.HashToken(plain), nil
}

func pkceChallenge(verifier, method string) string {
	switch strings.ToLower(strings.TrimSpace(method)) {
	case "", "plain":
		return verifier
	case "s256":
		sum := sha256.Sum256([]byte(verifier))
		return base64.RawURLEncoding.EncodeToString(sum[:])
	default:
		return ""
	}
}

func trimOauthString(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	return &v
}

func validateOptionalOauthText(s *string, field string, max int) error {
	if s == nil {
		return nil
	}
	if len(strings.TrimSpace(*s)) > max {
		return platform.Validation(field, field+" is too long")
	}
	return nil
}

func slugDisplayName(name string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			lastDash = false
		case r == ' ' || r == '-' || r == '_':
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "app"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func toOauthClient(r store.CreateOauthApplicationRow) model.OauthClient {
	return model.OauthClient{
		ID:                       r.ID,
		WorkspaceID:              r.WorkspaceID,
		CreatorID:                r.CreatorID,
		ClientID:                 r.ClientID,
		Name:                     r.Name,
		Description:              r.Description,
		Developer:                r.Developer,
		DeveloperURL:             r.DeveloperUrl,
		ImageURL:                 r.ImageUrl,
		RedirectURIs:             r.RedirectUris,
		AllowedScopes:            r.AllowedScopes,
		PublicEnabled:            r.PublicEnabled,
		ClientCredentialsEnabled: r.ClientCredentialsEnabled,
		WebhookURL:               r.WebhookUrl,
		CreatedAt:                r.CreatedAt,
		UpdatedAt:                r.UpdatedAt,
		ArchivedAt:               r.ArchivedAt,
	}
}

func toOauthClientListed(r store.ListOauthApplicationsForWorkspaceRow) model.OauthClient {
	return model.OauthClient{
		ID:                       r.ID,
		WorkspaceID:              r.WorkspaceID,
		CreatorID:                r.CreatorID,
		ClientID:                 r.ClientID,
		Name:                     r.Name,
		Description:              r.Description,
		Developer:                r.Developer,
		DeveloperURL:             r.DeveloperUrl,
		ImageURL:                 r.ImageUrl,
		RedirectURIs:             r.RedirectUris,
		AllowedScopes:            r.AllowedScopes,
		PublicEnabled:            r.PublicEnabled,
		ClientCredentialsEnabled: r.ClientCredentialsEnabled,
		WebhookURL:               r.WebhookUrl,
		CreatedAt:                r.CreatedAt,
		UpdatedAt:                r.UpdatedAt,
		ArchivedAt:               r.ArchivedAt,
	}
}

func toOauthClientFromGet(r store.GetOauthApplicationRow) model.OauthClient {
	return model.OauthClient{
		ID:                       r.ID,
		WorkspaceID:              r.WorkspaceID,
		CreatorID:                r.CreatorID,
		ClientID:                 r.ClientID,
		Name:                     r.Name,
		Description:              r.Description,
		Developer:                r.Developer,
		DeveloperURL:             r.DeveloperUrl,
		ImageURL:                 r.ImageUrl,
		RedirectURIs:             r.RedirectUris,
		AllowedScopes:            r.AllowedScopes,
		PublicEnabled:            r.PublicEnabled,
		ClientCredentialsEnabled: r.ClientCredentialsEnabled,
		WebhookURL:               r.WebhookUrl,
		CreatedAt:                r.CreatedAt,
		UpdatedAt:                r.UpdatedAt,
		ArchivedAt:               r.ArchivedAt,
	}
}

func toOauthClientFromByClientID(r store.GetOauthApplicationByClientIDRow) model.OauthClient {
	return model.OauthClient{
		ID:                       r.ID,
		WorkspaceID:              r.WorkspaceID,
		CreatorID:                r.CreatorID,
		ClientID:                 r.ClientID,
		Name:                     r.Name,
		Description:              r.Description,
		Developer:                r.Developer,
		DeveloperURL:             r.DeveloperUrl,
		ImageURL:                 r.ImageUrl,
		RedirectURIs:             r.RedirectUris,
		AllowedScopes:            r.AllowedScopes,
		PublicEnabled:            r.PublicEnabled,
		ClientCredentialsEnabled: r.ClientCredentialsEnabled,
		WebhookURL:               r.WebhookUrl,
		CreatedAt:                r.CreatedAt,
		UpdatedAt:                r.UpdatedAt,
		ArchivedAt:               r.ArchivedAt,
	}
}

func toOauthClientFromUpdate(r store.UpdateOauthApplicationRow) model.OauthClient {
	return model.OauthClient{
		ID:                       r.ID,
		WorkspaceID:              r.WorkspaceID,
		CreatorID:                r.CreatorID,
		ClientID:                 r.ClientID,
		Name:                     r.Name,
		Description:              r.Description,
		Developer:                r.Developer,
		DeveloperURL:             r.DeveloperUrl,
		ImageURL:                 r.ImageUrl,
		RedirectURIs:             r.RedirectUris,
		AllowedScopes:            r.AllowedScopes,
		PublicEnabled:            r.PublicEnabled,
		ClientCredentialsEnabled: r.ClientCredentialsEnabled,
		WebhookURL:               r.WebhookUrl,
		CreatedAt:                r.CreatedAt,
		UpdatedAt:                r.UpdatedAt,
		ArchivedAt:               r.ArchivedAt,
	}
}

func toOauthClientFromRotate(r store.RotateOauthApplicationSecretRow) model.OauthClient {
	return model.OauthClient{
		ID:                       r.ID,
		WorkspaceID:              r.WorkspaceID,
		CreatorID:                r.CreatorID,
		ClientID:                 r.ClientID,
		Name:                     r.Name,
		Description:              r.Description,
		Developer:                r.Developer,
		DeveloperURL:             r.DeveloperUrl,
		ImageURL:                 r.ImageUrl,
		RedirectURIs:             r.RedirectUris,
		AllowedScopes:            r.AllowedScopes,
		PublicEnabled:            r.PublicEnabled,
		ClientCredentialsEnabled: r.ClientCredentialsEnabled,
		WebhookURL:               r.WebhookUrl,
		CreatedAt:                r.CreatedAt,
		UpdatedAt:                r.UpdatedAt,
		ArchivedAt:               r.ArchivedAt,
	}
}
