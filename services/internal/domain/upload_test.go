package domain_test

import (
	"bytes"
	"image"
	"image/png"
	"io"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/files"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func pngBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestUploadImage_StoresAndOpensByToken(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	store, err := files.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetFileStore(store)
	fx := testutil.NewFixture(t, db)
	p := fx.Principal()
	payload := pngBytes(t)

	view, err := svc.UploadImage(t.Context(), p, bytes.NewReader(payload), "Shot.PNG", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(view.URL, "/files/") || !strings.Contains(view.URL, "token=") {
		t.Fatalf("url = %q", view.URL)
	}
	if view.AbsoluteURL != "https://polaris.example"+view.URL {
		t.Fatalf("absolute = %q", view.AbsoluteURL)
	}
	if view.ContentType != "image/png" || view.Name != "Shot.png" {
		t.Fatalf("meta = %+v", view)
	}

	row, rc, err := svc.OpenUploadedFile(t.Context(), view.ID, strings.Split(view.URL, "token=")[1], nil)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) || row.ByteSize != int64(len(payload)) {
		t.Fatalf("round-trip mismatch: %d vs %d", len(got), len(payload))
	}

	if _, _, err := svc.OpenUploadedFile(t.Context(), view.ID, "wrong", nil); err == nil {
		t.Fatal("bad token must not open the file")
	} else if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("code = %s", platform.CodeOf(err))
	}
}

func TestUploadImage_DedupesByContent(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	store, err := files.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetFileStore(store)
	fx := testutil.NewFixture(t, db)
	p := fx.Principal()
	payload := pngBytes(t)

	first, err := svc.UploadImage(t.Context(), p, bytes.NewReader(payload), "a.png", nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.UploadImage(t.Context(), p, bytes.NewReader(payload), "b.png", nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.URL != second.URL {
		t.Fatalf("expected one row, got %s then %s", first.ID, second.ID)
	}
}

func TestUploadImage_RejectsNonImage(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	store, err := files.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetFileStore(store)
	fx := testutil.NewFixture(t, db)

	_, err = svc.UploadImage(t.Context(), fx.Principal(), strings.NewReader("not an image"), "x.bin", nil)
	if err == nil || platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("err = %v", err)
	}
}

func TestUploadImage_AttachesToIssue(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	store, err := files.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetFileStore(store)
	fx := testutil.NewFixture(t, db)
	p := fx.Principal()
	issue, _, err := svc.CreateIssue(t.Context(), p, domain.CreateIssueInput{
		TeamID: fx.TeamID, Title: "Needs a screenshot",
	})
	if err != nil {
		t.Fatal(err)
	}

	view, err := svc.UploadImage(t.Context(), p, bytes.NewReader(pngBytes(t)), "shot.png", &issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := svc.ListAttachmentsForURL(t.Context(), p, view.AbsoluteURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].IssueID != issue.ID {
		t.Fatalf("attachments = %+v", rows)
	}
}
