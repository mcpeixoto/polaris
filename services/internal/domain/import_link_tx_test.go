package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The link is written with the issue, not after it. Written after, a crash between the two
// commits leaves an issue nothing points at, and the resumed import files it a second time.
func TestImportRunCreateIssue_WritesTheLinkInTheSameTransaction(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	jobID := uuid.Must(uuid.NewV7())
	key := "lin_api_test"
	if _, err := db.Queries().InsertImportJob(ctx, store.InsertImportJobParams{
		ID: jobID, WorkspaceID: f.WorkspaceID, Source: "linear", CreatedBy: &f.UserID, ApiKey: &key,
	}); err != nil {
		t.Fatalf("insert job: %v", err)
	}
	run := domain.NewImportRunForTest(svc, f.Principal(), jobID, f.WorkspaceID)

	created, err := run.CreateIssue(domain.WithImport(ctx), domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "From Linear",
	}, domain.ImportedIssue{ExternalID: "lin-issue-1", Number: 7})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// No Remember call: the link has to be there already.
	got, ok, err := run.Lookup(ctx, "issue", "lin-issue-1")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if !ok || got != created.ID {
		t.Fatalf("link = %v (found %v), want %v written with the issue", got, ok, created.ID)
	}
}
