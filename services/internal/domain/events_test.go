package domain_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// seedWorkspace creates the minimum rows the emitter needs: a workspace and its version
// counter.
func seedWorkspace(t *testing.T, db *store.DB) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	id := uuid.Must(uuid.NewV7())

	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := q.CreateWorkspace(ctx, store.CreateWorkspaceParams{
			ID:       id,
			Name:     "Test",
			UrlKey:   "test-" + id.String()[:8],
			Plan:     "free",
			Settings: json.RawMessage(`{}`),
		}); err != nil {
			return err
		}
		return q.InitWorkspaceVersion(ctx, id)
	})
	if err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	return id
}

func TestEmit_AssignsGaplessConsecutiveVersions(t *testing.T) {
	db := testutil.NewDB(t)
	ws := seedWorkspace(t, db)
	ctx := context.Background()
	var em domain.Emitter

	// Three separate transactions, two changes each.
	for range 3 {
		err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
			_, err := em.Emit(ctx, q, ws, authz.SystemActor(),
				domain.Change{EntityType: "issue", EntityID: uuid.New(), Op: domain.OpUpsert,
					Scope: authz.WorkspaceScope(), Payload: map[string]any{"n": 1}},
				domain.Change{EntityType: "issue", EntityID: uuid.New(), Op: domain.OpUpsert,
					Scope: authz.WorkspaceScope(), Payload: map[string]any{"n": 2}},
			)
			return err
		})
		if err != nil {
			t.Fatalf("emit: %v", err)
		}
	}

	rows, err := db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID:    ws,
		AfterVersion:   0,
		ThroughVersion: 1 << 40,
		PageSize:       100,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	if len(rows) != 6 {
		t.Fatalf("expected 6 change rows, got %d", len(rows))
	}
	// The whole design rests on this: no gaps, strictly increasing, starting at 1.
	for i, r := range rows {
		if want := int64(i + 1); r.Version != want {
			t.Fatalf("row %d has version %d, want %d — the version sequence must be gapless", i, r.Version, want)
		}
	}
}

func TestEmit_RollbackLeavesNoTrace(t *testing.T) {
	db := testutil.NewDB(t)
	ws := seedWorkspace(t, db)
	ctx := context.Background()
	var em domain.Emitter

	sentinel := errors.New("caller failed after emitting")
	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := em.Emit(ctx, q, ws, authz.SystemActor(), domain.Change{
			EntityType: "issue", EntityID: uuid.New(), Op: domain.OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: map[string]any{},
		}); err != nil {
			return err
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected the sentinel error, got %v", err)
	}

	// Acceptance test 11: entity write, change row and version bump are one atomic unit.
	// If the version survived a rollback, clients would wait forever for a delta that
	// does not exist.
	rows, err := db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID: ws, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 10,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rolled-back transaction left %d change rows behind", len(rows))
	}

	v, err := db.Queries().GetWorkspaceVersion(ctx, ws)
	if err != nil {
		t.Fatalf("get version: %v", err)
	}
	if v != 0 {
		t.Fatalf("rolled-back transaction advanced the workspace version to %d", v)
	}
}

func TestEmit_RejectsRevokeWithPayload(t *testing.T) {
	db := testutil.NewDB(t)
	ws := seedWorkspace(t, db)
	ctx := context.Background()
	var em domain.Emitter

	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := em.Emit(ctx, q, ws, authz.SystemActor(), domain.Change{
			EntityType: "issue", EntityID: uuid.New(), Op: domain.OpRevoke,
			Scope:   authz.TeamScope(uuid.New(), true),
			Payload: map[string]any{"title": "secret"},
		})
		return err
	})
	// A revoke means the recipient is losing access. Attaching the data to that message
	// hands it over on the way out — the exact opposite of the intent.
	if err == nil {
		t.Fatal("emitting a revoke with a payload must fail")
	}
}

func TestEmit_RejectsInvalidActor(t *testing.T) {
	db := testutil.NewDB(t)
	ws := seedWorkspace(t, db)
	ctx := context.Background()
	var em domain.Emitter

	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := em.Emit(ctx, q, ws, authz.Actor{Type: "wat"}, domain.Change{
			EntityType: "issue", EntityID: uuid.New(), Op: domain.OpUpsert,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	if err == nil {
		t.Fatal("emitting with an unknown actor type must fail")
	}
}

func TestEmit_PreservesScopeAndPayloadShape(t *testing.T) {
	db := testutil.NewDB(t)
	ws := seedWorkspace(t, db)
	team := uuid.New()
	ctx := context.Background()
	var em domain.Emitter

	type payload struct {
		Title string `json:"title"`
	}

	actorID := uuid.New()
	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := em.Emit(ctx, q, ws, authz.UserActor(actorID), domain.Change{
			EntityType: "issue",
			EntityID:   uuid.New(),
			Op:         domain.OpUpsert,
			TeamID:     &team,
			Scope:      authz.TeamScope(team, true),
			Payload:    payload{Title: "hello"},
		})
		return err
	})
	if err != nil {
		t.Fatalf("emit: %v", err)
	}

	rows, err := db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID: ws, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 10,
	})
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	r := rows[0]

	if r.TeamID == nil || *r.TeamID != team {
		t.Error("team_id must be denormalised onto the change row for visibility filtering")
	}
	if r.ActorType != string(authz.ActorUser) || r.ActorID == nil || *r.ActorID != actorID {
		t.Error("actor must survive onto the change row")
	}

	scope, err := authz.ParseScope(r.Scope)
	if err != nil {
		t.Fatalf("parse scope: %v", err)
	}
	if scope.Kind != authz.ScopeTeam || !scope.Private {
		t.Errorf("scope did not survive the round trip: %+v", scope)
	}

	var got payload
	if err := json.Unmarshal(r.Payload, &got); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if got.Title != "hello" {
		t.Errorf("payload lost information: %+v", got)
	}
}

