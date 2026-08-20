package httpapi_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func sentryRouter(t *testing.T) (http.Handler, *testutil.Fixture, *domain.Service) {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	cfg := platform.Config{
		JWTSecret:      "test-secret-long-enough-for-hmac",
		AccessTokenTTL: time.Minute,
		PublicURL:      "https://polaris.example",
	}
	h := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL),
		Config:  cfg,
	})
	return h, f, svc
}

func TestSentryEvents_RefuseABadSignature(t *testing.T) {
	h, f, svc := sentryRouter(t)
	ctx := context.Background()
	if _, _, _, err := svc.CreateSentryConnection(ctx, f.Principal(), domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := `{"action":"created","data":{"issue":{"title":"boom","web_url":"https://sentry.io/issues/1/"}}}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/sentry/"+f.WorkspaceID.String(), strings.NewReader(body))
	req.Header.Set("Sentry-Hook-Signature", "deadbeef")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestSentryEvents_CreatesAnIssue(t *testing.T) {
	h, f, svc := sentryRouter(t)
	ctx := context.Background()
	p := f.Principal()
	_, secret, _, err := svc.CreateSentryConnection(ctx, p, domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := `{
		"action": "created",
		"data": {
			"issue": {
				"title": "Error: boom",
				"shortId": "WEB-1",
				"web_url": "https://sentry.io/organizations/acme/issues/42/",
				"culprit": "app.views",
				"project": {"name": "Web"}
			}
		}
	}`
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(body))
	req := httptest.NewRequest(http.MethodPost, "/webhooks/sentry/"+f.WorkspaceID.String(), strings.NewReader(body))
	req.Header.Set("Sentry-Hook-Signature", hex.EncodeToString(mac.Sum(nil)))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("json: %v", err)
	}
	if out["ok"] != "created" {
		t.Fatalf("ok: %v", out["ok"])
	}

	listed, err := svc.ListAttachmentsForURL(ctx, p, "https://sentry.io/organizations/acme/issues/42/")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("want one Sentry card, got %d", len(listed))
	}
}

func TestSentryEvents_TokenHeaderAlsoWorks(t *testing.T) {
	h, f, svc := sentryRouter(t)
	ctx := context.Background()
	p := f.Principal()
	_, secret, _, err := svc.CreateSentryConnection(ctx, p, domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := `{
		"project_name": "Web",
		"message": "ZeroDivisionError",
		"url": "https://sentry.io/organizations/acme/issues/7/"
	}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/sentry/"+f.WorkspaceID.String(), strings.NewReader(body))
	req.Header.Set("X-Sentry-Token", secret)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}
