package httpapi

import (
	"errors"
	"net/http"

	"github.com/peixotolabs/polaris/services/internal/auth/oidc"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Sign in with Google, and with Apple.
//
// One endpoint, `POST /auth/oidc/{provider}`, taking the ID token the client already holds.
// There is no authorization-code exchange and no client secret anywhere in the product:
// Google Identity Services, Apple's JS, and ASAuthorization on iOS all hand the client a
// signed ID token, and verifying one needs only the issuer's public keys. Adding a code
// exchange would mean holding a secret per platform and a redirect endpoint per platform,
// to arrive at the same claims.
type socialAuthHandlers struct {
	*authHandlers
	verifier  *oidc.Verifier
	providers map[string]oidc.Provider
}

type socialSignInRequest struct {
	// IDToken is the credential the provider handed the client.
	IDToken string `json:"idToken"`
	// Nonce is the value the client bound into the request, when it bound one. Compared
	// against the token's claim; a client that sends nothing is not checked, which is the
	// case for flows where the platform does the binding itself.
	Nonce string `json:"nonce"`
	// DisplayName carries Apple's one-time gift: the person's name is sent on the first
	// authorisation and never again, so a client that drops it has lost it permanently.
	DisplayName string `json:"displayName"`
	// InviteToken redeems an invitation on the same call, exactly as registration does.
	InviteToken string `json:"inviteToken"`
}

func (h *socialAuthHandlers) signIn(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("provider")
	provider, ok := h.providers[name]
	if !ok || !provider.Configured() {
		// 404 rather than 400: on a deployment that has not configured this provider the
		// endpoint genuinely does not exist, and saying so is what lets a client tell
		// "not offered here" from "your token was rejected".
		writeError(w, r, platform.NotFound("sign-in provider"))
		return
	}

	var req socialSignInRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if req.IDToken == "" {
		writeError(w, r, platform.Validation("idToken", "an ID token is required"))
		return
	}

	// The same budget a password attempt spends, keyed by provider rather than by address:
	// the address is inside a token that has not been verified yet, so it is not something
	// to trust with a rate-limit bucket.
	if !h.limits.LoginAttempt(w, r, "oidc:"+name) {
		return
	}

	claims, err := h.verifier.Verify(r.Context(), provider, req.IDToken, req.Nonce)
	if err != nil {
		if errors.Is(err, oidc.ErrToken) {
			// One answer for every rejection. The verifier distinguishes a dozen causes for
			// its own logs; telling the caller which one would answer questions for somebody
			// holding a token they should not have.
			platform.Log(r.Context()).Info("social sign-in refused",
				"provider", name, "reason", err.Error())
			writeError(w, r, platform.Unauthorized("that sign-in could not be verified"))
			return
		}
		// The issuer is unreachable, or served something unusable. Not the caller's fault
		// and not fixable by trying a different account.
		platform.Log(r.Context()).Error("social sign-in provider unavailable",
			"provider", name, "error", err)
		writeError(w, r, platform.Internal(err))
		return
	}

	result, err := h.svc.SignInWithSocial(r.Context(), domain.SocialSignInInput{
		Provider:        name,
		Claims:          claims,
		DisplayName:     req.DisplayName,
		UserAgent:       r.UserAgent(),
		IP:              clientIP(r),
		AllowOpenSignup: h.openSignup,
		InviteToken:     req.InviteToken,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	platform.Log(r.Context()).Info("social sign-in",
		"provider", name, "account", result.AccountID,
		"created", result.Created, "linked", result.Linked)
	h.completeLogin(w, r, result.AccountID, result.Session)
}

// providers reports which sign-in providers this deployment offers, so a client can render
// the buttons that will actually work rather than one that 404s.
func (h *socialAuthHandlers) available(w http.ResponseWriter, _ *http.Request) {
	names := make([]string, 0, len(h.providers))
	// Fixed order: a list whose order changes between requests makes the buttons move.
	for _, name := range []string{"google", "apple"} {
		if provider, ok := h.providers[name]; ok && provider.Configured() {
			names = append(names, name)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"providers": names,
		// The client ids are needed by the browser SDKs to start the flow, and they are not
		// secret — they appear in the redirect URL of every sign-in that has ever happened.
		"googleClientId": firstOr(h.providers["google"].Audiences, ""),
		"openSignup":     h.openSignup,
	})
}

func firstOr(values []string, fallback string) string {
	if len(values) == 0 {
		return fallback
	}
	return values[0]
}
