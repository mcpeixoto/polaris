package httpapi

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// refreshCookie carries the refresh token.
//
// A cookie rather than a JSON field so it can be HttpOnly: script on the page cannot read
// it, which removes the most common way a long-lived credential is exfiltrated by an XSS.
// The short-lived access token, by contrast, is handed to the client in the body because
// it has to go in an Authorization header and on the WebSocket hello frame.
const refreshCookie = "polaris_refresh"

type authHandlers struct {
	svc       *domain.Service
	tokens    *Tokens
	publicURL string
	secure    bool

	// openSignup mirrors POLARIS_REGISTRATION_MODE=open. False — the closed server — is both
	// the default and the value a zero authHandlers carries, so a wiring mistake fails towards
	// refusing strangers rather than towards admitting them.
	openSignup bool

	// maxWorkspaces bounds how many workspaces one account may belong to. Zero is unlimited,
	// which is also what a zero authHandlers carries — the permissive direction, unlike
	// openSignup above, because a bound that silently became "one" would lock every existing
	// account out of creating anything and read as a broken deployment rather than a policy.
	maxWorkspaces int

	// defaultPlan is the entitlement plan a workspace created here starts on. Empty means
	// self-hosted, which is what domain.CreateWorkspace assumes when it is given nothing —
	// so a wiring mistake gives somebody the unlimited plan rather than silently capping
	// their install at five seats.
	defaultPlan entitlement.Plan

	// limits carries the per-account sign-in budget. Nil when rate limiting is off.
	limits *Limits

	// devAutoLogin is whether POST /auth/dev-session is willing to mint a cookie.
	// Copied from config at router construction; the handler still requires a
	// loopback Host and peer, so a development process reached as a real hostname
	// does not sign anyone in.
	devAutoLogin bool
}

