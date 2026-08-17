package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Client-minted issue ids.
//
// This is the fix for the one defect M0 shipped with. The server still allocates the
// number — a row-locked counter, unpredictable by design — but the id may come from the
// client, and that is what makes an offline create honest: the optimistic row *is* the
// issue, so when the outbox replays minutes later the server's delta lands on the same id
// instead of arriving beside a stand-in nobody is left holding the pairing for.
//
// The tests below are mostly about what a client id may NOT be used for. Accepting one is
// three lines; the reason it took a page of reasoning is that an id is now attacker-chosen
// input on a table with a unique constraint, and a unique constraint that reports collisions
// is an existence oracle.

func TestCreateIssue_HonoursAClientSuppliedID(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	chosen := uuid.Must(uuid.NewV7())

	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		ID:     &chosen,
		TeamID: f.TeamID,
		Title:  "Written on a train",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if issue.ID != chosen {
		t.Fatalf("issue id = %s, want the client's %s", issue.ID, chosen)
	}
	// The number is still the server's, and the identifier is derived from it. If a client
	// could choose the number too, two offline clients would both create ENG-7.
	if issue.Number == 0 {
		t.Error("the server must still allocate the number")
	}
	if issue.Identifier != f.TeamKey+"-1" {
		t.Errorf("identifier = %q, want %s-1", issue.Identifier, f.TeamKey)
	}
}

func TestCreateIssue_MintsAnIDWhenTheClientDoesNot(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	issue, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		TeamID: f.TeamID,
		Title:  "Written at a desk",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.ID == uuid.Nil {
		t.Fatal("the server must mint an id when the client sends none")
	}
	if issue.ID.Version() != 7 {
		t.Errorf("server-minted id is v%d, want v7", issue.ID.Version())
	}
}

// v4 ids are not merely unfashionable here. Ids in this schema are time-ordered, which is
// what keeps index locality good and makes the change log naturally sorted by creation. A
// client sending v4s would degrade both, and the degradation is invisible until somebody
// profiles an insert-heavy workspace months later.
func TestCreateIssue_RejectsAnIDThatIsNotV7(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	v4 := uuid.New()
	_, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		ID:     &v4,
		TeamID: f.TeamID,
		Title:  "Wrong uuid version",
	})
	if err == nil {
		t.Fatal("a v4 id was accepted")
	}
	if !strings.Contains(err.Error(), "version 7") {
		t.Errorf("error should say what is wrong with the id, got: %v", err)
	}
}

func TestCreateIssue_RejectsAnIDAlreadyInUse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	taken := f.NewIssue(t, "Already here")

	_, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		ID:     &taken,
		TeamID: f.TeamID,
		Title:  "Collides",
	})
	if err == nil {
		t.Fatal("a duplicate id was accepted")
	}
	// A validation error, not an internal one: letting it fall through to the unique
	// constraint would surface a 500 for something the caller can fix by retrying with a
	// fresh id — which is exactly what a client whose outbox replayed after a crash does.
	if !strings.Contains(err.Error(), "already in use") {
		t.Errorf("error should name the collision, got: %v", err)
	}
}

// The check reads the primary key, not GetIssue, and this is why.
//
// A soft-deleted issue's id is still occupied — the primary key does not care that the row
// is hidden. Checking through GetIssue would report the id as free, and the insert would
// then hit the unique constraint and surface as an internal error instead of the message
// that explains it. A client replaying an outbox after deleting the issue does exactly
// this.
func TestCreateIssue_RejectsTheIDOfASoftDeletedIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	id := f.NewIssue(t, "Deleted but its id is still taken")
	if _, err := svc.DeleteIssue(ctx, f.Principal(), id); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
		ID:     &id,
		TeamID: f.TeamID,
		Title:  "Reusing a deleted id",
	})
	if err == nil {
		t.Fatal("the id of a soft-deleted issue was accepted")
	}
	if !strings.Contains(err.Error(), "already in use") {
		t.Errorf("want the same validation message as a live collision, got: %v", err)
	}
}

// Two creates racing on one id: one wins, the other is refused rather than corrupting.
//
// The existence check and the insert are not atomic with respect to each other across
// transactions, so the unique constraint stays the backstop. What must not happen is both
// succeeding, or the loser reporting success.
func TestCreateIssue_ConcurrentClaimsOnOneIDLeaveOneIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	chosen := uuid.Must(uuid.NewV7())
	const attempts = 4

	type result struct {
		err error
	}
	results := make(chan result, attempts)
	start := make(chan struct{})

	for i := 0; i < attempts; i++ {
		go func() {
			<-start
			_, _, err := svc.CreateIssue(ctx, f.Principal(), domain.CreateIssueInput{
				ID:     &chosen,
				TeamID: f.TeamID,
				Title:  "Race",
			})
			results <- result{err}
		}()
	}
	close(start)

	succeeded := 0
	for i := 0; i < attempts; i++ {
		if (<-results).err == nil {
			succeeded++
		}
	}

	if succeeded != 1 {
		t.Fatalf("%d of %d concurrent creates succeeded, want exactly 1", succeeded, attempts)
	}

	issue, err := svc.GetIssue(ctx, f.Principal(), chosen)
	if err != nil {
		t.Fatalf("the winning issue is not readable: %v", err)
	}
	if issue.ID != chosen {
		t.Errorf("stored id = %s, want %s", issue.ID, chosen)
	}
}
