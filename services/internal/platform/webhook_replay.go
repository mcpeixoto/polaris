package platform

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"sync"
	"time"
)

// Replay protection for inbound webhooks.
//
// Every inbound integration Polaris has authenticates a delivery by proving *who sent it*
// and never *that it is new*:
//
//   - GitHub signs the body with HMAC-SHA256. `X-GitHub-Delivery` is a per-delivery UUID and
//     nothing in this repository has ever read it.
//   - GitLab sends a shared token and no signature at all.
//   - Sentry signs the body with HMAC-SHA256 for integration-platform hooks, and sends a
//     bare token for alert-rule hooks.
//
// A signature over a body is a signature over a body forever. Anyone holding a captured
// request — from a proxy log, a mirrored error report, an over-eager APM trace — can post it
// again and it verifies, because it is the same bytes and the same MAC.
//
// Sentry's handler looked like it had an answer to this and did not. SentryTimestampOK
// enforces a sixty-second window on Sentry-Hook-Timestamp, but that header is NOT covered by
// the MAC — Sentry hashes the raw body and nothing else — so a replayer supplies whatever
// timestamp they like alongside the captured body and the window is satisfied. A check on an
// unauthenticated input is a check on the attacker's own claim.
//
// # What this does instead
//
// The delivery is remembered by a digest of the bytes that were actually authenticated, and
// a second delivery of the same bytes is a no-op. The key is the body's SHA-256 rather than
// any header, and that choice is the whole design: the body is the one part of the request
// the signature covers, so a replayer cannot vary it, while `X-GitHub-Delivery`,
// `Request-ID` and `Sentry-Hook-Timestamp` are all free text they can change at will.
//
// # What this does not do
//
// It is not a defence against somebody who holds the shared secret. A GitLab token or an
// X-Sentry-Token is in the header of any request they captured, so they can forge fresh
// bodies rather than replay old ones, and no amount of deduplication helps. Against those
// two the honest statement is that the token is the whole of the security and it must be
// rotated if a delivery ever leaks. Deduplication still earns its place there as idempotency.
//
// It is also per-process and in-memory. Polaris self-hosts as a single `Polaris_api`
// container, so today that is the whole system; run two replicas behind a load balancer and
// a replay aimed at the other one is not seen. Making it durable means a table and a
// migration, which is a deliberate non-goal here — this closes the hole for the deployment
// the product actually ships as, and says plainly where the boundary is.
type ReplayGuard struct {
	mu   sync.Mutex
	ttl  time.Duration
	max  int
	seen map[string]time.Time
}

const (
	// Long enough that a captured delivery has gone stale before it is forgotten, short
	// enough that the map is bounded by ordinary traffic. Redeliveries in anger — the
	// GitHub "Redeliver" button after a bug fix — happen in minutes, not days, and are
	// meant to be refused: the point of pressing it is that the first attempt did not take
	// effect, and a delivery that did not take effect was never recorded here.
	defaultReplayTTL = 24 * time.Hour

	// A ceiling so a flood cannot turn the guard into the outage. Eviction is oldest-first,
	// so the entries lost are the ones closest to expiring anyway.
	defaultReplayMax = 50_000
)

func NewReplayGuard() *ReplayGuard {
	return NewReplayGuardWith(defaultReplayTTL, defaultReplayMax)
}

func NewReplayGuardWith(ttl time.Duration, max int) *ReplayGuard {
	if ttl <= 0 {
		ttl = defaultReplayTTL
	}
	if max <= 0 {
		max = defaultReplayMax
	}
	return &ReplayGuard{ttl: ttl, max: max, seen: make(map[string]time.Time)}
}

// WebhookDeliveryKey names one delivery: a provider, the route's scope, and the body.
//
// The scope keeps two workspaces apart. Without it, two installs of the same integration
// receiving a byte-identical payload would have the second one silently dropped as a replay
// of the first — a deduplication bug that looks exactly like a missing webhook.
func WebhookDeliveryKey(provider, scope string, body []byte) string {
	sum := sha256.Sum256(body)
	return provider + "/" + scope + "/" + hex.EncodeToString(sum[:])
}

// Seen reports whether this delivery has already been handled to completion.
//
// It does not record anything. Recording on arrival would mean a delivery that failed
// halfway — a database blip, a restart mid-ingest — is remembered as done and its retry is
// refused, turning a transient error into permanent data loss. The pair is deliberately
// check-on-arrival, Record-on-success.
func (g *ReplayGuard) Seen(key string, now time.Time) bool {
	if g == nil {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	at, ok := g.seen[key]
	if !ok {
		return false
	}
	if now.Sub(at) > g.ttl {
		delete(g.seen, key)
		return false
	}
	return true
}

// Record marks a delivery handled. Call it only once the work actually succeeded.
//
// Two identical requests arriving concurrently can both pass Seen before either Records, and
// both will be processed. That race is left open on purpose: closing it means claiming the
// key before the work, which is the failure mode Seen's comment describes, and the ingest
// paths behind this are already idempotent on their own keys — a Sentry issue links by URL,
// a pull request by number. This guard exists to stop deliberate re-posting, not to be the
// only thing standing between the product and a duplicate row.
func (g *ReplayGuard) Record(key string, now time.Time) {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.seen[key] = now
	if len(g.seen) <= g.max {
		return
	}
	for k, at := range g.seen {
		if now.Sub(at) > g.ttl {
			delete(g.seen, k)
		}
	}
	if len(g.seen) <= g.max {
		return
	}
	// Down to nine tenths in one pass rather than one entry per call. Evicting a single
	// oldest key each time would leave the map pinned at the ceiling and make every
	// subsequent delivery pay a full scan — a flood would then be paying for its own
	// amplification.
	keys := make([]string, 0, len(g.seen))
	for k := range g.seen {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return g.seen[keys[i]].Before(g.seen[keys[j]]) })
	for _, k := range keys[:len(g.seen)-(g.max*9/10)] {
		delete(g.seen, k)
	}
}
