package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The external runner API. An installed app polls for issues delegated to it, talks
// on them, and reports when it is done. The built-in agent does not use this: the
// worker claims that queue itself.

type runnerHandlers struct {
	svc *domain.Service
}

func (h *runnerHandlers) claim(w http.ResponseWriter, r *http.Request) {
	p, ok := runnerApp(w, r)
	if !ok {
		return
	}
	var body struct {
		Version string `json:"version"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, r, err)
		return
	}
	claim, err := h.svc.StartRunnerClaim(r.Context(), p, body.Version)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if claim == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, claim)
}

func (h *runnerHandlers) heartbeat(w http.ResponseWriter, r *http.Request) {
	p, ok := runnerApp(w, r)
	if !ok {
		return
	}
	id, ok := runnerRunID(w, r)
	if !ok {
		return
	}
	if err := h.svc.MarkRunnerHeartbeat(r.Context(), p, id); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *runnerHandlers) events(w http.ResponseWriter, r *http.Request) {
	p, ok := runnerApp(w, r)
	if !ok {
		return
	}
	id, ok := runnerRunID(w, r)
	if !ok {
		return
	}
	var body struct {
		Kind string `json:"kind"`
		Body string `json:"body"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, r, err)
		return
	}
	if body.Kind != "comment" {
		// COPY: the runner can only post a comment
		writeError(w, r, platform.Validation("kind", "the runner can only post a comment"))
		return
	}
	if err := h.svc.CreateRunnerComment(r.Context(), p, id, body.Body); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *runnerHandlers) finish(w http.ResponseWriter, r *http.Request) {
	p, ok := runnerApp(w, r)
	if !ok {
		return
	}
	id, ok := runnerRunID(w, r)
	if !ok {
		return
	}
	var body struct {
		Status       string `json:"status"`
		Summary      string `json:"summary"`
		Error        string `json:"error"`
		SessionRef   string `json:"sessionRef"`
		InputTokens  int64  `json:"inputTokens"`
		OutputTokens int64  `json:"outputTokens"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, r, err)
		return
	}
	err := h.svc.MarkRunnerFinished(r.Context(), p, id, domain.FinishRunnerInput{
		Status:       body.Status,
		Summary:      body.Summary,
		Error:        body.Error,
		SessionRef:   body.SessionRef,
		InputTokens:  body.InputTokens,
		OutputTokens: body.OutputTokens,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func runnerRunID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		// COPY: not a run id
		writeError(w, r, platform.Validation("id", "not a run id"))
		return uuid.Nil, false
	}
	return id, true
}

// runnerApp is the installed app this request authenticated as.
//
// Checked before the body is read so a person's token is refused the same way on every
// route, including one whose body would not have parsed.
func runnerApp(w http.ResponseWriter, r *http.Request) (*authz.Principal, bool) {
	p, _ := authz.PrincipalFrom(r.Context())
	if p == nil || p.ActorType != authz.ActorAppUser {
		// COPY: only an installed app can run delegated work
		writeError(w, r, platform.Forbidden("only an installed app can run delegated work"))
		return nil, false
	}
	return p, true
}
