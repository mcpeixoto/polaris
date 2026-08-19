package httpapi_test

import (
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

func TestDevSession_MintsACookieForTheSeedAccount(t *testing.T) {
	h := newDevSessionHarness(t, "development", "1")

	_, _, err := h.svc.Register(t.Context(), domain.RegisterInput{
		Email:    "dev@polaris.local",
		Password: "polaris-dev-password",
	})
	if err != nil {
		t.Fatalf("setup: seed account: %v", err)
	}

	rec := h.devSession(loopbackDevRequest())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	if cookie := polarisRefresh(rec); cookie == nil || cookie.Value == "" {
		t.Fatal("expected an HttpOnly refresh cookie, got none")
	} else if !cookie.HttpOnly {
		t.Error("the refresh cookie must stay HttpOnly")
	}

	var body struct {
		AccountID   string `json:"accountId"`
		AccessToken string `json:"accessToken"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.AccessToken == "" || body.AccountID == "" {
		t.Fatalf("incomplete auth response: %+v", body)
	}
}

func TestDevSession_FallsBackToTheFirstWorkspaceOwner(t *testing.T) {
	h := newDevSessionHarness(t, "development", "1")
	fx := testutil.NewFixture(t, h.svc.DB())

	rec := h.devSession(loopbackDevRequest())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		AccountID string `json:"accountId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.AccountID != fx.AccountID.String() {
		t.Fatalf("account %s, want the fixture owner %s", body.AccountID, fx.AccountID)
	}
}

func TestDevSession_CreatesTheSeedAccountOnAnEmptyInstall(t *testing.T) {
	h := newDevSessionHarness(t, "development", "1")

	rec := h.devSession(loopbackDevRequest())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}

	// The account it created is a real one: the ordinary password form still works,
	// which is how we know the hash is Argon2id and not a shortcut.
	login := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(
		`{"email":"dev@polaris.local","password":"polaris-dev-password"}`))
	login.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	h.handler.ServeHTTP(loginRec, login)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("password login after auto-create: %d %s", loginRec.Code, loginRec.Body.String())
	}

	stranger := httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(
		`{"email":"stranger@example.com","password":"another-long-passphrase"}`))
	stranger.Header.Set("Content-Type", "application/json")
	strangerRec := httptest.NewRecorder()
	h.handler.ServeHTTP(strangerRec, stranger)
	if strangerRec.Code != http.StatusForbidden {
		t.Fatalf("creating the seed account opened signup: %d %s", strangerRec.Code, strangerRec.Body.String())
	}
}

func TestDevSession_RefusesARealHostname(t *testing.T) {
	h := newDevSessionHarness(t, "development", "1")
	req := loopbackDevRequest()
	req.Host = "polaris.example.com"
	rec := h.devSession(req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d %s, want 404", rec.Code, rec.Body.String())
	}
}

func TestDevSession_RefusesANonLoopbackPeer(t *testing.T) {
	h := newDevSessionHarness(t, "development", "1")
	req := loopbackDevRequest()
	req.RemoteAddr = "192.0.2.1:1234"
	rec := h.devSession(req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d %s, want 404", rec.Code, rec.Body.String())
	}
}

func TestDevSession_AbsentInProductionEvenWhenTheFlagIsOn(t *testing.T) {
	h := newDevSessionHarness(t, "production", "1")
	rec := h.devSession(loopbackDevRequest())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d %s, want the route gone in production", rec.Code, rec.Body.String())
	}
}

func TestDevSession_OnByDefaultInDevelopment(t *testing.T) {
	h := newDevSessionHarness(t, "development", "")
	testutil.NewFixture(t, h.svc.DB())
	rec := h.devSession(loopbackDevRequest())
	if rec.Code != http.StatusOK {
		t.Fatalf("empty flag in development should mint a session: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDevSession_OffWhenTheFlagIsOff(t *testing.T) {
	h := newDevSessionHarness(t, "development", "0")
	rec := h.devSession(loopbackDevRequest())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d %s, want the route gone when the flag is off", rec.Code, rec.Body.String())
	}
}

func TestDevSession_OffByDefaultOutsideDevelopment(t *testing.T) {
	h := newDevSessionHarness(t, "staging", "")
	rec := h.devSession(loopbackDevRequest())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("empty flag outside development should leave the route gone: %d %s", rec.Code, rec.Body.String())
	}
}

type devSessionHarness struct {
	svc     *domain.Service
	handler http.Handler
}

func newDevSessionHarness(t *testing.T, env, flag string) *devSessionHarness {
	t.Helper()
	svc := domain.NewService(testutil.NewDB(t))
	cfg := platform.Config{
		Env:              env,
		JWTSecret:        "test-secret-long-enough-for-these-tests",
		RegistrationMode: platform.RegistrationInvite,
		AccessTokenTTL:   time.Minute,
		DevAutoLogin:     flag,
		RateLimitEnabled: false,
	}
	return &devSessionHarness{
		svc: svc,
		handler: httpapi.NewRouter(httpapi.Deps{
			Service: svc,
			Tokens:  httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL),
			Config:  cfg,
			Limits:  httpapi.NewLimits(cfg),
		}),
	}
}

func (h *devSessionHarness) devSession(req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func loopbackDevRequest() *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/auth/dev-session", nil)
	req.Host = "localhost:5173"
	req.RemoteAddr = "127.0.0.1:54321"
	return req
}

func polarisRefresh(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == "polaris_refresh" {
			return c
		}
	}
	return nil
}
