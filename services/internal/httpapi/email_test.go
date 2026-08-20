package httpapi_test

import (
	"context"
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

func emailRouter(t *testing.T, cfg platform.Config) (http.Handler, *testutil.Fixture, *domain.Service) {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	if cfg.JWTSecret == "" {
		cfg.JWTSecret = "test-secret-long-enough-for-hmac"
	}
	if cfg.AccessTokenTTL == 0 {
		cfg.AccessTokenTTL = time.Minute
	}
	if cfg.PublicURL == "" {
		cfg.PublicURL = "https://polaris.example"
	}
	if cfg.Env == "" {
		cfg.Env = "development"
	}
	svc.PublicURL = cfg.PublicURL
	h := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL),
		Config:  cfg,
	})
	return h, f, svc
}

func TestEmailWebhook_DevJSONCreatesAnIssue(t *testing.T) {
	h, f, svc := emailRouter(t, platform.Config{Env: "development"})
	ctx := context.Background()
	p := f.Principal()
	team, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	body := `{"to":"` + *team.EmailIntakeAddress + `","from":"ada@example.com","subject":"Dev stub","text":"No mail server."}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/email", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["ok"] != "created" {
		t.Fatalf("payload = %s", rec.Body.String())
	}
	if got["identifier"] == nil || got["identifier"] == "" {
		t.Fatalf("missing identifier: %s", rec.Body.String())
	}
}

func TestEmailWebhook_RefusesABadSecret(t *testing.T) {
	h, _, _ := emailRouter(t, platform.Config{
		Env:                "production",
		EmailWebhookSecret: "s3cret",
	})
	req := httptest.NewRequest(http.MethodPost, "/webhooks/email", strings.NewReader(`{"to":"x@y"}`))
	req.Header.Set("X-Polaris-Email-Secret", "nope")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestEmailWebhook_ProductionRequiresASecret(t *testing.T) {
	h, _, _ := emailRouter(t, platform.Config{Env: "production"})
	req := httptest.NewRequest(http.MethodPost, "/webhooks/email", strings.NewReader(`{"to":"x@y"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("empty secret in production must refuse, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestEmailWebhook_AcceptsTheSecretHeader(t *testing.T) {
	h, f, svc := emailRouter(t, platform.Config{
		Env:                "production",
		EmailWebhookSecret: "s3cret",
	})
	team, _, err := svc.UpdateTeamEmailIntake(context.Background(), f.Principal(), domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	body := `{"to":"` + *team.EmailIntakeAddress + `","subject":"From the provider","text":"hi"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/email", strings.NewReader(body))
	req.Header.Set("X-Polaris-Email-Secret", "s3cret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}
