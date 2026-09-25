package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// A refresh used to revoke the presented token and mint a new one. The replacement
// cookie is the one an iPhone drops when a home-screen app reloads for an update, and
// the one the desktop app — a different site from its server — often never stores. The
// device kept the old cookie, the server had already killed it, and the next launch was
// a login screen.

func TestRefreshKeepsTheCookieAndExtendsIt(t *testing.T) {
	h := newRegisterHarness(t, platform.RegistrationInvite)
	signed := h.register(registerBody{Email: "ada@example.com", Password: "a-long-enough-passphrase"})
	if signed.status != http.StatusOK {
		t.Fatalf("register: %d %s", signed.status, signed.body)
	}
	cookie := sessionCookie(t, signed.Header)
	if cookie.MaxAge < 399*24*60*60 {
		t.Fatalf("login cookie expires too soon: Max-Age %d, want about 400 days", cookie.MaxAge)
	}
	if cookie.HttpOnly != true {
		t.Fatal("refresh cookie is readable by script")
	}

	first := h.refresh(cookie)
	if first.status != http.StatusOK {
		t.Fatalf("refresh: %d %s", first.status, first.body)
	}
	extended := sessionCookie(t, first.Header)
	if extended.Value != cookie.Value {
		t.Fatal("refresh replaced the token, so a lost Set-Cookie signs the device out")
	}
	if extended.MaxAge < 399*24*60*60 {
		t.Fatalf("refresh did not extend the cookie: Max-Age %d", extended.MaxAge)
	}

	// The cookie from login, not the one just set. A client that never saw the refresh
	// response — the failure this exists to survive — must still be signed in.
	second := h.refresh(cookie)
	if second.status != http.StatusOK {
		t.Fatalf("the original cookie died on refresh: %d %s", second.status, second.body)
	}
}

func TestRefreshOnDesktopIsAPartitionedCrossSiteCookie(t *testing.T) {
	h := newRegisterHarness(t, platform.RegistrationInvite)
	h.cfg.Env = "production"
	h.build()

	body := `{"email":"ada@example.com","password":"a-long-enough-passphrase"}`
	req := httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "polaris-app://app")
	req.Host = "polaris.example.com"
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}

	cookie := sessionCookie(t, rec.Header())
	if cookie.SameSite != http.SameSiteNoneMode || !cookie.Secure || !cookie.Partitioned {
		t.Fatalf("desktop cookie is not cross-site durable: SameSite=%v Secure=%v Partitioned=%v",
			cookie.SameSite, cookie.Secure, cookie.Partitioned)
	}
}

func TestExpiredSessionLosesTheCookie(t *testing.T) {
	h := newRegisterHarness(t, platform.RegistrationInvite)
	signed := h.register(registerBody{Email: "ada@example.com", Password: "a-long-enough-passphrase"})
	if signed.status != http.StatusOK {
		t.Fatalf("register: %d %s", signed.status, signed.body)
	}
	cookie := sessionCookie(t, signed.Header)

	if _, err := h.svc.DB().Pool().Exec(t.Context(),
		`UPDATE account_session SET expires_at = now() - interval '1 minute'`); err != nil {
		t.Fatalf("expire session: %v", err)
	}

	got := h.refresh(cookie)
	if got.status != http.StatusUnauthorized {
		t.Fatalf("expired session was accepted: %d %s", got.status, got.body)
	}
	cleared := sessionCookie(t, got.Header)
	if cleared.Value != "" || cleared.MaxAge >= 0 {
		t.Fatalf("expired cookie was left in place: value %q Max-Age %d", cleared.Value, cleared.MaxAge)
	}
}

func (h *registerHarness) refresh(cookie *http.Cookie) probe {
	req := httptest.NewRequest(http.MethodPost, "/auth/refresh", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return probe{status: rec.Code, body: strings.TrimSpace(rec.Body.String()), Header: rec.Header()}
}

func sessionCookie(t *testing.T, header http.Header) *http.Cookie {
	t.Helper()
	resp := &http.Response{Header: header}
	for _, c := range resp.Cookies() {
		if c.Name == "polaris_refresh" {
			return c
		}
	}
	t.Fatal("no polaris_refresh cookie")
	return nil
}
