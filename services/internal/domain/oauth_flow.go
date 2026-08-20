package domain

import (
	"context"
	"crypto/subtle"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

type CreateOauthAuthorizationInput struct {
	ClientID            string
	RedirectURI         string
	ResponseType        string
	Scope               string
	State               string
	Actor               string
	CodeChallenge       string
	CodeChallengeMethod string
	TeamIDs             []uuid.UUID
}

type OauthAuthorization struct {
	RedirectURI string
}

type OauthTokenRequest struct {
	GrantType    string
	Code         string
	RedirectURI  string
	ClientID     string
	ClientSecret string
	CodeVerifier string
	RefreshToken string
	Scope        string
}

type OauthTokenResponse struct {
	AccessToken  string
	TokenType    string
	ExpiresIn    int
	Scope        string
	RefreshToken string
}

func (s *Service) CreateOauthAuthorization(
	ctx context.Context, p *authz.Principal, in CreateOauthAuthorizationInput,
) (OauthAuthorization, error) {
	if p == nil {
		return OauthAuthorization{}, platform.Unauthorized("")
	}
	if p.IsGuest() {
		return OauthAuthorization{}, platform.Forbidden("guests cannot authorize applications")
	}
	if strings.TrimSpace(in.ResponseType) != "code" {
		return OauthAuthorization{}, platform.Validation("responseType", "response_type must be code")
	}

	actor := strings.TrimSpace(in.Actor)
	if actor == "" || actor == "application" {
		actor = "user"
	}
	if actor != "user" && actor != "app" {
		return OauthAuthorization{}, platform.Validation("actor", "actor must be user or app")
	}
	if actor == "app" && !p.Role.IsAdmin() {
		return OauthAuthorization{}, platform.Forbidden("installing an app as an actor requires admin")
	}

	app, err := s.db.Queries().GetOauthApplicationByClientID(ctx, strings.TrimSpace(in.ClientID))
	if err != nil {
		if store.IsNotFound(err) {
			return OauthAuthorization{}, platform.NotFound("oauth application")
		}
		return OauthAuthorization{}, platform.Internal(err)
	}
	if app.WorkspaceID != p.WorkspaceID && !app.PublicEnabled {
		return OauthAuthorization{}, platform.NotFound("oauth application")
	}
	if !redirectURIAllowed(app.RedirectUris, strings.TrimSpace(in.RedirectURI)) {
		return OauthAuthorization{}, platform.Validation("redirectUri", "redirect_uri is not registered on this application")
	}

	requested := parseScopeList(in.Scope)
	scopes, err := normaliseOauthScopes(requested, actor == "app")
	if err != nil {
		return OauthAuthorization{}, err
	}
	allowed := map[string]bool{}
	for _, sc := range app.AllowedScopes {
		allowed[sc] = true
	}
	allowed[OauthScopeRead] = true
	for _, sc := range scopes {
		if !allowed[sc] {
			return OauthAuthorization{}, platform.Validation("scope", "this application cannot request "+sc)
		}
	}

	method := strings.TrimSpace(in.CodeChallengeMethod)
	if in.CodeChallenge != "" && method != "" && method != "plain" && !strings.EqualFold(method, "S256") {
		return OauthAuthorization{}, platform.Validation("codeChallengeMethod", "code_challenge_method must be plain or S256")
	}

	code, _, codeHash, err := newPrefixedSecret(oauthAuthCodePrefix)
	if err != nil {
		return OauthAuthorization{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return OauthAuthorization{}, platform.Internal(err)
	}

	teamIDs := in.TeamIDs
	if teamIDs == nil {
		teamIDs = []uuid.UUID{}
	}

	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := q.CreateOauthAuthorizationCode(ctx, store.CreateOauthAuthorizationCodeParams{
			ID:                  id,
			ApplicationID:       app.ID,
			WorkspaceID:         p.WorkspaceID,
			UserID:              p.UserID,
			ActorKind:           actor,
			CodeHash:            codeHash,
			RedirectUri:         strings.TrimSpace(in.RedirectURI),
			Scopes:              scopes,
			CodeChallenge:       trimOauthString(ptr(strings.TrimSpace(in.CodeChallenge))),
			CodeChallengeMethod: trimOauthString(ptr(method)),
			TeamIds:             teamIDs,
			ExpiresAt:           time.Now().Add(oauthAuthCodeTTL),
		})
		return err
	})
	if err != nil {
		return OauthAuthorization{}, platform.Internal(err)
	}

	redir, err := url.Parse(strings.TrimSpace(in.RedirectURI))
	if err != nil {
		return OauthAuthorization{}, platform.Validation("redirectUri", "redirect_uri is not a URL")
	}
	q := redir.Query()
	q.Set("code", code)
	if strings.TrimSpace(in.State) != "" {
		q.Set("state", in.State)
	}
	redir.RawQuery = q.Encode()
	return OauthAuthorization{RedirectURI: redir.String()}, nil
}

