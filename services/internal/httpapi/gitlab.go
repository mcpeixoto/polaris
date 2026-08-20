package httpapi

import (
	"io"
	"net/http"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	gl "github.com/peixotolabs/polaris/services/internal/integrations/gitlab"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

const gitlabMaxBody = 25 << 20

type gitlabHandlers struct {
	svc *domain.Service
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

	event := r.Header.Get("X-Gitlab-Event")
	switch event {
	case "Merge Request Hook":
		parsed, err := gl.ParseMergeRequest(body)
		if err != nil {
			writeError(w, r, platform.Validation("", "could not parse the GitLab payload"))
			return
		}
		if _, _, err := h.svc.IngestGitLabMergeRequest(r.Context(), workspaceID, parsed.Input); err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "linked"})
		return
	case "Push Hook":
		parsed, err := gl.ParsePush(body)
		if err != nil {
			writeError(w, r, platform.Validation("", "could not parse the GitLab payload"))
			return
		}
		if _, _, err := h.svc.IngestGitLabPush(r.Context(), workspaceID, parsed.Input); err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "linked"})
		return
	case "Pipeline Hook":
		in, ok, err := gl.ParsePipelineReady(body)
		if err != nil {
			writeError(w, r, platform.Validation("", "could not parse the GitLab payload"))
			return
		}
		if !ok {
			writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
			return
		}
		if _, _, err := h.svc.IngestGitLabMergeRequest(r.Context(), workspaceID, in); err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "linked"})
		return
	default:
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored"})
	}
}
