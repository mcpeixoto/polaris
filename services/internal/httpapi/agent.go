package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/agent"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// The agent's streaming endpoint: text as the model produces it.
//
// Server-sent events rather than the sync socket, and rather than a GraphQL subscription.
// The sync hub carries durable change_log rows — everything on it is a row somebody wrote —
// so streaming tokens through it would mean a database write per token. These deltas are
// not durable and do not need to be: the finished turn is stored as an agent_message and
// reaches every other device through the ordinary delta stream, so a reader who misses the
// stream loses the typing animation and nothing else.
//
// The run happens here, on the request, because this is where somebody is waiting. The
// worker drains anything nobody is watching.

type agentHandlers struct {
	svc    *domain.Service
	runner *agent.Runner
}

// stream is GET /agent/sessions/{id}/stream.
func (h *agentHandlers) stream(w http.ResponseWriter, r *http.Request) {
	p, ok := authz.PrincipalFrom(r.Context())
	if !ok || p == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "authentication required"})
		return
	}
	sessionID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "not a session id"})
		return
	}

	flusher, canFlush := w.(http.Flusher)
	if !canFlush {
		// Without flushing this is a very slow POST. Better to say so than to buffer the
		// whole answer and deliver it as one lump at the end.
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "streaming unavailable"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Nginx buffers proxied responses by default, which turns a token stream into one
	// delivery at the end. The header is how a stream asks it not to.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	send := func(event string, payload any) error {
		body, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := w.Write([]byte("event: " + event + "\ndata: ")); err != nil {
			return err
		}
		if _, err := w.Write(body); err != nil {
			return err
		}
		if _, err := w.Write([]byte("\n\n")); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	if h.runner == nil || !h.runner.Enabled() {
		_ = send("error", map[string]any{"message": "no model provider is configured"})
		return
	}

	session, claimed, err := h.svc.StartAgentRunFor(r.Context(), p, sessionID)
	if err != nil {
		_ = send("error", map[string]any{"message": "that conversation could not be started"})
		return
	}
	if !claimed {
		// Somebody else is already running it, or it is already answered. Not an error —
		// the client falls back to reading the transcript.
		_ = send("idle", map[string]any{"sessionId": sessionID})
		return
	}

	// The client's own disconnect cancels the request context, and the runner treats that
	// as "the reader went away" rather than as a failure.
	runErr := h.runner.Run(r.Context(), session, func(delta string) error {
		return send("delta", map[string]any{"text": delta})
	})
	if runErr != nil {
		_ = send("error", map[string]any{"message": "the run could not be recorded"})
		return
	}
	// The turn is stored by now, so the client refetches rather than being handed a body
	// it would have to merge itself.
	_ = send("done", map[string]any{"sessionId": sessionID})
}
