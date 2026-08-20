package httpapi

import (
	"io"
	"net/http"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	sentryin "github.com/peixotolabs/polaris/services/internal/integrations/sentry"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

const sentryMaxBody = 25 << 20

type sentryHandlers struct {
	svc *domain.Service
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

	parsed, skip, err := sentryin.Parse(body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not parse the Sentry payload"))
		return
	}
	if skip != "" {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": skip})
		return
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
