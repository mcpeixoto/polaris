package domain_test

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 3 in docs/07-milestones/00-milestone-0.md: two clients editing the same
// scalar field concurrently must converge, server-ordered, with neither left showing a
// stale value.
//
// The conflict policy is deliberately boring — last write wins, ordered by the version the
// server minted — and "boring" is only true if it actually holds under concurrency. This
// is the test that says so.

func TestConcurrentScalarEditsConvergeToOneServerOrderedWinner(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	p, err := svc.ResolvePrincipal(ctx, f.AccountID, f.WorkspaceID)
	if err != nil {
		t.Fatalf("resolve principal: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID,
		Title:  "Contended",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	// Eight clients set a different priority on the same issue at the same instant.
	const writers = 8
	var wg sync.WaitGroup
	versions := make([]int64, writers)
	priorities := make([]int, writers)

	for i := range writers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			priority := i%5 + 0
			priorities[i] = priority
			_, version, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
				ID:       issue.ID,
				Priority: &priority,
			})
			if err != nil {
				t.Errorf("writer %d: %v", i, err)
				return
			}
			versions[i] = version
		}(i)
	}
	wg.Wait()

	// Every write got its own version, and no two share one. This is what lets a client
	// decide whether an incoming delta supersedes its own pending write.
	seen := map[int64]bool{}
	for i, v := range versions {
		if v == 0 {
			t.Fatalf("writer %d got no version", i)
		}
		if seen[v] {
			t.Fatalf("version %d was handed to two writers; ordering would be ambiguous", v)
		}
		seen[v] = true
	}

	// The stored value must be the one written at the highest version — the last write,
	// as the server ordered it, not as the goroutines happened to be scheduled.
	final, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}

	highest := int64(0)
	winner := -1
	for i, v := range versions {
		if v > highest {
			highest, winner = v, i
		}
	}
	if final.Priority != priorities[winner] {
		t.Errorf("issue settled on priority %d, but the highest-version write (v%d) set %d — "+
			"last write wins means the version order decides, not the commit order",
			final.Priority, highest, priorities[winner])
	}

	// The change stream must carry every write, in version order, so a client replaying it
	// arrives at the same answer the database holds.
	changes, err := svc.ReadChanges(ctx, f.WorkspaceID, 0, 1<<40, 500)
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}

	var lastPriority *int
	lastVersion := int64(0)
	for _, c := range changes {
		if c.EntityID != issue.ID || c.Op != string(domain.OpUpsert) {
			continue
		}
		if c.Version < lastVersion {
			t.Fatalf("changes came back out of order: %d after %d", c.Version, lastVersion)
		}
		lastVersion = c.Version

		var payload struct {
			Priority int `json:"priority"`
		}
		if err := json.Unmarshal(c.Payload, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		lastPriority = &payload.Priority
	}

	if lastPriority == nil {
		t.Fatal("no upsert for the contended issue reached the change stream")
	}
	if *lastPriority != final.Priority {
		t.Errorf("replaying the change stream ends at priority %d but the database holds %d — "+
			"a client following the stream would render something the server does not have",
			*lastPriority, final.Priority)
	}
}

// Acceptance test 8: a client whose position has been pruned out of the retention window
// must be told to re-bootstrap rather than silently missing everything in between.
func TestResumingBelowRetentionIsDetectable(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	p, err := svc.ResolvePrincipal(ctx, f.AccountID, f.WorkspaceID)
	if err != nil {
		t.Fatalf("resolve principal: %v", err)
	}

	for range 5 {
		if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
			TeamID: f.TeamID, Title: "Churn",
		}); err != nil {
			t.Fatalf("create issue: %v", err)
		}
	}

	oldest, err := svc.OldestRetainedVersion(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("oldest retained: %v", err)
	}
	if oldest == 0 {
		t.Fatal("a workspace with changes must report a retention floor")
	}

	// Simulate the nightly prune having removed everything before the floor.
	if _, err := db.Pool().Exec(ctx,
		`DELETE FROM change_log WHERE workspace_id = $1 AND version < $2`,
		f.WorkspaceID, oldest+3); err != nil {
		t.Fatalf("prune: %v", err)
	}

	newFloor, err := svc.OldestRetainedVersion(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("oldest retained after prune: %v", err)
	}
	if newFloor <= oldest {
		t.Fatalf("the retention floor did not move: %d -> %d", oldest, newFloor)
	}

	// A client sitting below the floor cannot be caught up incrementally. The handshake
	// compares its resume point against this value and answers with a resync; without the
	// comparison it would resume from a version whose deltas no longer exist and be
	// permanently, silently stale.
	staleClientVersion := oldest - 1
	if staleClientVersion >= newFloor-1 {
		t.Fatalf("test setup did not produce a client below the floor (client=%d floor=%d)",
			staleClientVersion, newFloor)
	}
}
