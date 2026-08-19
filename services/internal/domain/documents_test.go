package domain_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateDocument_TeamDocumentLandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	doc, version, err := svc.CreateDocument(ctx, p, domain.CreateDocumentInput{
		TeamID: f.TeamID,
		Title:  "Runbook",
		Body:   "## Deploy\n\n1. Merge\n2. Ship",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("a document must land on the sync stream")
	}
	if doc.ProjectID != nil {
		t.Fatal("team documents must not name a project")
	}
	if doc.Body == "" {
		t.Fatal("body must round-trip")
	}
}

func TestCreateDocument_RefusesAnEmptyTitle(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, err := svc.CreateDocument(ctx, p, domain.CreateDocumentInput{
		TeamID: f.TeamID,
		Title:  "   ",
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestUpdateDocument_EmitsWhenTheBodyChanges(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	created, v1, err := svc.CreateDocument(ctx, p, domain.CreateDocumentInput{
		TeamID: f.TeamID,
		Title:  "Spec",
		Body:   "Draft",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	body := "Shipped"
	updated, v2, err := svc.UpdateDocument(ctx, p, domain.UpdateDocumentInput{
		ID:   created.ID,
		Body: &body,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Body != body {
		t.Fatalf("body = %q, want %q", updated.Body, body)
	}
	if v2 <= v1 {
		t.Fatal("the update must emit a later change")
	}
}

func TestArchiveDocument_RemovesItFromTheReplica(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	doc, _, err := svc.CreateDocument(ctx, p, domain.CreateDocumentInput{
		TeamID: f.TeamID,
		Title:  "Old notes",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	version, err := svc.ArchiveDocument(ctx, p, doc.ID, true)
	if err != nil {
		t.Fatalf("archive: %v", err)
	}
	if version == 0 {
		t.Fatal("archive must emit")
	}

	_, err = svc.GetDocument(ctx, p, doc.ID)
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("archived doc should not be readable live, got %v", err)
	}
}

func TestDeleteDocument_SoftDeletes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	doc, _, err := svc.CreateDocument(ctx, p, domain.CreateDocumentInput{
		TeamID: f.TeamID,
		Title:  "Temporary",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := svc.DeleteDocument(ctx, p, doc.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	_, err = svc.GetDocument(ctx, p, doc.ID)
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("deleted doc should not be readable live, got %v", err)
	}
}
