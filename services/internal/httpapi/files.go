package httpapi

import (
	"io"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/files"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// fileUploadMaxBody is multipart overhead on top of the 25 MiB image. A few megabytes of
// MIME framing is plenty; the domain LimitReader is the real ceiling.
const fileUploadMaxBody = files.MaxBytes + (1 << 20)

type fileHandlers struct {
	svc *domain.Service
}

// upload accepts multipart field "file" (and optional "issueId") and returns a capability URL.
func (h *fileHandlers) upload(w http.ResponseWriter, r *http.Request) {
	p, ok := authz.PrincipalFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized("this request must name a workspace"))
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, fileUploadMaxBody)
	if err := r.ParseMultipartForm(fileUploadMaxBody); err != nil {
		writeError(w, r, platform.Validation("file", "the upload is too large or was not multipart"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, r, platform.Validation("file", "a file field named file is required"))
		return
	}
	defer file.Close()

	var issueID *uuid.UUID
	if raw := r.FormValue("issueId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			writeError(w, r, platform.Validation("issueId", "not an issue id"))
			return
		}
		issueID = &id
	}

	view, err := h.svc.UploadImage(r.Context(), p, file, header.Filename, issueID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":          view.ID,
		"url":         view.URL,
		"absoluteUrl": view.AbsoluteURL,
		"contentType": view.ContentType,
		"byteSize":    view.ByteSize,
		"name":        view.Name,
	})
}

// download streams a stored image. Token query OR workspace membership authorises it.
func (h *fileHandlers) download(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, r, platform.NotFound("file"))
		return
	}
	token := r.URL.Query().Get("token")
	p, _ := authz.PrincipalFrom(r.Context())

	row, rc, err := h.svc.OpenUploadedFile(r.Context(), id, token, p)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer rc.Close()

	w.Header().Set("Content-Type", row.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(row.ByteSize, 10))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Inline so markdown <img> and a browser tab show the image; attachment disposition
	// would force a download on every paste preview.
	w.Header().Set("Content-Disposition", "inline; filename="+strconv.Quote(row.OriginalName))
	// Capability URLs are unguessable; allow short private caching so a description with
	// the same screenshot twice does not hit the API twice in one paint.
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
}