func (s *Service) ExchangeOauthToken(ctx context.Context, in OauthTokenRequest) (OauthTokenResponse, error) {
	grant := strings.TrimSpace(in.GrantType)
	switch grant {
	case "authorization_code":
		return s.exchangeAuthorizationCode(ctx, in)
	case "refresh_token":
		return s.exchangeRefreshToken(ctx, in)
	case "client_credentials":
		return s.exchangeClientCredentials(ctx, in)
	default:
		return OauthTokenResponse{}, platform.Validation("grant_type", "unsupported grant_type")
	}
}

func (s *Service) exchangeAuthorizationCode(ctx context.Context, in OauthTokenRequest) (OauthTokenResponse, error) {
	app, err := s.authenticateOauthClient(ctx, in)
	if err != nil {
		return OauthTokenResponse{}, err
	}

	codeRow, err := s.db.Queries().GetOauthAuthorizationCodeByHash(ctx, auth.HashToken(strings.TrimSpace(in.Code)))
	if err != nil {
		if store.IsNotFound(err) {
			return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
		}
		return OauthTokenResponse{}, platform.Internal(err)
	}
	if codeRow.ApplicationID != app.ID {
		return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
	}
	if codeRow.ConsumedAt != nil || time.Now().After(codeRow.ExpiresAt) {
		return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
	}
	if codeRow.RedirectUri != strings.TrimSpace(in.RedirectURI) {
		return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
	}
	if codeRow.CodeChallenge != nil && *codeRow.CodeChallenge != "" {
		method := "plain"
		if codeRow.CodeChallengeMethod != nil && *codeRow.CodeChallengeMethod != "" {
			method = *codeRow.CodeChallengeMethod
		}
		if pkceChallenge(in.CodeVerifier, method) != *codeRow.CodeChallenge {
			return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
		}
	}

	var resp OauthTokenResponse
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := q.ConsumeOauthAuthorizationCode(ctx, codeRow.ID); err != nil {
			if store.IsNotFound(err) {
				return platform.Unauthorized("invalid grant")
			}
			return platform.Internal(err)
		}

		actorUserID := codeRow.UserID
		if codeRow.ActorKind == "app" {
			appUserID, err := s.ensureAppUser(ctx, q, app, codeRow.WorkspaceID, codeRow.TeamIds)
			if err != nil {
				return err
			}
			actorUserID = appUserID
		}

		issued, err := s.issueOauthTokenPair(ctx, q, issueOauthTokenParams{
			ApplicationID:     app.ID,
			WorkspaceID:       codeRow.WorkspaceID,
			UserID:            actorUserID,
			AuthorizingUserID: &codeRow.UserID,
			GrantType:         "authorization_code",
			Scopes:            codeRow.Scopes,
			TeamIDs:           codeRow.TeamIds,
			WithRefresh:       true,
			AccessTTL:         oauthAccessTTL,
			RefreshTTL:        oauthRefreshTTL,
		})
		if err != nil {
			return err
		}
		resp = issued.OauthTokenResponse
		return nil
	})
	if err != nil {
		return OauthTokenResponse{}, err
	}
	return resp, nil
}