func TestEmit_ConcurrentWritersStillProduceGaplessVersions(t *testing.T) {
	db := testutil.NewDB(t)
	ws := seedWorkspace(t, db)
	ctx := context.Background()
	var em domain.Emitter

	// The row lock on workspace_version is the serialisation point. If it is ever
	// removed as an "optimisation", this is the test that fails.
	const writers = 12
	errs := make(chan error, writers)
	for range writers {
		go func() {
			errs <- db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
				_, err := em.Emit(ctx, q, ws, authz.SystemActor(), domain.Change{
					EntityType: "issue", EntityID: uuid.New(), Op: domain.OpUpsert,
					Scope: authz.WorkspaceScope(), Payload: map[string]any{},
				})
				return err
			})
		}()
	}
	for range writers {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent emit: %v", err)
		}
	}

	rows, err := db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID: ws, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(rows) != writers {
		t.Fatalf("expected %d rows, got %d", writers, len(rows))
	}
	seen := map[int64]bool{}
	for _, r := range rows {
		if seen[r.Version] {
			t.Fatalf("version %d was assigned twice", r.Version)
		}
		seen[r.Version] = true
	}
	for v := int64(1); v <= writers; v++ {
		if !seen[v] {
			t.Fatalf("version %d is missing — the sequence has a gap", v)
		}
	}
}

func TestHistory_FoldsChangesMadeJustAfterCreation(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	ws := f.WorkspaceID
	ctx := context.Background()
	var em domain.Emitter

	issueID := f.NewIssue(t, "")
	createdAt := time.Now() // brand new

	// Creating an issue and immediately setting assignee and priority is one action to
	// the user. Three feed entries would be noise.
	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		return em.History(ctx, q, ws, authz.SystemActor(), createdAt,
			domain.HistoryEntry{IssueID: issueID, Kind: "created"},
			domain.HistoryEntry{IssueID: issueID, Kind: "assignee", ToValue: "someone"},
			domain.HistoryEntry{IssueID: issueID, Kind: "priority", ToValue: 2},
		)
	})
	if err != nil {
		t.Fatalf("history: %v", err)
	}

	entries, err := db.Queries().ListIssueHistory(ctx, issueID)
	if err != nil {
		t.Fatalf("list history: %v", err)
	}
	if len(entries) != 1 || entries[0].Kind != "created" {
		t.Fatalf("expected only the creation entry, got %d entries", len(entries))
	}
}

func TestHistory_GroupsRepeatedEditsBySameActor(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	ws := f.WorkspaceID
	ctx := context.Background()
	var em domain.Emitter

	issueID := f.NewIssue(t, "")
	actor := authz.UserActor(f.UserID)
	// Old enough that the creation window has passed.
	createdAt := time.Now().Add(-time.Hour)

	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := em.History(ctx, q, ws, actor, createdAt,
			domain.HistoryEntry{IssueID: issueID, Kind: "state", FromValue: "Todo", ToValue: "Doing"},
		); err != nil {
			return err
		}
		return em.History(ctx, q, ws, actor, createdAt,
			domain.HistoryEntry{IssueID: issueID, Kind: "state", FromValue: "Doing", ToValue: "Done"},
		)
	})
	if err != nil {
		t.Fatalf("history: %v", err)
	}

	entries, err := db.Queries().ListIssueHistory(ctx, issueID)
	if err != nil {
		t.Fatalf("list history: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected the two edits to collapse into one entry, got %d", len(entries))
	}
	// The run should read Todo -> Done: original from-value, latest to-value.
	var from, to string
	_ = json.Unmarshal(entries[0].FromValue, &from)
	_ = json.Unmarshal(entries[0].ToValue, &to)
	if from != "Todo" || to != "Done" {
		t.Errorf("grouped entry should read Todo -> Done, got %q -> %q", from, to)
	}
}

func TestHistory_DoesNotGroupAcrossActors(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	ws := f.WorkspaceID
	ctx := context.Background()
	var em domain.Emitter

	issueID := f.NewIssue(t, "")
	createdAt := time.Now().Add(-time.Hour)
	alice := authz.UserActor(f.UserID)
	bob := authz.UserActor(f.NewUser(t, "bob", "member", true))

	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := em.History(ctx, q, ws, alice, createdAt,
			domain.HistoryEntry{IssueID: issueID, Kind: "state", FromValue: "Todo", ToValue: "Doing"}); err != nil {
			return err
		}
		return em.History(ctx, q, ws, bob, createdAt,
			domain.HistoryEntry{IssueID: issueID, Kind: "state", FromValue: "Doing", ToValue: "Done"})
	})
	if err != nil {
		t.Fatalf("history: %v", err)
	}

	entries, err := db.Queries().ListIssueHistory(ctx, issueID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	// Who did what is the point of the feed; collapsing across people destroys it.
	if len(entries) != 2 {
		t.Fatalf("edits by different people must stay separate, got %d entries", len(entries))
	}
}
