package httpapi

import (
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	gl "github.com/peixotolabs/polaris/services/internal/integrations/gitlab"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

const gitlabMaxBody = 25 << 20

type gitlabHandlers struct {
	svc    *domain.Service
	replay *platform.ReplayGuard
}

func (h *gitlabHandlers) events(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := uuid.Parse(r.PathValue("workspaceId"))
	if err != nil {
		writeError(w, r, platform.Validation("workspaceId", "not a workspace id"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, gitlabMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not read the request body"))
		return
	}
	if err := h.svc.VerifyGitLabWebhook(r.Context(), workspaceID, r.Header.Get("X-Gitlab-Token")); err != nil {
		writeError(w, r, err)
		return
	}

	// GitLab authenticates with a shared token and signs nothing, so a captured delivery can
	// be posted again indefinitely. Deduplication is the weakest of the three cases here —
	// whoever captured the request also captured the token in its header, and can forge
	// fresh bodies rather than replay old ones — so this is idempotency first and replay
	// protection only against somebody who has the bytes but not the header.
	key := platform.WebhookDeliveryKey("gitlab", workspaceID.String(), body)
	if h.replay.Seen(key, time.Now()) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "duplicate"})
		return
	}
	if h.ingest(w, r, workspaceID, body) {
		h.replay.Record(key, time.Now())
	}
}

// ingest handles a verified, non-duplicate delivery and reports whether it completed.
// False on every error path, so a delivery that failed halfway stays replayable.
func (h *gitlabHandlers) ingest(
	w http.ResponseWriter, r *http.Request, workspaceID uuid.UUID, body []byte,
) bool {
	event := r.Header.Get("X-Gitlab-Event")
	switch event {
	case "Merge Request Hook":
		parsed, err := gl.ParseMergeRequest(body)
		if err != nil {
			writeError(w, r, platform.Validation("", "could not parse the GitLab payload"))
			return false
		}
		if _, _, err := h.svc.IngestGitLabMergeRequest(r.Context(), workspaceID, parsed.Input); err != nil {
			writeError(w, r, err)
			return false
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "linked"})
		return true
	case "Push Hook":
		parsed, err := gl.ParsePush(body)
		if err != nil {
			writeError(w, r, platform.Validation("", "could not parse the GitLab payload"))
			return false
		}
		if _, _, err := h.svc.IngestGitLabPush(r.Context(), workspaceID, parsed.Input); err != nil {
			writeError(w, r, err)
			return false
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "linked"})
		return true
	case "Pipeline Hook":
		in, ok, err := gl.ParsePipelineReady(body)
		if err != nil {
			writeError(w, r, platform.Validation("", "could not parse the GitLab payload"))
			return false
		}
		if !ok {
			writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
			return true
		}
		if _, _, err := h.svc.IngestGitLabMergeRequest(r.Context(), workspaceID, in); err != nil {
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