func (s *Service) exchangeRefreshToken(ctx context.Context, in OauthTokenRequest) (OauthTokenResponse, error) {
	app, err := s.authenticateOauthClientOptionalSecret(ctx, in)
	if err != nil {
		return OauthTokenResponse{}, err
	}

	row, err := s.db.Queries().GetOauthTokenByRefreshHash(ctx, auth.HashToken(strings.TrimSpace(in.RefreshToken)))
	if err != nil {
		if store.IsNotFound(err) {
			return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
		}
		return OauthTokenResponse{}, platform.Internal(err)
	}
	if row.ApplicationID != app.ID {
		return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
	}

	// Grace: a consumed refresh token can be replayed for 30 minutes.
	if row.RevokedAt != nil && row.ReplacedBy != nil && row.RefreshReplayableUntil != nil &&
		time.Now().Before(*row.RefreshReplayableUntil) &&
		row.SuccessorAccessToken != nil && row.SuccessorRefreshToken != nil {
		return OauthTokenResponse{
			AccessToken:  *row.SuccessorAccessToken,
			TokenType:    "Bearer",
			ExpiresIn:    int(oauthAccessTTL / time.Second),
			Scope:        strings.Join(row.Scopes, " "),
			RefreshToken: *row.SuccessorRefreshToken,
		}, nil
	}
	if row.RevokedAt != nil || (row.RefreshExpiresAt != nil && time.Now().After(*row.RefreshExpiresAt)) {
		return OauthTokenResponse{}, platform.Unauthorized("invalid grant")
	}

	var resp OauthTokenResponse
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		issued, err := s.issueOauthTokenPair(ctx, q, issueOauthTokenParams{
			ApplicationID:     row.ApplicationID,
			WorkspaceID:       row.WorkspaceID,
			UserID:            row.UserID,
			AuthorizingUserID: row.AuthorizingUserID,
			GrantType:         "refresh_token",
			Scopes:            row.Scopes,
			TeamIDs:           row.TeamIds,
			WithRefresh:       true,
			AccessTTL:         oauthAccessTTL,
			RefreshTTL:        oauthRefreshTTL,
		})
		if err != nil {
			return err
		}
		until := time.Now().Add(oauthRefreshGrace)
		if err := q.MarkOauthRefreshRotated(ctx, store.MarkOauthRefreshRotatedParams{
			ReplacedBy:             &issued.id,
			RefreshReplayableUntil: &until,
			SuccessorAccessToken:   &issued.AccessToken,
			SuccessorRefreshToken:  &issued.RefreshToken,
			ID:                     row.ID,
		}); err != nil {
			return platform.Internal(err)
		}
		resp = issued.OauthTokenResponse
		return nil
	})
	if err != nil {
		return OauthTokenResponse{}, err
	}
	return resp, nil
}

func (s *Service) exchangeClientCredentials(ctx context.Context, in OauthTokenRequest) (OauthTokenResponse, error) {
	app, err := s.authenticateOauthClient(ctx, in)
	if err != nil {
		return OauthTokenResponse{}, err
	}
	secretRow, err := s.db.Queries().GetOauthApplicationSecretHashByClientID(ctx, app.ClientID)
	if err != nil {
		return OauthTokenResponse{}, platform.Internal(err)
	}
	if !secretRow.ClientCredentialsEnabled {
		return OauthTokenResponse{}, platform.Forbidden("client credentials are not enabled on this application")
	}

	scopes, err := normaliseOauthScopes(parseScopeList(in.Scope), true)
	if err != nil {
		return OauthTokenResponse{}, err
	}
	allowed := map[string]bool{}
	for _, sc := range app.AllowedScopes {
		allowed[sc] = true
	}
	allowed[OauthScopeRead] = true
	for _, sc := range scopes {
		if !allowed[sc] {
			return OauthTokenResponse{}, platform.Validation("scope", "this application cannot request "+sc)
		}
	}

	var resp OauthTokenResponse
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		live, err := q.ListLiveClientCredentialsTokens(ctx, app.ID)
		if err != nil {
			return platform.Internal(err)
		}
		same := true
		for _, t := range live {
			if !scopesEqual(t.Scopes, scopes) {
				same = false
				break
			}
		}
		if !same {
			if _, err := q.RevokeClientCredentialsTokensForApplication(ctx, app.ID); err != nil {
				return platform.Internal(err)
			}
		} else if len(live) >= maxClientCredentialsTokens {
			return platform.Validation("client_credentials", "this application already has 1000 live client-credentials tokens")
		}

		appUserID, err := s.ensureAppUser(ctx, q, app, app.WorkspaceID, nil)
		if err != nil {
			return err
		}
		issued, err := s.issueOauthTokenPair(ctx, q, issueOauthTokenParams{
			ApplicationID: app.ID,
			WorkspaceID:   app.WorkspaceID,
			UserID:        appUserID,
			GrantType:     "client_credentials",
			Scopes:        scopes,
			TeamIDs:       []uuid.UUID{},
			WithRefresh:   false,
			AccessTTL:     oauthClientCredentialsTTL,
		})
		if err != nil {
			return err
		}
		resp = issued.OauthTokenResponse
		return nil
	})
	if err != nil {
		return OauthTokenResponse{}, err
	}
	return resp, nil
}

