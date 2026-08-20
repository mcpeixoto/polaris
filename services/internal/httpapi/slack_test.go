package httpapi_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

const slackTestSecret = "slack_signing_secret_for_tests"

func slackRouter(t *testing.T) (http.Handler, *testutil.Fixture, *domain.Service) {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	cfg := platform.Config{
		JWTSecret:          "test-secret-long-enough-for-hmac",
		AccessTokenTTL:     time.Minute,
		PublicURL:          "https://polaris.example",
		SlackSigningSecret: slackTestSecret,
	}
	h := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL),
		Config:  cfg,
	})
	return h, f, svc
}

func slackSigned(t *testing.T, body string) (string, string) {
	t.Helper()
	ts := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(slackTestSecret))
	_, _ = fmt.Fprintf(mac, "v0:%s:", ts)
	_, _ = mac.Write([]byte(body))
	return ts, "v0=" + hex.EncodeToString(mac.Sum(nil))
}

func TestSlackCommand_RefuseABadSignature(t *testing.T) {
	h, f, svc := slackRouter(t)
	ctx := context.Background()
	if _, _, err := svc.CreateSlackConnection(ctx, f.Principal(), domain.CreateSlackConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := "command=/polaris&text=create+boom"
	req := httptest.NewRequest(http.MethodPost, "/webhooks/slack/"+f.WorkspaceID.String()+"/command", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-Slack-Request-Timestamp", fmt.Sprintf("%d", time.Now().Unix()))
	req.Header.Set("X-Slack-Signature", "v0=deadbeef")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestSlackCommand_CreatesAnIssue(t *testing.T) {
	h, f, svc := slackRouter(t)
	ctx := context.Background()
	if _, _, err := svc.CreateSlackConnection(ctx, f.Principal(), domain.CreateSlackConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	form := url.Values{
		"command": {"/polaris"},
		"text":    {"create Login is broken"},
		"user_name": {"ada"},
		"channel_name": {"eng"},
	}
	body := form.Encode()
	ts, sig := slackSigned(t, body)
	req := httptest.NewRequest(http.MethodPost, "/webhooks/slack/"+f.WorkspaceID.String()+"/command", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-Slack-Request-Timestamp", ts)
	req.Header.Set("X-Slack-Signature", sig)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("json: %v", err)
	}
	if !strings.Contains(out["text"], "created") {
		t.Fatalf("reply: %v", out)
	}
}

func TestSlackEvents_URLVerification(t *testing.T) {
	h, f, _ := slackRouter(t)
	body := `{"type":"url_verification","challenge":"abc"}`
	ts, sig := slackSigned(t, body)
	req := httptest.NewRequest(http.MethodPost, "/webhooks/slack/"+f.WorkspaceID.String()+"/events", strings.NewReader(body))
	req.Header.Set("X-Slack-Request-Timestamp", ts)
	req.Header.Set("X-Slack-Signature", sig)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "abc") {
		t.Fatalf("body %s", rec.Body.String())
	}
}
