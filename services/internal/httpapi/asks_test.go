package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func askRouter(t *testing.T) (http.Handler, *testutil.Fixture, *domain.Service) {
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

func TestAskForm_PublicGetNamesTheTeam(t *testing.T) {
	h, f, svc := askRouter(t)
	form, _, err := svc.CreateAskForm(context.Background(), f.Principal(), domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "IT", Description: "Access requests.",
	})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/asks/"+form.Token, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["name"] != "IT" || got["description"] != "Access requests." || got["teamName"] == "" {
		t.Fatalf("payload = %s", rec.Body.String())
	}
}

func TestAskForm_SubmitCreatesWithoutLeakingTheNumber(t *testing.T) {
	h, f, svc := askRouter(t)
	form, _, err := svc.CreateAskForm(context.Background(), f.Principal(), domain.CreateAskFormInput{
		TeamID: f.TeamID, Name: "Bugs",
	})
	if err != nil {
		t.Fatal(err)
	}

	body := `{"title":"Printer fire","description":"Third floor.","requesterName":"Ada","requesterEmail":"ada@example.com"}`
	req := httptest.NewRequest(http.MethodPost, "/asks/"+form.Token, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "identifier") || strings.Contains(rec.Body.String(), "issueId") {
		t.Fatalf("must not leak the issue: %s", rec.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["ok"] != "created" {
		t.Fatalf("payload = %s", rec.Body.String())
	}
}

func TestAskForm_UnknownTokenIsNotFound(t *testing.T) {
	h, _, _ := askRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/asks/deadbeef", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}

	post := httptest.NewRequest(http.MethodPost, "/asks/deadbeef", strings.NewReader(
		`{"title":"Hi","requesterName":"Ada","requesterEmail":"ada@example.com"}`))
	post.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, post)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("submit status %d body %s", rec.Code, rec.Body.String())
	}
}