func (s *Service) RevokeOauthToken(ctx context.Context, token, hint string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return platform.Validation("token", "token is required")
	}
	hash := auth.HashToken(token)
	q := s.db.Queries()

	tryAccess := hint == "" || hint == "access_token"
	tryRefresh := hint == "" || hint == "refresh_token"

	if tryAccess {
		if _, err := q.RevokeOauthTokenByAccessHash(ctx, hash); err == nil {
			return nil
		} else if !store.IsNotFound(err) {
			return platform.Internal(err)
		}
	}
	if tryRefresh {
		if _, err := q.RevokeOauthTokenByRefreshHash(ctx, hash); err == nil {
			return nil
		} else if !store.IsNotFound(err) {
			return platform.Internal(err)
		}
	}
	return platform.Validation("token", "unable to revoke")
}

// IsOauthAccessToken reports whether a bearer token is a Polaris OAuth access token
// rather than a session JWT or a personal API key.
func IsOauthAccessToken(token string) bool {
	return strings.HasPrefix(token, oauthAccessTokenPrefix)
}

func (s *Service) AuthenticateOauthToken(ctx context.Context, token string) (*authz.Principal, error) {
	invalid := func() error { return platform.Unauthorized("invalid access token") }
	if token == "" {
		return nil, invalid()
	}
	q := s.db.Queries()
	row, err := q.GetOauthTokenByAccessHash(ctx, auth.HashToken(token))
	if err != nil {
		if store.IsNotFound(err) {
			return nil, invalid()
		}
		return nil, platform.Internal(err)
	}

	user, err := q.GetUser(ctx, row.UserID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, invalid()
		}
		return nil, platform.Internal(err)
	}
	if user.WorkspaceID != row.WorkspaceID || user.ArchivedAt != nil || user.Status != "active" {
		return nil, invalid()
	}

	p, err := s.principalFromUser(ctx, user, row.Scopes, row.TeamIds)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeInternal {
			return nil, err
		}
		return nil, invalid()
	}
	p.ApplicationID = row.ApplicationID
	_ = q.TouchOauthTokenLastUsed(ctx, row.ID)
	return p, nil
}

