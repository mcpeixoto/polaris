package httpapi

import (
	"net/http"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

type askHandlers struct {
	svc *domain.Service
}

func (h *askHandlers) get(w http.ResponseWriter, r *http.Request) {
	pub, err := h.svc.GetPublicAskForm(r.Context(), r.PathValue("token"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"name":        pub.Name,
		"description": pub.Description,
		"teamName":    pub.TeamName,
	})
}

func (h *askHandlers) submit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title          string `json:"title"`
		Description    string `json:"description"`
		RequesterName  string `json:"requesterName"`
		RequesterEmail string `json:"requesterEmail"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, r, err)
		return
	}
	err := h.svc.SubmitAsk(r.Context(), domain.SubmitAskInput{
		Token:          r.PathValue("token"),
		Title:          body.Title,
		Description:    body.Description,
		RequesterName:  body.RequesterName,
		RequesterEmail: body.RequesterEmail,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	// No identifier: confirming the issue number would leak the team's numbering.
	writeJSON(w, http.StatusOK, map[string]string{"ok": "created"})
}