// credentialsRequest is the sign-in body.
//
// A separate type from registerRequest, which it used to share. decodeJSON sets
// DisallowUnknownFields, so sharing one struct would have made POST /auth/login quietly
// accept an inviteToken and do nothing with it — a request that looks like it worked and
// leaves the person unjoined.
type credentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`

	// InviteToken is the invitation this registration redeems, and it is what admits the
	// caller at all on a default install. It rides along with the credentials rather than
	// being exchanged for something first, so that the account and the workspace membership
	// are one transaction — see domain.RegisterInput for why the two-call version is a state
	// somebody lands in and cannot get out of.
	InviteToken string `json:"inviteToken,omitempty"`

	// DisplayName is the name the invited person takes in the workspace they are joining.
	DisplayName string `json:"displayName,omitempty"`
}

type authResponse struct {
	AccessToken string            `json:"accessToken"`
	ExpiresIn   int               `json:"expiresIn"`
	AccountID   uuid.UUID         `json:"accountId"`
	Workspaces  []model.Workspace `json:"workspaces"`
}

func (h *authHandlers) register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	// Registration shares the sign-in budget, keyed the same way. Repeated attempts to
	// register an address that already exists is account enumeration wearing a different
	// hat, and it deserves the same wall as guessing that account's password.
	//
	// Charged before the invitation is looked at, so that probing the endpoint costs the
	// same whether the caller is refused for having no invitation or admitted for having
	// one. A budget spent only by successful registrations would be a free oracle.
	if !h.limits.LoginAttempt(w, r, req.Email) {
		return
	}

	accountID, session, err := h.svc.Register(r.Context(), domain.RegisterInput{
		Email:           req.Email,
		Password:        req.Password,
		InviteToken:     req.InviteToken,
		DisplayName:     req.DisplayName,
		AllowOpenSignup: h.openSignup,
		UserAgent:       r.UserAgent(),
		IP:              clientIP(r),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.completeLogin(w, r, accountID, session)
}

func (h *authHandlers) login(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	// Charged before the password is ever looked at, so the budget is spent identically
	// whether the account exists, the password was right, or neither.
	if !h.limits.LoginAttempt(w, r, req.Email) {
		return
	}

	accountID, session, err := h.svc.Login(r.Context(), domain.LoginInput{
		Email:     req.Email,
		Password:  req.Password,
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.completeLogin(w, r, accountID, session)
}

// refresh rotates the refresh token and mints a new access token.
func (h *authHandlers) refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil || c.Value == "" {
		writeError(w, r, platform.Unauthorized("no session"))
		return
	}

	accountID, session, err := h.svc.RefreshSession(r.Context(), c.Value)
	if err != nil {
		// The old cookie is dead either way. Leaving it in place means the client retries
		// forever against a token that will never work again.
		h.clearRefreshCookie(w)
		writeError(w, r, err)
		return
	}
	h.completeLogin(w, r, accountID, session)
}

// devSession mints a refresh cookie for local development, with no password form.
//
// Unreachable unless both gates pass: the process opted in (development, or an
// explicit POLARIS_DEV_AUTOLOGIN=1, and never production), and the request is
// from loopback. A miss looks like any other unknown path so the endpoint does
// not advertise itself on a public Host.
func (h *authHandlers) devSession(w http.ResponseWriter, r *http.Request) {
	if !h.devAutoLogin || !requestIsLoopback(r) {
		writeError(w, r, platform.NotFound("endpoint"))
		return
	}

	accountID, session, err := h.svc.LoginDev(r.Context(), r.UserAgent(), clientIP(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.completeLogin(w, r, accountID, session)
}

func (h *authHandlers) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil && c.Value != "" {
		_ = h.svc.RevokeSession(r.Context(), c.Value)
	}
	h.clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

type createWorkspaceRequest struct {
	Name            string `json:"name"`
	URLKey          string `json:"urlKey"`
	UserName        string `json:"userName"`
	UserDisplayName string `json:"userDisplayName"`
	UserTimezone    string `json:"userTimezone"`
	FirstTeamKey    string `json:"firstTeamKey"`
	FirstTeamName   string `json:"firstTeamName"`
}

func (h *authHandlers) createWorkspace(w http.ResponseWriter, r *http.Request) {
	accountID, ok := AccountFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized(""))
		return
	}

	var req createWorkspaceRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	result, err := h.svc.CreateWorkspace(r.Context(), domain.CreateWorkspaceInput{
		AccountID:       accountID,
		Name:            req.Name,
		URLKey:          req.URLKey,
		UserName:        req.UserName,
		UserDisplayName: req.UserDisplayName,
		UserTimezone:    req.UserTimezone,
		FirstTeamKey:    req.FirstTeamKey,
		FirstTeamName:   req.FirstTeamName,
		Plan:            h.defaultPlan,
		MaxPerAccount:   h.maxWorkspaces,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

type acceptInviteRequest struct {
	Token       string `json:"token"`
	DisplayName string `json:"displayName"`
}

func (h *authHandlers) acceptInvite(w http.ResponseWriter, r *http.Request) {
	accountID, ok := AccountFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized(""))
		return
	}

	var req acceptInviteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	user, workspaceID, err := h.svc.AcceptInvite(r.Context(), accountID, req.Token, req.DisplayName)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":        user,
		"workspaceId": workspaceID,
	})
}

// workspaces powers the switcher and the post-login redirect.
func (h *authHandlers) workspaces(w http.ResponseWriter, r *http.Request) {
	accountID, ok := AccountFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized(""))
		return
	}
	list, err := h.svc.ListWorkspacesForAccount(r.Context(), accountID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": list})
}

// completeLogin sets the refresh cookie and returns an access token plus the account's
// workspaces, so the client can route straight into one without a second round trip.
func (h *authHandlers) completeLogin(w http.ResponseWriter, r *http.Request, accountID uuid.UUID, session domain.Session) {
	access, err := h.tokens.Issue(auth.Claims{AccountID: accountID})
	if err != nil {
		writeError(w, r, platform.Internal(err))
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Value:    session.RefreshToken,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		Secure:   h.secure,
		// Lax, not Strict: the invitation flow arrives by following a link from an email
		// client, and Strict would drop the cookie on exactly that navigation and log the
		// person out at the moment they were being invited in.
		SameSite: http.SameSiteLaxMode,
	})

	workspaces, err := h.svc.ListWorkspacesForAccount(r.Context(), accountID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		AccessToken: access,
		ExpiresIn:   int(h.tokens.TTL() / time.Second),
		AccountID:   accountID,
		Workspaces:  workspaces,
	})
}

func (h *authHandlers) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
	})
}