func (s *Service) principalFromUser(
	ctx context.Context, user store.User, scopes []string, teamIDs []uuid.UUID,
) (*authz.Principal, error) {
	accountID := uuid.Nil
	if user.AccountID != nil {
		accountID = *user.AccountID
	}

	memberships, err := s.db.Queries().ListTeamIDsForUser(ctx, user.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	teams := authz.NewTeamSet(memberships...)
	if authz.Role(user.Role) != authz.RoleGuest {
		all, err := s.db.Queries().ListTeamsInWorkspace(ctx, user.WorkspaceID)
		if err != nil {
			return nil, platform.Internal(err)
		}
		for _, t := range all {
			if !t.Private {
				teams[t.ID] = struct{}{}
			}
		}
	}
	if len(teamIDs) > 0 {
		allowed := authz.NewTeamSet(teamIDs...)
		restricted := authz.NewTeamSet()
		for id := range teams {
			if allowed.Has(id) {
				restricted[id] = struct{}{}
			}
		}
		teams = restricted
	}

	kind := user.Kind
	actorType := authz.ActorUser
	if kind == "app" {
		actorType = authz.ActorAppUser
	}

	return &authz.Principal{
		AccountID:      accountID,
		UserID:         user.ID,
		WorkspaceID:    user.WorkspaceID,
		Role:           authz.Role(user.Role),
		Teams:          teams,
		SharedEntities: map[uuid.UUID]struct{}{},
		Scopes:         scopes,
		ActorType:      actorType,
	}, nil
}

type oauthAppRef struct {
	ID                       uuid.UUID
	WorkspaceID              uuid.UUID
	ClientID                 string
	Name                     string
	RedirectUris             []string
	AllowedScopes            []string
	PublicEnabled            bool
	ClientCredentialsEnabled bool
}

func (s *Service) authenticateOauthClient(ctx context.Context, in OauthTokenRequest) (oauthAppRef, error) {
	app, err := s.lookupOauthClient(ctx, in.ClientID)
	if err != nil {
		return oauthAppRef{}, err
	}
	row, err := s.db.Queries().GetOauthApplicationSecretHashByClientID(ctx, app.ClientID)
	if err != nil {
		return oauthAppRef{}, platform.Unauthorized("invalid client")
	}
	if in.ClientSecret == "" || !auth.ConstantTimeEqualHash(row.ClientSecretHash, auth.HashToken(in.ClientSecret)) {
		return oauthAppRef{}, platform.Unauthorized("invalid client")
	}
	return app, nil
}

func (s *Service) authenticateOauthClientOptionalSecret(ctx context.Context, in OauthTokenRequest) (oauthAppRef, error) {
	app, err := s.lookupOauthClient(ctx, in.ClientID)
	if err != nil {
		return oauthAppRef{}, err
	}
	if strings.TrimSpace(in.ClientSecret) == "" {
		return app, nil
	}
	row, err := s.db.Queries().GetOauthApplicationSecretHashByClientID(ctx, app.ClientID)
	if err != nil {
		return oauthAppRef{}, platform.Unauthorized("invalid client")
	}
	if !auth.ConstantTimeEqualHash(row.ClientSecretHash, auth.HashToken(in.ClientSecret)) {
		return oauthAppRef{}, platform.Unauthorized("invalid client")
	}
	return app, nil
}

func (s *Service) lookupOauthClient(ctx context.Context, clientID string) (oauthAppRef, error) {
	row, err := s.db.Queries().GetOauthApplicationByClientID(ctx, strings.TrimSpace(clientID))
	if err != nil {
		if store.IsNotFound(err) {
			return oauthAppRef{}, platform.Unauthorized("invalid client")
		}
		return oauthAppRef{}, platform.Internal(err)
	}
	return oauthAppRef{
		ID:                       row.ID,
		WorkspaceID:              row.WorkspaceID,
		ClientID:                 row.ClientID,
		Name:                     row.Name,
		RedirectUris:             row.RedirectUris,
		AllowedScopes:            row.AllowedScopes,
		PublicEnabled:            row.PublicEnabled,
		ClientCredentialsEnabled: row.ClientCredentialsEnabled,
	}, nil
}

func (s *Service) ensureAppUser(
	ctx context.Context, q *store.Queries, app oauthAppRef, workspaceID uuid.UUID, teamIDs []uuid.UUID,
) (uuid.UUID, error) {
	existing, err := q.GetOauthAppUser(ctx, store.GetOauthAppUserParams{
		ApplicationID: app.ID, WorkspaceID: workspaceID,
	})
	if err == nil {
		return existing.UserID, nil
	}
	if !store.IsNotFound(err) {
		return uuid.Nil, platform.Internal(err)
	}

	display := slugDisplayName(app.Name)
	n, err := q.CountUsersWithDisplayName(ctx, store.CountUsersWithDisplayNameParams{
		WorkspaceID: workspaceID, DisplayName: display,
	})
	if err != nil {
		return uuid.Nil, platform.Internal(err)
	}
	if n > 0 {
		display = display + "-" + strings.TrimPrefix(app.ID.String()[:8], "")
		if n, err := q.CountUsersWithDisplayName(ctx, store.CountUsersWithDisplayNameParams{
			WorkspaceID: workspaceID, DisplayName: display,
		}); err != nil {
			return uuid.Nil, platform.Internal(err)
		} else if n > 0 {
			display = display + "-" + workspaceID.String()[:4]
		}
	}

	userID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, platform.Internal(err)
	}
	user, err := q.CreateUser(ctx, store.CreateUserParams{
		ID:          userID,
		WorkspaceID: workspaceID,
		AccountID:   nil,
		Name:        app.Name,
		DisplayName: display,
		Timezone:    "UTC",
		Role:        "member",
		Kind:        "app",
	})
	if err != nil {
		return uuid.Nil, platform.Internal(err)
	}
	if _, err := q.CreateOauthAppUser(ctx, store.CreateOauthAppUserParams{
		ApplicationID: app.ID, WorkspaceID: workspaceID, UserID: user.ID,
	}); err != nil {
		return uuid.Nil, platform.Internal(err)
	}

	targets := teamIDs
	if len(targets) == 0 {
		all, err := q.ListTeamsInWorkspace(ctx, workspaceID)
		if err != nil {
			return uuid.Nil, platform.Internal(err)
		}
		for _, t := range all {
			if !t.Private {
				targets = append(targets, t.ID)
			}
		}
	}
	changes := []Change{{
		EntityType: "user", EntityID: user.ID, Op: OpUpsert,
		Scope: authz.WorkspaceScope(), Payload: toUser(user),
	}}
	for _, teamID := range targets {
		mid, err := uuid.NewV7()
		if err != nil {
			return uuid.Nil, platform.Internal(err)
		}
		m, err := q.AddTeamMember(ctx, store.AddTeamMemberParams{
			ID: mid, WorkspaceID: workspaceID, TeamID: teamID, UserID: user.ID, Role: "member",
		})
		if err != nil {
			return uuid.Nil, platform.Internal(err)
		}
		tid := teamID
		changes = append(changes, Change{
			EntityType: "teamMembership", EntityID: m.ID, Op: OpUpsert, TeamID: &tid,
			Scope: authz.TeamScope(teamID, false), Payload: toMembership(m),
		})
	}
	if _, err := s.em.Emit(ctx, q, workspaceID, authz.AppActor(user.ID), changes...); err != nil {
		return uuid.Nil, err
	}
	return user.ID, nil
}

