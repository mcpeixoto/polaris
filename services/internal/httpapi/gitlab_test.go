package httpapi_test

import (
	"context"
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

func gitlabRouter(t *testing.T) (http.Handler, *testutil.Fixture, *domain.Service) {
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

func TestGitLabEvents_RefuseABadToken(t *testing.T) {
	h, f, svc := gitlabRouter(t)
	ctx := context.Background()
	if _, _, _, err := svc.CreateGitLabConnection(ctx, f.Principal(), domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := `{"object_kind":"merge_request"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/gitlab/"+f.WorkspaceID.String(), strings.NewReader(body))
	req.Header.Set("X-Gitlab-Token", "wrong")
	req.Header.Set("X-Gitlab-Event", "Merge Request Hook")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestGitLabEvents_MergeRequestLinks(t *testing.T) {
	h, f, svc := gitlabRouter(t)
	ctx := context.Background()
	p := f.Principal()
	_, secret, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	body := `{
		"object_kind": "merge_request",
		"project": {"path_with_namespace": "acme/app"},
		"object_attributes": {
			"iid": 12,
			"title": "Fixes ENG-1",
			"state": "opened",
			"action": "open",
			"source_branch": "feat/eng-1",
			"url": "https://gitlab.com/acme/app/-/merge_requests/12"
		}
	}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/gitlab/"+f.WorkspaceID.String(), strings.NewReader(body))
	req.Header.Set("X-Gitlab-Token", secret)
	req.Header.Set("X-Gitlab-Event", "Merge Request Hook")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	listed, err := svc.ListAttachments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("want one MR card, got %d", len(listed))
	}
}
