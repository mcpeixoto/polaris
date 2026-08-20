package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateComment_PinsASpanOfTheDescription(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Spec", Description: "The auth path is wrong.",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	start, end := 4, 13
	quote := "auth path"
	got, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID:     issue.ID,
		Body:        "It is the session cookie.",
		AnchorStart: &start,
		AnchorEnd:   &end,
		Quote:       &quote,
	})
	if err != nil {
		t.Fatalf("pin a comment: %v", err)
	}
	if got.Quote == nil || *got.Quote != quote {
		t.Fatalf("quote came back %v", got.Quote)
	}
	if got.AnchorStart == nil || *got.AnchorStart != start || got.AnchorEnd == nil || *got.AnchorEnd != end {
		t.Fatalf("span came back %v–%v", got.AnchorStart, got.AnchorEnd)
	}

	listed, err := svc.ListComments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].Quote == nil || *listed[0].Quote != quote {
		t.Fatalf("list did not round-trip the span: %+v", listed)
	}
}

func TestCreateComment_RefusesAPartialSpan(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Spec", Description: "Hello",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	start := 0
	_, _, err = svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID: issue.ID, Body: "no span", AnchorStart: &start,
	})
	if err == nil {
		t.Fatal("a start without an end and a quote should be refused")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestCreateComment_RefusesAnAnchorOnAReply(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Spec", Description: "The auth path is wrong.",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	root, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID: issue.ID, Body: "Root",
	})
	if err != nil {
		t.Fatalf("root: %v", err)
	}

	start, end := 4, 13
	quote := "auth path"
	_, _, err = svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID:     issue.ID,
		Body:        "Reply",
		ParentID:    &root.ID,
		AnchorStart: &start,
		AnchorEnd:   &end,
		Quote:       &quote,
	})
	if err == nil {
		t.Fatal("a reply with a span should be refused")
	}
	if !strings.Contains(err.Error(), "reply") {
		t.Fatalf("error should mention replies, got %v", err)
	}
}

func TestResolveComment_WorksOnAnInlineThread(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Spec", Description: "The auth path is wrong.",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	start, end := 4, 13
	quote := "auth path"
	root, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID:     issue.ID,
		Body:        "It is the session cookie.",
		AnchorStart: &start,
		AnchorEnd:   &end,
		Quote:       &quote,
	})
	if err != nil {
		t.Fatalf("pin: %v", err)
	}

	got, _, err := svc.ResolveComment(ctx, p, root.ID, true)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if got.ResolvedAt == nil {
		t.Fatal("resolved thread has no timestamp")
	}
	if got.Quote == nil || *got.Quote != quote {
		t.Fatal("resolving must not strip the span")
	}
}
