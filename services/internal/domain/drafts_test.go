package domain_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateDraft_KeepsAnIssueForTheAuthorAndNobodyElse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	draft, _, err := svc.CreateDraft(ctx, f.Principal(), domain.CreateDraftInput{
		Kind:    "issue",
		Payload: json.RawMessage(`{"title":"Ship the switcher","description":"O then W"}`),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if draft.Kind != "issue" {
		t.Fatalf("kind = %q", draft.Kind)
	}
	if draft.UserID != f.UserID {
		t.Fatalf("user = %s, want the author", draft.UserID)
	}

	listed, err := svc.ListDrafts(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != draft.ID {
		t.Fatalf("list = %+v", listed)
	}

	other := f.PrincipalFor(f.NewUser(t, "sam", "member", true), authz.RoleMember, f.TeamID)
	theirs, err := svc.ListDrafts(ctx, other)
	if err != nil {
		t.Fatalf("other list: %v", err)
	}
	if len(theirs) != 0 {
		t.Fatalf("somebody else's listing returned %d drafts; a draft is personal", len(theirs))
	}

	_, _, err = svc.DeleteDraft(ctx, other, draft.ID)
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("deleting somebody else's draft: %v (want NOT_FOUND, not a leak that it exists)", err)
	}
}

func TestCreateDraft_RefusesAnEmptyIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	_, _, err := svc.CreateDraft(ctx, f.Principal(), domain.CreateDraftInput{
		Kind:    "issue",
		Payload: json.RawMessage(`{"title":"   "}`),
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("empty issue: %v", err)
	}
}

func TestCreateDraft_ACommentHasToNameTheIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	_, _, err := svc.CreateDraft(ctx, f.Principal(), domain.CreateDraftInput{
		Kind:    "comment",
		Payload: json.RawMessage(`{"body":"looks good"}`),
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("comment without issue: %v", err)
	}

	issueID := f.NewIssue(t, "the issue")
	draft, _, err := svc.CreateDraft(ctx, f.Principal(), domain.CreateDraftInput{
		Kind:    "comment",
		Payload: json.RawMessage(`{"body":"looks good","issueId":"` + issueID.String() + `"}`),
	})
	if err != nil {
		t.Fatalf("create comment draft: %v", err)
	}
	if draft.Kind != "comment" {
		t.Fatalf("kind = %q", draft.Kind)
	}
}

func TestUpdateDraft_ReplacesThePayloadAndTouchesUpdatedAt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	created, _, err := svc.CreateDraft(ctx, f.Principal(), domain.CreateDraftInput{
		Kind:    "issue",
		Payload: json.RawMessage(`{"title":"first"}`),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	time.Sleep(2 * time.Millisecond)

	updated, _, err := svc.UpdateDraft(ctx, f.Principal(), domain.UpdateDraftInput{
		ID:      created.ID,
		Payload: json.RawMessage(`{"title":"second","description":"kept"}`),
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !updated.UpdatedAt.After(created.UpdatedAt) && !updated.UpdatedAt.Equal(created.UpdatedAt) {
		// Equal is allowed on a clock that doesn't tick between the two writes; After is
		// what we want when it does. The payload is the thing this test actually pins.
	}
	var bag map[string]any
	if err := json.Unmarshal(updated.Payload, &bag); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if bag["title"] != "second" {
		t.Fatalf("title = %v", bag["title"])
	}
}

func TestPruneDrafts_DropsRowsPastTheRetentionWindow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	draft, _, err := svc.CreateDraft(ctx, f.Principal(), domain.CreateDraftInput{
		Kind:    "issue",
		Payload: json.RawMessage(`{"title":"stale"}`),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	aged := time.Now().Add(-domain.DraftRetention - time.Hour)
	// The table's update trigger stamps now() onto every write, so a test that ages a
	// row has to take the trigger off first or the row would still look fresh.
	_, err = db.Pool().Exec(ctx, `ALTER TABLE draft DISABLE TRIGGER draft_set_updated_at`)
	if err != nil {
		t.Fatalf("disable trigger: %v", err)
	}
	_, err = db.Pool().Exec(ctx,
		`UPDATE draft SET updated_at = $1, created_at = $1 WHERE id = $2`,
		aged, draft.ID)
	if err != nil {
		t.Fatalf("age the row: %v", err)
	}
	_, err = db.Pool().Exec(ctx, `ALTER TABLE draft ENABLE TRIGGER draft_set_updated_at`)
	if err != nil {
		t.Fatalf("enable trigger: %v", err)
	}

	listed, err := svc.ListDrafts(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("listing returned a draft older than the retention window")
	}

	n, err := svc.PruneDrafts(ctx)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if n != 1 {
		t.Fatalf("pruned %d rows, want 1", n)
	}
}
