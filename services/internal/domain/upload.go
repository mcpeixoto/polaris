package domain

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/files"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Allowed image types for paste/drop. Detected from content, not the client-supplied
// Content-Type — a renamed .exe claiming image/png must not land in the store.
var allowedUploadTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// UploadedFileView is what the HTTP layer returns after a successful upload.
type UploadedFileView struct {
	ID          uuid.UUID
	URL         string // relative, for markdown: /files/{id}?token=…
	AbsoluteURL string // http(s), for attachment link cards
	ContentType string
	ByteSize    int64
	Name        string
}

// UploadImage stores an image for the caller's workspace and returns a capability URL.
//
// When issueID is set, a link-card attachment is also created pointing at the absolute URL,
// so the file shows in the Links panel the same way a pasted GitHub URL does.
func (s *Service) UploadImage(
	ctx context.Context,
	p *authz.Principal,
	r io.Reader,
	originalName string,
	issueID *uuid.UUID,
) (UploadedFileView, error) {
	if s.files == nil {
		return UploadedFileView{}, platform.Validation("file", "file uploads are not configured on this server")
	}

	limited := io.LimitReader(r, files.MaxBytes+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		return UploadedFileView{}, platform.Internal(err)
	}
	if int64(len(payload)) > files.MaxBytes {
		return UploadedFileView{}, platform.Validation("file", "images must be 25 MB or smaller")
	}
	if len(payload) == 0 {
		return UploadedFileView{}, platform.Validation("file", "the file is empty")
	}

	detected := http.DetectContentType(payload)
	// DetectContentType returns image/jpeg for JFIF; some builds add a charset for nothing
	// we care about — strip parameters.
	if i := strings.IndexByte(detected, ';'); i >= 0 {
		detected = strings.TrimSpace(detected[:i])
	}
	ext, ok := allowedUploadTypes[detected]
	if !ok {
		return UploadedFileView{}, platform.Validation("file", "only PNG, JPEG, GIF and WebP images can be uploaded")
	}

	sum := sha256.Sum256(payload)
	name := sanitizeUploadName(originalName, ext)

	q := s.db.Queries()
	existing, err := q.GetUploadedFileBySHA(ctx, store.GetUploadedFileBySHAParams{
		WorkspaceID: p.WorkspaceID,
		Sha256:      sum[:],
	})
	if err == nil {
		view := s.fileView(existing)
		if issueID != nil {
			if _, _, err := s.CreateAttachment(ctx, p, CreateAttachmentInput{
				IssueID: *issueID,
				URL:     view.AbsoluteURL,
				Title:   name,
			}); err != nil {
				return UploadedFileView{}, err
			}
		}
		return view, nil
	}
	if !store.IsNotFound(err) {
		return UploadedFileView{}, platform.Internal(err)
	}

	id, err := uuid.NewV7()
	if err != nil {
		return UploadedFileView{}, platform.Internal(err)
	}
	token, err := randomTokenHex(32)
	if err != nil {
		return UploadedFileView{}, platform.Internal(err)
	}
	key := storageKey(p.WorkspaceID, sum[:])
	if err := s.files.Put(ctx, key, bytes.NewReader(payload), int64(len(payload)), detected); err != nil {
		return UploadedFileView{}, platform.Internal(fmt.Errorf("store upload: %w", err))
	}

	creator := p.UserID
	row, err := q.CreateUploadedFile(ctx, store.CreateUploadedFileParams{
		ID:            id,
		WorkspaceID:   p.WorkspaceID,
		CreatorID:     &creator,
		StorageKey:    key,
		ContentType:   detected,
		ByteSize:      int64(len(payload)),
		OriginalName:  name,
		Sha256:        sum[:],
		DownloadToken: token,
	})
	if err != nil {
		_ = s.files.Delete(ctx, key)
		return UploadedFileView{}, platform.Internal(err)
	}

	view := s.fileView(row)
	if issueID != nil {
		if _, _, err := s.CreateAttachment(ctx, p, CreateAttachmentInput{
			IssueID: *issueID,
			URL:     view.AbsoluteURL,
			Title:   name,
		}); err != nil {
			return UploadedFileView{}, err
		}
	}
	return view, nil
}

// OpenUploadedFile returns a reader for a file the caller may see.
//
// Auth is either a matching download token (img tags, new tab) or a workspace principal
// whose workspace owns the row. The token is the capability stored in markdown; a member
// with a session does not need it.
func (s *Service) OpenUploadedFile(
	ctx context.Context,
	id uuid.UUID,
	token string,
	p *authz.Principal,
) (store.UploadedFile, io.ReadCloser, error) {
	if s.files == nil {
		return store.UploadedFile{}, nil, platform.NotFound("file")
	}
	row, err := s.db.Queries().GetUploadedFile(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.UploadedFile{}, nil, platform.NotFound("file")
		}
		return store.UploadedFile{}, nil, platform.Internal(err)
	}

	tokenOK := token != "" && subtleConstantTimeEqual(token, row.DownloadToken)
	memberOK := p != nil && p.WorkspaceID == row.WorkspaceID
	if !tokenOK && !memberOK {
		// Same answer as a missing row: existence of a private file must not be probeable.
		return store.UploadedFile{}, nil, platform.NotFound("file")
	}

	rc, err := s.files.Open(ctx, row.StorageKey)
	if err != nil {
		return store.UploadedFile{}, nil, platform.NotFound("file")
	}
	return row, rc, nil
}

func (s *Service) fileView(row store.UploadedFile) UploadedFileView {
	rel := fmt.Sprintf("/files/%s?token=%s", row.ID, row.DownloadToken)
	abs := rel
	if base := strings.TrimRight(strings.TrimSpace(s.PublicURL), "/"); base != "" {
		abs = base + rel
	}
	return UploadedFileView{
		ID:          row.ID,
		URL:         rel,
		AbsoluteURL: abs,
		ContentType: row.ContentType,
		ByteSize:    row.ByteSize,
		Name:        row.OriginalName,
	}
}

func storageKey(workspaceID uuid.UUID, sha []byte) string {
	hexSum := hex.EncodeToString(sha)
	return path.Join(workspaceID.String(), hexSum[:2], hexSum)
}

func sanitizeUploadName(raw, ext string) string {
	base := path.Base(strings.TrimSpace(raw))
	base = strings.ReplaceAll(base, "\x00", "")
	if base == "." || base == ".." || base == "/" || base == "" {
		return "image" + ext
	}
	// Strip a client extension and put back the sniffed one, so a .png that is actually
	// a JPEG does not keep a lying name.
	if i := strings.LastIndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	base = strings.TrimSpace(base)
	if base == "" || !utf8.ValidString(base) {
		base = "image"
	}
	if utf8.RuneCountInString(base) > 200 {
		runes := []rune(base)
		base = string(runes[:200])
	}
	return base + ext
}

func randomTokenHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func subtleConstantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
