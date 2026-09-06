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

// register is dynamic client registration, RFC 7591. Unauthenticated by necessity: the
// client is asking for an identity before anybody has signed in. Registration confers
// nothing on its own — the consent screen is where a person decides what this client may
// reach — so what stands in front of this endpoint is the anonymous rate limiter.
func (h *oauthHandlers) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClientName              string   `json:"client_name"`
		RedirectURIs            []string `json:"redirect_uris"`
		GrantTypes              []string `json:"grant_types"`
		ResponseTypes           []string `json:"response_types"`
		Scope                   string   `json:"scope"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "could not parse the request body")
		return
	}

	// We issue no secret, so the only auth method a registered client can use is none.
	// A client asking for a secret-based method is told now rather than at its first
	// token exchange, when the failure would look like a bad credential.
	if m := strings.TrimSpace(body.TokenEndpointAuthMethod); m != "" && m != "none" {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata",
			"only token_endpoint_auth_method=none is supported; this server issues public clients")
		return
	}
	for _, g := range body.GrantTypes {
		switch strings.TrimSpace(g) {
		case "", "authorization_code", "refresh_token":
		default:
			writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata",
				"supported grant_types are authorization_code and refresh_token")
			return
		}
	}
	for _, t := range body.ResponseTypes {
		if v := strings.TrimSpace(t); v != "" && v != "code" {
			writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "the only response_type is code")
			return
		}
	}

	reg, err := h.svc.RegisterDynamicClient(r.Context(), domain.RegisterDynamicClientInput{
		ClientName:   body.ClientName,
		RedirectURIs: body.RedirectURIs,
		Scope:        body.Scope,
	})
	if err != nil {
		writeOAuthMappedError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  reg.ClientID,
		"client_id_issued_at":        reg.ClientIDIssuedAt.Unix(),
		"client_name":                reg.ClientName,
		"redirect_uris":              reg.RedirectURIs,
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": reg.TokenEndpointAuthMeth,
		"scope":                      strings.Join(reg.Scopes, " "),
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
