package httpapi_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
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

// The timestamp window was never replay protection, and this is the proof.
//
// VerifySentryWebhook rejects a Sentry-Hook-Timestamp more than a minute old, which reads
// like a defence and is not one: Sentry's HMAC covers the raw body and nothing else, so the
// timestamp is a header the caller writes for themselves. A replayer posts the captured body
// — whose signature is still perfectly valid, because the bytes have not changed — beside a
// timestamp generated a second ago, and the window is satisfied every time.
//
// So the delivery has to be recognised by the part the signature actually pins: the body.
func TestSentryEvents_AFreshTimestampDoesNotRescueAReplay(t *testing.T) {
	h, f, svc := sentryRouter(t)
	ctx := context.Background()
	p := f.Principal()
	_, secret, _, err := svc.CreateSentryConnection(ctx, p, domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := `{
		"action": "created",
		"data": {"issue": {
			"title": "Error: boom",
			"shortId": "WEB-9",
			"web_url": "https://sentry.io/organizations/acme/issues/99/",
			"project": {"name": "Web"}
		}}
	}`
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(body))
	signature := hex.EncodeToString(mac.Sum(nil))

	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/webhooks/sentry/"+f.WorkspaceID.String(), strings.NewReader(body))
		req.Header.Set("Sentry-Hook-Signature", signature)
		// Minted now, exactly as a replayer would. The signature is the captured one and is
		// unchanged, because the body it covers is unchanged.
		req.Header.Set("Sentry-Hook-Timestamp", strconv.FormatInt(time.Now().Unix(), 10))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	first := post()
	if first.Code != http.StatusOK {
		t.Fatalf("first delivery: status %d body %s", first.Code, first.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &created); err != nil {
		t.Fatalf("json: %v", err)
	}
	if created["ok"] != "created" {
		t.Fatalf("the real delivery must be handled: %v", created)
	}

	replay := post()
	if replay.Code != http.StatusOK {
		t.Fatalf("replay: status %d body %s", replay.Code, replay.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(replay.Body.Bytes(), &out); err != nil {
		t.Fatalf("json: %v", err)
	}
	if out["reason"] != "duplicate" {
		t.Errorf("a captured body with a freshly minted timestamp was handled a second time: %v", out)
	}
}

// A delivery that failed must stay replayable.
//
// The guard records on success and never on arrival, so the request that 500s — a database
// blip, a restart mid-ingest — is not remembered as done. Recording on arrival would turn a
// transient error into a permanently dropped issue, and would also break the one deliberate
// re-send that matters: GitHub's "Redeliver" button, pressed by somebody who watched the
// first attempt fail.
func TestSentryEvents_AFailedDeliveryStaysReplayable(t *testing.T) {
	h, f, svc := sentryRouter(t)
	ctx := context.Background()
	p := f.Principal()
	_, secret, _, err := svc.CreateSentryConnection(ctx, p, domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// A body the parser cannot read: verification passes, ingest does not.
	broken := `{"action":"created","data":{"issue":`
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(broken))
	req := httptest.NewRequest(http.MethodPost, "/webhooks/sentry/"+f.WorkspaceID.String(), strings.NewReader(broken))
	req.Header.Set("Sentry-Hook-Signature", hex.EncodeToString(mac.Sum(nil)))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("a malformed payload must not be accepted: %s", rec.Body.String())
	}

	// The same bytes again. It must reach the handler rather than be dismissed as a replay
	// of something that never happened.
	req = httptest.NewRequest(http.MethodPost, "/webhooks/sentry/"+f.WorkspaceID.String(), strings.NewReader(broken))
	req.Header.Set("Sentry-Hook-Signature", hex.EncodeToString(mac.Sum(nil)))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected the same refusal, got %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "duplicate") {
		t.Error("a delivery that failed was remembered as handled; its retry must not be refused")
	}
}
