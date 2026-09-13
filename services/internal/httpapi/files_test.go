package httpapi_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/files"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

type filesHarness struct {
	router  http.Handler
	fixture *testutil.Fixture
	token   string
}

func newFilesHarness(t *testing.T) filesHarness {
	t.Helper()
	db := testutil.NewDB(t)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	store, err := files.NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetFileStore(store)
	fx := testutil.NewFixture(t, db)

	secret := "test-secret-at-least-32-bytes-long!!"
	tokens := httpapi.NewTokens(secret, 15*time.Minute)
	tok, err := tokens.Issue(auth.Claims{AccountID: fx.AccountID})
	if err != nil {
		t.Fatal(err)
	}
	router := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  tokens,
		Config: platform.Config{
			Env:       "test",
			PublicURL: "https://polaris.example",
			JWTSecret: secret,
		},
		Limits: httpapi.NewLimits(platform.Config{RateLimitEnabled: false}),
	})
	return filesHarness{router: router, fixture: fx, token: tok}
}

func pngUploadBody(t *testing.T, filename string) (*bytes.Buffer, string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatal(err)
	}

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(pngBuf.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return &body, w.FormDataContentType()
}

func TestFiles_UploadAndDownloadByToken(t *testing.T) {
	h := newFilesHarness(t)
	body, contentType := pngUploadBody(t, "shot.png")

	req := httptest.NewRequest(http.MethodPost, "/files/upload", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+h.token)
	req.Header.Set(httpapi.WorkspaceHeader, h.fixture.WorkspaceID.String())
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload status %d %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		URL         string `json:"url"`
		AbsoluteURL string `json:"absoluteUrl"`
		ContentType string `json:"contentType"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ContentType != "image/png" || resp.URL == "" {
		t.Fatalf("resp = %+v", resp)
	}

	get := httptest.NewRequest(http.MethodGet, resp.URL, nil)
	getRec := httptest.NewRecorder()
	h.router.ServeHTTP(getRec, get)
	if getRec.Code != http.StatusOK {
		t.Fatalf("download status %d %s", getRec.Code, getRec.Body.String())
	}
	if getRec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content-type = %q", getRec.Header().Get("Content-Type"))
	}
	if getRec.Body.Len() == 0 {
		t.Fatal("empty body")
	}

	bad := httptest.NewRequest(http.MethodGet, stripToken(resp.URL)+"?token=0000000000000000000000000000000000000000000000000000000000000000", nil)
	badRec := httptest.NewRecorder()
	h.router.ServeHTTP(badRec, bad)
	if badRec.Code != http.StatusNotFound {
		t.Fatalf("bad token status %d", badRec.Code)
	}
}

func stripToken(u string) string {
	if i := bytes.IndexByte([]byte(u), '?'); i >= 0 {
		return u[:i]
	}
	return u
}

func TestFiles_UploadRequiresAuth(t *testing.T) {
	h := newFilesHarness(t)
	body, contentType := pngUploadBody(t, "shot.png")
	req := httptest.NewRequest(http.MethodPost, "/files/upload", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
	_, _ = io.Copy(io.Discard, rec.Body)
}
