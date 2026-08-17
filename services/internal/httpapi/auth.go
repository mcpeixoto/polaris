package httpapi

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
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
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
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

	accountID, session, err := h.svc.Register(r.Context(), domain.RegisterInput{
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

func (h *authHandlers) login(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
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
