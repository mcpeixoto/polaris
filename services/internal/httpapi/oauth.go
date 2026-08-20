package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

type oauthHandlers struct {
	svc *domain.Service
}

type oauthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

type oauthErrorBody struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
}

func (h *oauthHandlers) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "could not parse the form body")
		return
	}
	clientID, clientSecret := r.FormValue("client_id"), r.FormValue("client_secret")
	if id, secret, ok := basicClient(r); ok {
		clientID, clientSecret = id, secret
	}

	resp, err := h.svc.ExchangeOauthToken(r.Context(), domain.OauthTokenRequest{
		GrantType:    r.FormValue("grant_type"),
		Code:         r.FormValue("code"),
		RedirectURI:  r.FormValue("redirect_uri"),
		ClientID:     clientID,
		ClientSecret: clientSecret,
		CodeVerifier: r.FormValue("code_verifier"),
		RefreshToken: r.FormValue("refresh_token"),
		Scope:        r.FormValue("scope"),
	})
	if err != nil {
		writeOAuthMappedError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, oauthTokenResponse{
		AccessToken:  resp.AccessToken,
		TokenType:    resp.TokenType,
		ExpiresIn:    resp.ExpiresIn,
		Scope:        resp.Scope,
		RefreshToken: resp.RefreshToken,
	})
}

func (h *oauthHandlers) revoke(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "could not parse the form body")
		return
	}
	token := r.FormValue("token")
	if token == "" {
		token = r.FormValue("access_token")
	}
	if token == "" {
		token = r.FormValue("refresh_token")
	}
	if err := h.svc.RevokeOauthToken(r.Context(), token, r.FormValue("token_type_hint")); err != nil {
		writeOAuthMappedError(w, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func basicClient(r *http.Request) (id, secret string, ok bool) {
	h := r.Header.Get("Authorization")
	const prefix = "Basic "
	if len(h) < len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", "", false
	}
	raw, err := base64.StdEncoding.DecodeString(h[len(prefix):])
	if err != nil {
		return "", "", false
	}
	id, secret, found := strings.Cut(string(raw), ":")
	if !found {
		return "", "", false
	}
	return id, secret, true
}

func writeOAuthMappedError(w http.ResponseWriter, err error) {
	code := platform.CodeOf(err)
	oauthCode := "invalid_request"
	status := http.StatusBadRequest
	desc := ""
	var pe *platform.Error
	if errors.As(err, &pe) {
		desc = pe.Message
	}
	switch code {
	case platform.CodeUnauthorized:
		oauthCode = "invalid_client"
		status = http.StatusUnauthorized
		if desc == "invalid grant" {
			oauthCode = "invalid_grant"
		}
	case platform.CodeForbidden:
		oauthCode = "unauthorized_client"
		status = http.StatusForbidden
	case platform.CodeNotFound:
		oauthCode = "invalid_client"
		status = http.StatusUnauthorized
	case platform.CodeValidation:
		oauthCode = "invalid_request"
		if pe != nil && pe.Field == "grant_type" {
			oauthCode = "unsupported_grant_type"
		}
		if pe != nil && pe.Field == "scope" {
			oauthCode = "invalid_scope"
		}
	case platform.CodeInternal:
		oauthCode = "server_error"
		status = http.StatusInternalServerError
		desc = "internal error"
	}
	writeOAuthError(w, status, oauthCode, desc)
}

func writeOAuthError(w http.ResponseWriter, status int, code, desc string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", `Basic realm="oauth"`)
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(oauthErrorBody{Error: code, ErrorDescription: desc})
}
