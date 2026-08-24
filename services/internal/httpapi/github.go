package httpapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	gh "github.com/peixotolabs/polaris/services/internal/integrations/github"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

const (
	githubOAuthCookie = "polaris_github_oauth"
	githubMaxBody     = 25 << 20
	githubOAuthTTL    = 10 * time.Minute
)

type githubHandlers struct {
	svc       *domain.Service
	tokens    *Tokens
	cfg       platform.Config
	publicURL string
	secure    bool
	replay    *platform.ReplayGuard
}

func (h *githubHandlers) events(w http.ResponseWriter, r *http.Request) {
	body, err := readGitHubBody(w, r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if !platform.GitHubSignatureOK(h.cfg.GitHubWebhookSecret, body, r.Header.Get("X-Hub-Signature-256")) {
		writeError(w, r, platform.Unauthorized("bad github webhook signature"))
		return
	}

	// The signature covers the body and stays valid for as long as the secret does, so a
	// captured delivery re-posted tomorrow verifies exactly as it did today. GitHub ships a
	// per-delivery UUID in X-GitHub-Delivery for this, and nothing in this repository has
	// ever read it — nor could it safely, because that header is outside the MAC and a
	// replayer can set it to anything. The body is the part the signature pins, so the body
	// is what gets remembered.
	key := platform.WebhookDeliveryKey("github", "app", body)
	if h.replay.Seen(key, time.Now()) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "duplicate"})
		return
	}
	if h.ingestEvent(w, r, body) {
		h.replay.Record(key, time.Now())
	}
}

// ingestEvent handles a verified, non-duplicate delivery and reports whether it completed.
// False on every error path, so a delivery that failed halfway stays replayable.
func (h *githubHandlers) ingestEvent(w http.ResponseWriter, r *http.Request, body []byte) bool {
	event := r.Header.Get("X-GitHub-Event")
	switch event {
	case "ping":
		writeJSON(w, http.StatusOK, map[string]string{"ok": "pong"})
		return true
	case "pull_request":
		parsed, err := gh.ParsePullRequest(body)
		if err != nil {
			writeError(w, r, platform.Validation("", "could not parse the GitHub payload"))
			return false
		}
		if parsed.Installation == 0 {
			writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
			return true
		}
		conn, err := h.svc.GetGitHubConnectionByInstallation(r.Context(), parsed.Installation)
		if err != nil {
			if platform.CodeOf(err) == platform.CodeNotFound {
				writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
				return true
			}
			writeError(w, r, err)
			return false
		}
		if _, _, err := h.svc.IngestGitHubPullRequest(r.Context(), conn.WorkspaceID, parsed.Input); err != nil {
			writeError(w, r, err)
			return false
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "linked"})
		return true
	default:
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
		return true
	}
}

func (h *githubHandlers) commits(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := uuid.Parse(r.PathValue("workspaceId"))
	if err != nil {
		writeError(w, r, platform.Validation("workspaceId", "not a workspace id"))
		return
	}
	body, err := readGitHubBody(w, r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.svc.VerifyGitHubCommitWebhook(r.Context(), workspaceID, body, r.Header.Get("X-Hub-Signature-256")); err != nil {
		writeError(w, r, err)
		return
	}

	key := platform.WebhookDeliveryKey("github-commits", workspaceID.String(), body)
	if h.replay.Seen(key, time.Now()) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "duplicate"})
		return
	}
	if h.ingestCommits(w, r, workspaceID, body) {
		h.replay.Record(key, time.Now())
	}
}

// ingestCommits handles a verified, non-duplicate delivery and reports whether it completed.
// False on every error path, so a delivery that failed halfway stays replayable.
func (h *githubHandlers) ingestCommits(
	w http.ResponseWriter, r *http.Request, workspaceID uuid.UUID, body []byte,
) bool {
	event := r.Header.Get("X-GitHub-Event")
	if event == "ping" || event == "" {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "pong"})
		return true
	}
	if event != "push" {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
		return true
	}
	parsed, err := gh.ParsePush(body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not parse the GitHub payload"))
		return false
	}
	if _, _, err := h.svc.IngestGitHubPush(r.Context(), workspaceID, parsed.Input); err != nil {
		writeError(w, r, err)
		return false
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "linked"})
	return true
}

