package domain_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 2 in docs/07-milestones/00-milestone-0.md: replaying the same opId must
// return the original result, not apply a second write.

type payload struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}

func TestIdempotent_ReplayReturnsTheOriginalResultWithoutRerunning(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	key := domain.IdempotencyKey{
		ClientID: uuid.New(),
		OpID:     uuid.New(),
		Request:  map[string]any{"title": "first"},
	}

	runs := 0
	create := func(ctx context.Context) (payload, int64, error) {
		runs++
		return payload{ID: uuid.New(), Title: "first"}, int64(100 + runs), nil
	}

	first, firstVersion, err := domain.Idempotent(ctx, svc, f.WorkspaceID, key, create)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}

	second, secondVersion, err := domain.Idempotent(ctx, svc, f.WorkspaceID, key, create)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}

	if runs != 1 {
		t.Fatalf("the mutation ran %d times; a retry must never apply the write again", runs)
	}
	if second.ID != first.ID || second.Title != first.Title {
		t.Errorf("replay returned a different result: %+v vs %+v", second, first)
	}
	if secondVersion != firstVersion {
		t.Errorf("replay reported version %d, want the original %d — the client uses this to place its write in the stream",
			secondVersion, firstVersion)
	}
}

func TestIdempotent_FailedMutationReleasesTheKey(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	key := domain.IdempotencyKey{ClientID: uuid.New(), OpID: uuid.New(), Request: "x"}
	boom := errors.New("the write failed")

	if _, _, err := domain.Idempotent(ctx, svc, f.WorkspaceID, key,
		func(ctx context.Context) (payload, int64, error) {
			return payload{}, 0, boom
		}); !errors.Is(err, boom) {
		t.Fatalf("expected the underlying error, got %v", err)
	}

	// The retry must actually run. If the failed attempt left its claim behind, the
	// client would read an empty result and believe a write happened that never did.
	ran := false
	got, version, err := domain.Idempotent(ctx, svc, f.WorkspaceID, key,
		func(ctx context.Context) (payload, int64, error) {
			ran = true
			return payload{ID: uuid.New(), Title: "second attempt"}, 7, nil
		})
	if err != nil {
		t.Fatalf("retry after failure: %v", err)
	}
	if !ran {
		t.Fatal("the retry did not run — a failed attempt must not leave its key claimed")
	}
	if got.Title != "second attempt" || version != 7 {
		t.Errorf("retry returned %+v at version %d", got, version)
	}
}

func TestIdempotent_RejectsAReusedOpIDWithDifferentArguments(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	clientID, opID := uuid.New(), uuid.New()

	if _, _, err := domain.Idempotent(ctx, svc, f.WorkspaceID,
		domain.IdempotencyKey{ClientID: clientID, OpID: opID, Request: map[string]any{"title": "one"}},
		func(ctx context.Context) (payload, int64, error) {
			return payload{Title: "one"}, 1, nil
		}); err != nil {
		t.Fatalf("first: %v", err)
	}

	// Returning the first result here would silently answer a question the caller did
	// not ask.
	_, _, err := domain.Idempotent(ctx, svc, f.WorkspaceID,
		domain.IdempotencyKey{ClientID: clientID, OpID: opID, Request: map[string]any{"title": "two"}},
		func(ctx context.Context) (payload, int64, error) {
			return payload{Title: "two"}, 2, nil
		})
	if err == nil {
		t.Fatal("reusing an opId for different arguments must be rejected")
	}
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Errorf("expected a validation error, got %s", platform.CodeOf(err))
	}
}

func TestIdempotent_ConcurrentRetriesApplyTheWriteOnce(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	key := domain.IdempotencyKey{ClientID: uuid.New(), OpID: uuid.New(), Request: "same"}

	// The realistic shape of this race is a flaky connection: the client retries while
	// the original request is still in flight.
	var mu sync.Mutex
	runs := 0

	const callers = 8
	var wg sync.WaitGroup
	errs := make([]error, callers)
	for i := range callers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, err := domain.Idempotent(ctx, svc, f.WorkspaceID, key,
				func(ctx context.Context) (payload, int64, error) {
					mu.Lock()
					runs++
					mu.Unlock()
					return payload{ID: uuid.New(), Title: "once"}, 42, nil
				})
			errs[i] = err
		}(i)
	}
	wg.Wait()

	if runs != 1 {
		t.Fatalf("the mutation ran %d times under concurrent retries; it must run exactly once", runs)
	}

	// Losers either replay the recorded result or are told it is still in progress.
	// Both are correct; silently applying the write again is not.
	succeeded := 0
	for _, err := range errs {
		switch {
		case err == nil:
			succeeded++
		case platform.CodeOf(err) == platform.CodeConflict:
			// still in flight — the client retries
		default:
			t.Errorf("unexpected error from a concurrent retry: %v", err)
		}
	}
	if succeeded == 0 {
		t.Error("at least the winning caller must get the result back")
	}
}

func TestIdempotent_WithoutAKeyAlwaysRuns(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// Integrations, the seeder and cron jobs have no client outbox and therefore no key.
	// Demanding one would mean inventing a throwaway at every such call site, and a
	// throwaway key protects nothing.
	runs := 0
	for range 3 {
		if _, _, err := domain.Idempotent(ctx, svc, f.WorkspaceID, domain.IdempotencyKey{},
			func(ctx context.Context) (payload, int64, error) {
				runs++
				return payload{}, 1, nil
			}); err != nil {
			t.Fatalf("unkeyed call: %v", err)
		}
	}
	if runs != 3 {
		t.Fatalf("an unkeyed mutation ran %d times, want 3", runs)
	}
}
