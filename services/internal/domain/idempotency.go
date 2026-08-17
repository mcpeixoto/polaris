package domain

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Mutation idempotency.
//
// Every client mutation carries (clientId, opId). If the response is lost on the wire —
// a laptop lid closing, a proxy timing out, a deploy mid-flight — the client retries from
// its durable outbox. Without this table that retry creates a second issue, and the user
// sees a duplicate they did not make and cannot explain.
//
// The guarantee is: for a given (clientId, opId) the write happens at most once, and
// every caller gets the same answer.

// IdempotencyTTL is how long a completed result is replayable.
//
// Longer than any plausible retry window and shorter than anything that would make the
// table grow without bound. A client offline for more than a day re-bootstraps anyway,
// which discards its outbox.
const IdempotencyTTL = 24 * time.Hour

// inFlightGrace is how long a claimed-but-unfinished key is treated as still running.
//
// The window it covers is a process dying between claiming the key and recording the
// result. Inside the grace period a retry is told to wait, because the original may still
// be committing; after it, the key is assumed abandoned and the retry takes it over. The
// alternative — no grace at all — would let a client's own retry race the request it is
// retrying and apply the write twice, which is the exact thing being prevented.
const inFlightGrace = 30 * time.Second

// IdempotencyKey identifies one client operation.
type IdempotencyKey struct {
	ClientID uuid.UUID
	OpID     uuid.UUID
	// Request is hashed to detect a client reusing an opId for a different mutation,
	// which would otherwise return somebody else's result.
	Request any
}

// Idempotent runs fn at most once per (ClientID, OpID) and replays the recorded result
// on any repeat.
//
// It is generic over the result type so a caller gets its own struct back rather than an
// `any` it has to assert — an assertion that would only fail at runtime, in production,
// on the retry path that is least likely to be exercised in testing.
//
// A zero ClientID or OpID means the caller is not a syncing client (an integration, a
// script, the seeder) and fn simply runs. Requiring the key everywhere would mean
// generating a throwaway one at every non-client call site, and a throwaway key protects
// nothing.
func Idempotent[T any](
	ctx context.Context,
	s *Service,
	workspaceID uuid.UUID,
	key IdempotencyKey,
	fn func(context.Context) (T, int64, error),
) (T, int64, error) {
	var zero T

	if key.ClientID == uuid.Nil || key.OpID == uuid.Nil {
		return fn(ctx)
	}

	hash := hashRequest(key.Request)
	q := s.db.Queries()

	claimed, err := q.ClaimIdempotencyKey(ctx, store.ClaimIdempotencyKeyParams{
		ClientID:    key.ClientID,
		OpID:        key.OpID,
		WorkspaceID: workspaceID,
		RequestHash: hash,
		ExpiresAt:   time.Now().Add(IdempotencyTTL),
	})
	if err != nil {
		return zero, 0, platform.Internal(err)
	}

	if claimed == 0 {
		// Somebody already holds this key: either this is a genuine retry of a completed
		// operation, or the original is still running.
		return replay[T](ctx, q, key, hash)
	}

	result, version, err := fn(ctx)
	if err != nil {
		// Release the claim so the client's retry runs the mutation rather than reading
		// an empty result and believing the write succeeded.
		if relErr := q.ReleaseIdempotencyKey(ctx, store.ReleaseIdempotencyKeyParams{
			ClientID: key.ClientID, OpID: key.OpID,
		}); relErr != nil {
			platform.Log(ctx).Error("could not release idempotency key after a failed mutation",
				"client_id", key.ClientID, "op_id", key.OpID, "error", relErr)
		}
		return zero, 0, err
	}

	encoded, mErr := json.Marshal(result)
	if mErr != nil {
		return zero, 0, platform.Internal(mErr)
	}
	if err := q.CompleteIdempotencyKey(ctx, store.CompleteIdempotencyKeyParams{
		ClientID: key.ClientID,
		OpID:     key.OpID,
		Result:   encoded,
		Version:  &version,
	}); err != nil {
		// The write itself committed. Failing the response now would make the client
		// retry a mutation that already happened and — because the key was not recorded —
		// apply it twice. Returning success with a logged warning is the lesser evil:
		// the only thing lost is replay protection for this one operation.
		platform.Log(ctx).Error("mutation committed but its idempotency key was not recorded",
			"client_id", key.ClientID, "op_id", key.OpID, "error", err)
	}

	return result, version, nil
}

func replay[T any](
	ctx context.Context, q *store.Queries, key IdempotencyKey, hash []byte,
) (T, int64, error) {
	var zero T

	existing, err := q.GetIdempotencyKey(ctx, store.GetIdempotencyKeyParams{
		ClientID: key.ClientID, OpID: key.OpID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			// It expired between the failed claim and this read. Vanishingly rare, and a
			// plain retry resolves it.
			return zero, 0, platform.Conflict("that operation is no longer replayable; please retry")
		}
		return zero, 0, platform.Internal(err)
	}

	// A reused opId carrying different arguments is a client bug. Returning the earlier
	// result would silently answer a question the caller did not ask.
	if !equalHash(existing.RequestHash, hash) {
		return zero, 0, platform.Validation("opId",
			"this operation id was already used for a different request")
	}

	if len(existing.Result) == 0 || string(existing.Result) == "{}" {
		if time.Since(existing.CreatedAt) < inFlightGrace {
			return zero, 0, platform.Conflict("that operation is still in progress")
		}
		// Past the grace period the original is assumed dead. The claim is cleared so the
		// caller's next attempt runs the mutation for real.
		if err := q.ReleaseIdempotencyKey(ctx, store.ReleaseIdempotencyKeyParams{
			ClientID: key.ClientID, OpID: key.OpID,
		}); err != nil {
			return zero, 0, platform.Internal(err)
		}
		return zero, 0, platform.Conflict("that operation was interrupted; please retry")
	}

	var result T
	if err := json.Unmarshal(existing.Result, &result); err != nil {
		return zero, 0, platform.Internal(err)
	}
	var version int64
	if existing.Version != nil {
		version = *existing.Version
	}
	return result, version, nil
}

func hashRequest(v any) []byte {
	// A nil request still gets a stable hash, so a caller that does not pass one is not
	// treated as a mismatch on every retry.
	b, err := json.Marshal(v)
	if err != nil {
		b = []byte("unhashable")
	}
	sum := sha256.Sum256(b)
	return sum[:]
}

func equalHash(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	// Not constant-time on purpose: both sides are hashes of data the caller already
	// supplied, so there is no secret here to leak through timing.
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// PruneIdempotencyKeys removes expired keys. Run daily by the worker.
func (s *Service) PruneIdempotencyKeys(ctx context.Context) (int64, error) {
	n, err := s.db.Queries().DeleteExpiredIdempotencyKeys(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

// PruneExpiredSessions removes long-dead refresh tokens.
func (s *Service) PruneExpiredSessions(ctx context.Context) (int64, error) {
	n, err := s.db.Queries().DeleteExpiredSessions(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}
