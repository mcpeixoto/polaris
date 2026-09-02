package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A change_log row whose scope will not parse must be skipped — it cannot be judged, so it
// must not be sent. But skipping it silently made an entire page come back empty while the
// rows were still there, and the hub reads an empty page as "retention pruned these". The
// row is inside the 30-day window, so it is never pruned: every session in the workspace
// then re-bootstraps on every subsequent write, forever, and it presents to the person
// using the app as "it keeps reloading" rather than as a data error.
//
// scannedThrough is what makes the two cases distinguishable.
func TestReadChangesScannedReportsWhatItLookedAt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	writeChange(t, db, f.WorkspaceID, 1, `{"kind":"workspace"}`)
	writeChange(t, db, f.WorkspaceID, 2, `"not an object"`)
	writeChange(t, db, f.WorkspaceID, 3, `[1,2,3]`)

	changes, scannedThrough, err := svc.ReadChangesScanned(ctx, f.WorkspaceID, 0, 100, 500)
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	if len(changes) != 1 || changes[0].Version != 1 {
		t.Fatalf("got %d readable changes, want the one row with a valid scope", len(changes))
	}
	if scannedThrough != 3 {
		t.Fatalf("scannedThrough is %d, want 3 — the highest version actually looked at", scannedThrough)
	}

	// The case that matters: a page that is entirely unreadable still has to say so, or
	// the caller cannot tell it from a page that is genuinely empty.
	changes, scannedThrough, err = svc.ReadChangesScanned(ctx, f.WorkspaceID, 1, 100, 500)
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	if len(changes) != 0 {
		t.Fatalf("got %d changes from a page of unparseable rows, want 0", len(changes))
	}
	if scannedThrough != 3 {
		t.Fatalf("an entirely unreadable page reported scannedThrough %d, want 3", scannedThrough)
	}

	// And a genuinely empty range reports the cursor unchanged, which is the real
	// "these rows are gone" signal the resync path is for.
	changes, scannedThrough, err = svc.ReadChangesScanned(ctx, f.WorkspaceID, 3, 100, 500)
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	if len(changes) != 0 || scannedThrough != 3 {
		t.Fatalf("an empty range returned %d changes and scannedThrough %d, want 0 and 3",
			len(changes), scannedThrough)
	}
}

// writeChange inserts one change_log row with a caller-chosen scope. Nothing in the domain
// layer can write a malformed scope — which is the point — so the row goes in by hand.
func writeChange(t *testing.T, db *store.DB, workspaceID uuid.UUID, version int64, scope string) {
	t.Helper()
	_, err := db.Pool().Exec(context.Background(),
		`INSERT INTO change_log (workspace_id, version, entity_type, entity_id, op,
		                         scope, actor_type, payload)
		 VALUES ($1, $2, 'issue', $3, 'upsert', $4::jsonb, 'user', '{}'::jsonb)`,
		workspaceID, version, uuid.New(), scope)
	if err != nil {
		t.Fatalf("insert change_log row: %v", err)
	}
}
