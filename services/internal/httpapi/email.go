package httpapi

import (
	"crypto/subtle"
	"io"
	"net/http"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
	inboundemail "github.com/peixotolabs/polaris/services/internal/integrations/email"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

const emailMaxBody = 1 << 20

type emailHandlers struct {
	svc *domain.Service
	cfg platform.Config
}

func (h *emailHandlers) inbound(w http.ResponseWriter, r *http.Request) {
	if !emailWebhookOK(h.cfg, r) {
		writeError(w, r, platform.Unauthorized("bad email webhook secret"))
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, emailMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not read the request body"))
		return
	}
	parsed, err := inboundemail.Parse(body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not parse the email payload"))
		return
	}

	result, err := h.svc.IngestInboundEmail(r.Context(), parsed)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if result.Ignored != "" {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": result.Ignored})
		return
	}
	if result.Issue == nil {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         "created",
		"issueId":    result.Issue.ID,
		"identifier": result.Issue.Identifier,
	})
}

func emailWebhookOK(cfg platform.Config, r *http.Request) bool {
	secret := strings.TrimSpace(cfg.EmailWebhookSecret)
	if secret == "" {
		return cfg.IsDevelopment()
	}
	provided := strings.TrimSpace(r.Header.Get("X-Polaris-Email-Secret"))
	if provided == "" || len(provided) != len(secret) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(secret)) == 1
}