type issueOauthTokenParams struct {
	ApplicationID     uuid.UUID
	WorkspaceID       uuid.UUID
	UserID            uuid.UUID
	AuthorizingUserID *uuid.UUID
	GrantType         string
	Scopes            []string
	TeamIDs           []uuid.UUID
	WithRefresh       bool
	AccessTTL         time.Duration
	RefreshTTL        time.Duration
}

type issuedOauthToken struct {
	OauthTokenResponse
	id uuid.UUID
}

func (s *Service) issueOauthTokenPair(ctx context.Context, q *store.Queries, in issueOauthTokenParams) (issuedOauthToken, error) {
	access, _, accessHash, err := newPrefixedSecret(oauthAccessTokenPrefix)
	if err != nil {
		return issuedOauthToken{}, err
	}
	var refresh *string
	var refreshHash []byte
	refreshVal := ""
	if in.WithRefresh {
		plain, _, hash, err := newPrefixedSecret(oauthRefreshTokenPrefix)
		if err != nil {
			return issuedOauthToken{}, err
		}
		refreshVal = plain
		refresh = &plain
		refreshHash = hash
	}
	id, err := uuid.NewV7()
	if err != nil {
		return issuedOauthToken{}, platform.Internal(err)
	}
	now := time.Now()
	accessExp := now.Add(in.AccessTTL)
	var refreshExp *time.Time
	if in.WithRefresh {
		t := now.Add(in.RefreshTTL)
		refreshExp = &t
	}
	teams := in.TeamIDs
	if teams == nil {
		teams = []uuid.UUID{}
	}
	if _, err := q.CreateOauthToken(ctx, store.CreateOauthTokenParams{
		ID:                id,
		ApplicationID:     in.ApplicationID,
		WorkspaceID:       in.WorkspaceID,
		UserID:            in.UserID,
		AuthorizingUserID: in.AuthorizingUserID,
		GrantType:         in.GrantType,
		AccessTokenHash:   accessHash,
		RefreshTokenHash:  refreshHash,
		Scopes:            in.Scopes,
		TeamIds:           teams,
		AccessExpiresAt:   accessExp,
		RefreshExpiresAt:  refreshExp,
	}); err != nil {
		return issuedOauthToken{}, platform.Internal(err)
	}
	out := issuedOauthToken{
		id: id,
		OauthTokenResponse: OauthTokenResponse{
			AccessToken: access,
			TokenType:   "Bearer",
			ExpiresIn:   int(in.AccessTTL / time.Second),
			Scope:       strings.Join(in.Scopes, " "),
		},
	}
	if refresh != nil {
		out.RefreshToken = refreshVal
	}
	return out, nil
}

func scopesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	left := strings.Join(a, "\x00")
	right := strings.Join(b, "\x00")
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func ptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
