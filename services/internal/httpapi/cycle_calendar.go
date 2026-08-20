package httpapi

import (
	"net/http"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

type cycleCalendarHandlers struct {
	svc *domain.Service
}

func (h *cycleCalendarHandlers) feed(w http.ResponseWriter, r *http.Request) {
	ics, err := h.svc.GetPublicCycleCalendar(r.Context(), r.PathValue("token"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="`+ics.Filename+`"`)
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ics.Body)
}
