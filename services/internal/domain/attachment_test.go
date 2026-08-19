package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateAttachment_SameURLOnTheSameIssueUpdatesRatherThanDuplicating(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The importer is broken",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	first, v1, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID: issue.ID,
		URL:     "https://github.com/acme/app/pull/12",
		Title:   "PR 12",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if v1 == 0 {
		t.Fatal("an attachment must land on the sync stream")
	}

	second, v2, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID: issue.ID,
		URL:     "HTTPS://GitHub.com/acme/app/pull/12",
		Title:   "Pull request 12",
	})
	if err != nil {
		t.Fatalf("re-create: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("same URL minted a second card %s; want the original %s", second.ID, first.ID)
	}
	if second.Title != "Pull request 12" {
		t.Fatalf("title = %q, want the updated title", second.Title)
	}
	if v2 <= v1 {
		t.Fatal("the update must emit a later change")
	}

	listed, err := svc.ListAttachments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("got %d attachments, want 1 — URL idempotency is the whole contract", len(listed))
	}
}

func TestCreateAttachment_SameURLOnTwoIssuesIsTwoCards(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "A"})
	if err != nil {
		t.Fatalf("issue a: %v", err)
	}
	b, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "B"})
	if err != nil {
		t.Fatalf("issue b: %v", err)
	}
	url := "https://linear.app/issue/ENG-1"
	one, _, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{IssueID: a.ID, URL: url, Title: "A"})
	if err != nil {
		t.Fatalf("attach a: %v", err)
	}
	two, _, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{IssueID: b.ID, URL: url, Title: "B"})
	if err != nil {
		t.Fatalf("attach b: %v", err)
	}
	if one.ID == two.ID {
		t.Fatal("the same URL on two issues must be two cards")
	}
	found, err := svc.ListAttachmentsForURL(ctx, p, url)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if len(found) != 2 {
		t.Fatalf("attachmentsForURL returned %d, want both issues", len(found))
	}
}

func TestCreateAttachment_RefusesANonHTTPURL(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "X"})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	_, _, err = svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID: issue.ID, URL: "javascript:alert(1)", Title: "no",
	})
	if err == nil || platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("javascript: URL must be refused, got %v", err)
	}
}

func TestMarkIssueDuplicate_MovesAttachmentsOntoTheCanonical(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)

	canonical, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The real one",
	})
	if err != nil {
		t.Fatalf("canonical: %v", err)
	}
	copy, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "A copy", FromTriage: true,
	})
	if err != nil {
		t.Fatalf("copy: %v", err)
	}

	shared := "https://github.com/acme/app/issues/9"
	if _, _, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID: canonical.ID, URL: shared, Title: "Already here",
	}); err != nil {
		t.Fatalf("canonical shared: %v", err)
	}
	if _, _, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID: copy.ID, URL: shared, Title: "Also here",
	}); err != nil {
		t.Fatalf("copy shared: %v", err)
	}
	unique, _, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID: copy.ID, URL: "https://sentry.io/issues/abc", Title: "Sentry",
	})
	if err != nil {
		t.Fatalf("copy unique: %v", err)
	}

	if _, _, err := svc.MarkIssueDuplicate(ctx, p, copy.ID, canonical.ID); err != nil {
		t.Fatalf("duplicate: %v", err)
	}

	onCanonical, err := svc.ListAttachments(ctx, p, canonical.ID)
	if err != nil {
		t.Fatalf("list canonical: %v", err)
	}
	if len(onCanonical) != 2 {
		t.Fatalf("canonical has %d attachments, want the original plus the unique one from the copy", len(onCanonical))
	}
	ids := map[string]bool{}
	for _, a := range onCanonical {
		ids[a.URL] = true
	}
	if !ids[shared] || !ids[unique.URL] {
		t.Fatalf("canonical URLs = %v, want the shared GitHub URL and the Sentry URL", ids)
	}

	onCopy, err := svc.ListAttachments(ctx, p, copy.ID)
	if err != nil {
		t.Fatalf("list copy: %v", err)
	}
	if len(onCopy) != 0 {
		t.Fatalf("the duplicate still holds %d attachments; they should have moved", len(onCopy))
	}
}

func TestCreateAttachment_StoresMetadataAsAnObject(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "X"})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	att, _, err := svc.CreateAttachment(ctx, p, domain.CreateAttachmentInput{
		IssueID:  issue.ID,
		URL:      "https://example.com/a",
		Title:    "A",
		Metadata: json.RawMessage(`{"mergedAt":"2026-01-01T00:00:00Z"}`),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.Contains(string(att.Metadata), "mergedAt") {
		t.Fatalf("metadata = %s, want the object we sent", att.Metadata)
	}
}
