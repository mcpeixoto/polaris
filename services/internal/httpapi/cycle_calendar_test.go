package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func cycleCalendarRouter(t *testing.T) (http.Handler, *testutil.Fixture, *domain.Service) {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	h := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  httpapi.NewTokens("test-secret-long-enough-for-hmac", 0),
		Config:  platform.Config{Env: "development", JWTSecret: "test-secret-long-enough-for-hmac"},
	})
	return h, f, svc
}

func TestCycleCalendarFeed_ServesICSWithoutASession(t *testing.T) {
	h, f, svc := cycleCalendarRouter(t)
	ctx := context.Background()
	p := f.Principal()
	on := true
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &on,
	}); err != nil {
		t.Fatalf("enable cycles: %v", err)
	}
	_, token, _, err := svc.EnsureCycleCalendarFeed(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/calendars/cycles/"+token, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/calendar") {
		t.Fatalf("Content-Type %q", ct)
	}
	if !strings.Contains(rec.Body.String(), "BEGIN:VCALENDAR") {
		t.Fatalf("body is not ICS: %s", rec.Body.String())
	}
}

func TestCycleCalendarFeed_RotatedTokenIsNotFound(t *testing.T) {
	h, f, svc := cycleCalendarRouter(t)
	ctx := context.Background()
	p := f.Principal()
	on := true
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &on,
	}); err != nil {
		t.Fatalf("enable cycles: %v", err)
	}
	_, oldToken, _, err := svc.EnsureCycleCalendarFeed(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	_, newToken, _, err := svc.RotateCycleCalendarFeed(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/calendars/cycles/"+oldToken, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("old token status %d body %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/calendars/cycles/"+newToken, nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("new token status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestCycleCalendarFeed_UnknownTokenIsNotFound(t *testing.T) {
	h, _, _ := cycleCalendarRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/calendars/cycles/cal_missing", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}
