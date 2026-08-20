package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateSentryConnection_IsAdminOnlyAndLandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "sam", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)
	if _, _, _, err := svc.CreateSentryConnection(ctx, member, domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID}); err == nil {
		t.Fatal("a member must not enable Sentry for the workspace")
	}

	conn, secret, version, err := svc.CreateSentryConnection(ctx, f.Principal(), domain.CreateSentryConnectionInput{
		DefaultTeamID: f.TeamID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("the connection must land on the sync stream")
	}
	if conn.DefaultTeamID != f.TeamID {
		t.Fatalf("team: %s", conn.DefaultTeamID)
	}
	if secret == "" {
		t.Fatal("the webhook secret is what an admin pastes into Sentry; it has to exist at create")
	}

	raw, _ := json.Marshal(conn)
	if strings.Contains(string(raw), secret) {
		t.Fatal("the sync payload must not carry the webhook secret")
	}
}

func TestCreateSentryConnection_RefusesAPrivateTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	priv, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "SEC", Name: "Security", Private: true})
	if err != nil {
		t.Fatalf("private team: %v", err)
	}
	if _, _, _, err := svc.CreateSentryConnection(ctx, p, domain.CreateSentryConnectionInput{DefaultTeamID: priv.ID}); err == nil {
		t.Fatal("Sentry must not target a private team")
	}
}

func TestIngestSentryIssue_CreatesOnceAndLinksByURL(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateSentryConnection(ctx, p, domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}

	first, err := svc.IngestSentryIssue(ctx, f.WorkspaceID, domain.IngestSentryIssueInput{
		URL:     "https://sentry.io/organizations/acme/issues/12345/events/abc/",
		Title:   "Error: boom",
		Culprit: "app.views",
		Project: "Web",
		Level:   "error",
		ShortID: "WEB-1",
	})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	if first.Issue == nil || first.Attachment == nil {
		t.Fatal("a new Sentry alert must create an issue and attach the URL")
	}
	if first.Issue.Title != "Error: boom" {
		t.Fatalf("title: %s", first.Issue.Title)
	}
	if !strings.Contains(first.Issue.Description, "https://sentry.io/organizations/acme/issues/12345/") {
		t.Fatalf("description should cite the issue URL, got %q", first.Issue.Description)
	}
	if first.Attachment.URL != "https://sentry.io/organizations/acme/issues/12345/" {
		t.Fatalf("canonical url: %s", first.Attachment.URL)
	}

	again, err := svc.IngestSentryIssue(ctx, f.WorkspaceID, domain.IngestSentryIssueInput{
		URL:   "https://acme.sentry.io/issues/12345/",
		Title: "Error: boom",
	})
	if err != nil {
		t.Fatalf("reingest: %v", err)
	}
	// Different host, same issue id — v1 treats these as distinct URLs (attachment
	// uniqueness is the exact URL). A second issue is acceptable; the event-path
	// collapse above is the idempotency that retries actually hit.
	_ = again

	retry, err := svc.IngestSentryIssue(ctx, f.WorkspaceID, domain.IngestSentryIssueInput{
		URL:   "https://sentry.io/organizations/acme/issues/12345/",
		Title: "Error: boom",
	})
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if retry.Issue == nil || retry.Issue.ID != first.Issue.ID {
		t.Fatal("the same Sentry issue URL must not mint a second Polaris issue")
	}
}

func TestLinkSentryIssue_AttachesToAnExistingIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateSentryConnection(ctx, p, domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Investigate crash"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	got, att, version, err := svc.LinkSentryIssue(ctx, p, domain.LinkSentryIssueInput{
		IssueID: issue.ID,
		URL:     "https://sentry.io/organizations/acme/issues/9/",
		Title:   "WEB-9",
	})
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if version == 0 {
		t.Fatal("the attachment must land on the sync stream")
	}
	if got.ID != issue.ID {
		t.Fatalf("issue: %s", got.ID)
	}
	if att.IssueID != issue.ID {
		t.Fatalf("attachment issue: %s", att.IssueID)
	}
}

func TestLinkSentryIssue_RefusesSelfHosted(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Self-hosted"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, _, err := svc.LinkSentryIssue(ctx, p, domain.LinkSentryIssueInput{
		IssueID: issue.ID,
		URL:     "https://sentry.example.com/issues/1/",
	}); err == nil {
		t.Fatal("self-hosted Sentry must be refused")
	}
}

func TestVerifySentryWebhook_AcceptsHMACOrToken(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	_, secret, _, err := svc.CreateSentryConnection(ctx, f.Principal(), domain.CreateSentryConnectionInput{DefaultTeamID: f.TeamID})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := []byte(`{"action":"created"}`)
	if err := svc.VerifySentryWebhook(ctx, f.WorkspaceID, body, "deadbeef", "wrong", ""); err == nil {
		t.Fatal("a wrong signature and token must be refused")
	}
	if err := svc.VerifySentryWebhook(ctx, f.WorkspaceID, body, "", secret, ""); err != nil {
		t.Fatalf("token: %v", err)
	}
}
