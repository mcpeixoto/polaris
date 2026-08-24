package httpapi

import (
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	sentryin "github.com/peixotolabs/polaris/services/internal/integrations/sentry"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

const sentryMaxBody = 25 << 20

type sentryHandlers struct {
	svc    *domain.Service
	replay *platform.ReplayGuard
}

func (h *sentryHandlers) events(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := uuid.Parse(r.PathValue("workspaceId"))
	if err != nil {
		writeError(w, r, platform.Validation("workspaceId", "not a workspace id"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, sentryMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not read the request body"))
		return
	}
	if err := h.svc.VerifySentryWebhook(
		r.Context(),
		workspaceID,
		body,
		r.Header.Get("Sentry-Hook-Signature"),
		r.Header.Get("X-Sentry-Token"),
		r.Header.Get("Sentry-Hook-Timestamp"),
	); err != nil {
		writeError(w, r, err)
		return
	}

	// Verification proved who sent these bytes, not that they are new. The signature covers
	// the body and nothing else — Sentry-Hook-Timestamp is outside the MAC, so the window
	// VerifySentryWebhook enforces on it is a check on a value the replayer supplies — and a
	// captured delivery therefore verifies for as long as the secret lives.
	key := platform.WebhookDeliveryKey("sentry", workspaceID.String(), body)
	if h.replay.Seen(key, time.Now()) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "duplicate"})
		return
	}
	if h.ingest(w, r, workspaceID, body) {
		h.replay.Record(key, time.Now())
	}
}

// ingest handles a verified, non-duplicate delivery and reports whether it completed.
//
// The return value is what the caller records, and it is false on every error path on
// purpose: a delivery that failed halfway must stay replayable, or a database blip becomes a
// dropped Sentry issue that no retry can recover.
func (h *sentryHandlers) ingest(
	w http.ResponseWriter, r *http.Request, workspaceID uuid.UUID, body []byte,
) bool {
	parsed, skip, err := sentryin.Parse(body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not parse the Sentry payload"))
		return false
	}
	if skip != "" {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": skip})
		return true
	}

	result, err := h.svc.IngestSentryIssue(r.Context(), workspaceID, domain.IngestSentryIssueInput{
		URL:         parsed.URL,
		Title:       parsed.Title,
		Culprit:     parsed.Culprit,
		Project:     parsed.Project,
		Level:       parsed.Level,
		ShortID:     parsed.ShortID,
		Environment: parsed.Environment,
	})
	if err != nil {
		writeError(w, r, err)
		return false
	}
	if result.Ignored != "" {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": result.Ignored})
		return true
	}
	if result.Issue == nil {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
		return true
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         "created",
		"issueId":    result.Issue.ID,
		"identifier": result.Issue.Identifier,
	})
	return true
}