func (h *githubHandlers) oauthStart(w http.ResponseWriter, r *http.Request) {
	p, ok := authz.PrincipalFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized("this request must name a workspace"))
		return
	}
	if !h.cfg.GitHubOAuthConfigured() {
		writeError(w, r, platform.Validation("", "GitHub OAuth is not configured. Set POLARIS_GITHUB_CLIENT_ID and POLARIS_GITHUB_CLIENT_SECRET."))
		return
	}

	nonce, err := randomNonce()
	if err != nil {
		writeError(w, r, platform.Internal(err))
		return
	}
	blob, err := h.signOAuthState(githubOAuthState{
		AccountID:   p.AccountID,
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
		Nonce:       nonce,
		Exp:         time.Now().Add(githubOAuthTTL).Unix(),
	})
	if err != nil {
		writeError(w, r, platform.Internal(err))
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     githubOAuthCookie,
		Value:    blob,
		Path:     "/auth/github",
		MaxAge:   int(githubOAuthTTL.Seconds()),
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]string{
		"url": gh.AuthorizeURL(h.cfg.GitHubClientID, h.oauthRedirectURL(), nonce),
	})
}

func (h *githubHandlers) oauthCallback(w http.ResponseWriter, r *http.Request) {
	settings := strings.TrimRight(h.publicURL, "/") + "/settings/github"
	fail := func() {
		http.Redirect(w, r, settings+"?github=error", http.StatusFound)
	}

	c, err := r.Cookie(githubOAuthCookie)
	if err != nil || c.Value == "" {
		fail()
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: githubOAuthCookie, Value: "", Path: "/auth/github", MaxAge: -1,
		HttpOnly: true, Secure: h.secure, SameSite: http.SameSiteLaxMode,
	})

	state, err := h.parseOAuthState(c.Value)
	if err != nil || time.Now().Unix() > state.Exp {
		fail()
		return
	}
	if r.URL.Query().Get("state") != state.Nonce {
		fail()
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" || !h.cfg.GitHubOAuthConfigured() {
		fail()
		return
	}

	ident, err := gh.ExchangeCode(r.Context(), h.cfg.GitHubClientID, h.cfg.GitHubClientSecret, code, h.oauthRedirectURL())
	if err != nil {
		platform.Log(r.Context()).Error("github oauth exchange failed", "error", err)
		fail()
		return
	}

	p, err := h.svc.ResolvePrincipal(r.Context(), state.AccountID, state.WorkspaceID)
	if err != nil {
		fail()
		return
	}
	userID := ident.UserID
	if _, _, err := h.svc.CreateGitHubUserLink(r.Context(), p, domain.CreateGitHubUserLinkInput{
		GitHubLogin:  ident.Login,
		GitHubUserID: &userID,
	}); err != nil {
		fail()
		return
	}
	http.Redirect(w, r, settings+"?github=connected", http.StatusFound)
}

func (h *githubHandlers) oauthRedirectURL() string {
	return strings.TrimRight(h.publicURL, "/") + "/auth/github/callback"
}

func readGitHubBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, githubMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, platform.Validation("", "could not read the request body")
	}
	return body, nil
}

type githubOAuthState struct {
	AccountID   uuid.UUID `json:"a"`
	WorkspaceID uuid.UUID `json:"w"`
	UserID      uuid.UUID `json:"u"`
	Nonce       string    `json:"n"`
	Exp         int64     `json:"e"`
}

func (h *githubHandlers) signOAuthState(s githubOAuthState) (string, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, h.tokens.secret)
	_, _ = mac.Write(raw)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + hex.EncodeToString(mac.Sum(nil)), nil
}

func (h *githubHandlers) parseOAuthState(blob string) (githubOAuthState, error) {
	payload, sig, ok := strings.Cut(blob, ".")
	if !ok {
		return githubOAuthState{}, platform.Unauthorized("bad github oauth state")
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return githubOAuthState{}, platform.Unauthorized("bad github oauth state")
	}
	mac := hmac.New(sha256.New, h.tokens.secret)
	_, _ = mac.Write(raw)
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(want)) {
		return githubOAuthState{}, platform.Unauthorized("bad github oauth state")
	}
	var s githubOAuthState
	if err := json.Unmarshal(raw, &s); err != nil {
		return githubOAuthState{}, platform.Unauthorized("bad github oauth state")
	}
	return s, nil
}

func randomNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
