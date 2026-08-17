// Package ratelimit holds the per-caller budgets the API spends: one token bucket per
// caller per class of traffic, kept in this process's memory.
//
// # Why memory and not Valkey
//
// docs/05-infrastructure/04-data-layer.md sketches these counters as `INCR` + `EXPIRE` in
// Valkey, and for the multi-process cloud deployment that is where they will end up. They
// are not there today, on purpose. Polaris is self-hostable as a single process — that is
// the promise docs/05-infrastructure/10-self-host-and-cloud.md makes, and the same promise
// that keeps SMTP optional — and a rate limiter is exactly the wrong feature to buy a hard
// runtime dependency for. A limiter that fails closed when Valkey blinks locks everybody
// out of their issue tracker over a component that was protecting it from nobody; one that
// fails open is a limiter that stops existing under precisely the load that makes an
// attacker worth having. In one process, a map and a mutex have neither failure mode.
//
// # What changes with more than one API process
//
// Each process holds its own buckets, so N processes behind a load balancer enforce, in the
// worst case, N times the configured limit — a caller whose requests are spread evenly
// across the fleet gets each process's full budget. That is a real weakening and it is worth
// stating plainly rather than papering over:
//
//   - It is bounded and predictable. Two processes means at most twice the limit, not an
//     unbounded one, and the defaults are set well above what a human generates, so the
//     property that matters (one runaway integration cannot take the box down) survives.
//   - It does not weaken the login guard as much as it looks. Sticky sessions or a
//     hash-on-source-IP balancer, both of which every reverse proxy in front of this thing
//     supports, pin a caller to one process and restore exact enforcement.
//   - The fix is a shared Store implementation behind the same [Limiter] API — the bucket
//     arithmetic below is the same arithmetic a Lua script in Valkey would run — and not a
//     redesign of the callers.
//
// Writing that as a comment rather than inventing a pluggable backend now is deliberate: a
// storage abstraction with one implementation is a guess about the second one, and the guess
// is usually wrong in a way that is more expensive to unpick than the interface was to add.
package ratelimit

import (
	"cmp"
	"math"
	"slices"
	"sync"
	"time"
)

// Limit describes one class of traffic.
//
// Stated as "Burst tokens, refilled over Per" rather than as a rate, because that is how
// every limit in docs/03-platform/01-graphql-api.md is written ("5,000 per hour") and how an
// operator thinks about the environment variable they are setting. The bucket's capacity and
// the period's budget are the same number, which is what makes a leaky bucket behave the way
// the published limits describe: a caller may spend an hour's worth at once, and then earns
// it back at the rate they are entitled to.
type Limit struct {
	// Name is the class as the caller sees it. It travels on every [Decision] and ends up in
	// the X-RateLimit-<Name>-* headers, so that the transport never has to repeat at a call
	// site which bucket it just consulted — which is how a response ends up reporting one
	// budget's numbers under another budget's name.
	Name string

	// Burst is the bucket's capacity, in whatever unit the class counts — requests for the
	// counting limiters, complexity points for the GraphQL budget.
	Burst float64

	// Per is how long a full bucket takes to refill from empty.
	Per time.Duration
}

// Off reports a class an operator has switched off. Setting either number to zero disables
// that budget rather than making it impossible to satisfy, because "0" is what somebody
// types when they mean "do not do this to me" — and a limiter that reads it as "nobody may
// ever call" would take a self-hosted install down at the exact moment its operator was
// trying to make it more permissive.
func (l Limit) Off() bool { return l.Burst <= 0 || l.Per <= 0 }

func (l Limit) perSecond() float64 {
	if l.Off() {
		return 0
	}
	return l.Burst / l.Per.Seconds()
}

// Decision is the answer to one question about one caller, and carries everything the HTTP
// layer needs to answer them: whether to serve the request, and — when not — when it is
// worth coming back. A limiter that refuses without saying when forces every client into a
// retry loop, which is more load than the request it refused.
type Decision struct {
	OK bool

	// Class is the Limit's Name, carried along so the caller does not have to remember which
	// bucket it asked.
	Class string

	// Limit is the class's capacity and Remaining the caller's balance, both after this
	// decision. Remaining is clamped at zero: a caller in debt is told they have nothing,
	// which is true, and the size of their debt is not their business.
	Limit     float64
	Remaining float64

	// RetryAfter is how long until the balance would cover what was asked for. Zero when OK.
	RetryAfter time.Duration

	// Reset is how long until the bucket is full again — the number the
	// X-RateLimit-*-Reset headers carry.
	Reset time.Duration
}

// defaultMaxEntries bounds a single class's map when the caller does not say otherwise.
// 100,000 buckets is around 10 MB, which is nothing next to what refusing to bound it costs
// a process that has been up for a month.
const defaultMaxEntries = 100_000

// minSweepSize keeps small installs from sweeping constantly. Below this many buckets there
// is nothing worth reclaiming and the walk costs more than the memory it frees.
const minSweepSize = 512

// Limiter is one class of traffic's buckets, keyed by caller.
//
// One Limiter per class rather than one with composite keys, so each class's map is bounded
// on its own: a flood of invented email addresses against the login guard cannot evict the
// bucket that is throttling somebody's runaway integration.
type Limiter struct {
	limit Limit
	rate  float64
	max   int

	// now is injectable so the tests can advance time without sleeping. A limiter test that
	// sleeps is a test that is either slow or flaky, and usually both.
	now func() time.Time

	// One mutex, not a sharded map. The critical section is a handful of float operations
	// with no allocation and no syscall — tens of nanoseconds — so contention only becomes
	// the bottleneck at a request rate several orders of magnitude above what a process
	// holding a Postgres pool of ten connections can serve. Sharding this would be a
	// measurable amount of extra code buying an unmeasurable amount of throughput.
	mu      sync.Mutex
	buckets map[string]bucket

	// nextSweep is the map size at which the next eviction pass runs. Recomputed after each
	// pass so the O(n) walk is amortised over O(n) insertions rather than run on every one.
	nextSweep int
}

// bucket is a caller's balance and the moment it was last brought up to date. Stored by
// value: a map of two-word structs costs one allocation for the map's backing array rather
// than one per caller, and a caller here is "every IP that has ever touched /auth/login".
type bucket struct {
	tokens float64
	at     time.Time
}

// New builds a limiter for one class. maxEntries bounds how many callers it will remember;
// zero takes [defaultMaxEntries].
func New(limit Limit, maxEntries int) *Limiter {
	if maxEntries <= 0 {
		maxEntries = defaultMaxEntries
	}
	return &Limiter{
		limit:     limit,
		rate:      limit.perSecond(),
		max:       maxEntries,
		now:       time.Now,
		buckets:   make(map[string]bucket),
		nextSweep: min(minSweepSize, maxEntries),
	}
}

// Allow charges cost to the caller if they can afford it, and refuses without charging if
// they cannot. This is the ordinary path: a request is either served and paid for, or it is
// not served and costs nothing.
func (l *Limiter) Allow(key string, cost float64) Decision {
	if l.limit.Off() {
		return l.unlimited()
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b := l.refill(l.buckets[key], now)
	if b.tokens < cost {
		l.save(key, b, now)
		return l.decide(b, false, cost)
	}
	b.tokens -= cost
	l.save(key, b, now)
	return l.decide(b, true, cost)
}

// Check reports whether the caller could afford cost, without charging them.
//
// It exists for the complexity budget, which cannot know what a request costs until gqlgen
// has measured the query — so admission asks "is there anything left" here, and the real
// price is charged with [Limiter.Spend] once it is known. An unseen caller is answered from
// a notional full bucket and no entry is created, so a read-only check is never a way to
// grow the map.
func (l *Limiter) Check(key string, cost float64) Decision {
	if l.limit.Off() {
		return l.unlimited()
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	b, seen := l.buckets[key]
	if !seen {
		return l.decide(bucket{tokens: l.limit.Burst}, l.limit.Burst >= cost, cost)
	}
	now := l.now()
	b = l.refill(b, now)
	// Written back rather than discarded: refilling is idempotent, and keeping the bucket
	// current means the next writer does less arithmetic. The key already exists, so this
	// cannot grow the map and needs no sweep.
	l.buckets[key] = b
	return l.decide(b, b.tokens >= cost, cost)
}

// Spend charges cost whether or not the caller can afford it, taking them into debt.
//
// Debt is the point. The alternative — clamping the balance at zero — would mean a query
// that cost 9,000 points is charged only what happened to be left in the bucket, so the most
// expensive queries in the system would be the ones that go under-billed. A caller who
// overspends waits exactly as long as the overspend deserves.
//
// The debt is floored at one full bucket, so the worst a single request can do is cost its
// caller one refill period. Without that floor a client retrying a huge query in a loop
// could bury itself for days, and the operator's only recovery would be a restart.
func (l *Limiter) Spend(key string, cost float64) Decision {
	if l.limit.Off() {
		return l.unlimited()
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b := l.refill(l.buckets[key], now)
	b.tokens = math.Max(-l.limit.Burst, b.tokens-cost)
	l.save(key, b, now)
	return l.decide(b, b.tokens >= 0, cost)
}

// Len is the number of callers currently remembered. Exported for the tests that assert the
// map stays bounded, and for whatever exposes limiter size as a metric later.
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

func (l *Limiter) unlimited() Decision {
	return Decision{OK: true, Class: l.limit.Name, Limit: l.limit.Burst, Remaining: l.limit.Burst}
}

// refill brings a bucket up to `now`. A zero bucket — the one a map returns for a caller
// never seen — starts full, which is what makes a first request always succeed.
func (l *Limiter) refill(b bucket, now time.Time) bucket {
	if b.at.IsZero() {
		return bucket{tokens: l.limit.Burst, at: now}
	}
	if elapsed := now.Sub(b.at); elapsed > 0 {
		b.tokens = math.Min(l.limit.Burst, b.tokens+elapsed.Seconds()*l.rate)
		b.at = now
	}
	return b
}

func (l *Limiter) decide(b bucket, ok bool, cost float64) Decision {
	d := Decision{
		OK:        ok,
		Class:     l.limit.Name,
		Limit:     l.limit.Burst,
		Remaining: math.Max(0, b.tokens),
	}
	if l.rate > 0 {
		d.Reset = secondsToDuration((l.limit.Burst - b.tokens) / l.rate)
		if !ok {
			d.RetryAfter = secondsToDuration((cost - b.tokens) / l.rate)
		}
	}
	return d
}

// secondsToDuration converts a computed wait, defensively.
//
// The clamp is not theoretical: an operator who sets a period in the thousands of hours makes
// the refill rate small enough that a wait in seconds overflows an int64 of nanoseconds, and a
// time.Duration built from an out-of-range float is whatever the conversion happens to
// produce — including a negative number, which would be reported as "retry immediately".
func secondsToDuration(s float64) time.Duration {
	const maxSeconds = float64(math.MaxInt64) / float64(time.Second)
	switch {
	case s <= 0 || math.IsNaN(s):
		return 0
	case s >= maxSeconds || math.IsInf(s, 1):
		return time.Duration(math.MaxInt64)
	default:
		return time.Duration(s * float64(time.Second))
	}
}

// save stores a bucket and reclaims memory when the map has grown since the last pass.
func (l *Limiter) save(key string, b bucket, now time.Time) {
	l.buckets[key] = b
	if len(l.buckets) > l.nextSweep {
		l.evict(now)
	}
}

// evict bounds the map.
//
// A map keyed by caller that only ever grows is a slow leak, and the callers here are not a
// closed set: an unauthenticated endpoint is keyed by IP, and the login guard is keyed by
// whatever email address somebody typed. Both are supplied by the caller, so both are
// unbounded by construction.
//
// Two passes, in order of how much they cost and how much information they destroy.
//
// Pass one is free of behavioural change. A bucket that has refilled to capacity is
// arithmetically indistinguishable from a caller this process has never seen — both answer
// every future question with a full bucket — so deleting it cannot change any decision the
// limiter would make. This is the pass that does the work: it holds the map at roughly "the
// distinct callers seen within one refill period", which for every real install is a number
// with three digits in it.
//
// Pass two only runs when pass one was not enough, which means somebody is cycling through
// keys faster than they refill — millions of forged X-Forwarded-For values, or a dictionary
// of email addresses. Here something informative has to go, and *which* something is the
// whole decision: evicting arbitrarily would hand the attacker a way to clear their own
// throttled bucket by flooding the map with new keys, which turns the bound into the bypass.
// So the fullest buckets go first. They are the ones closest to carrying no information
// anyway, they belong to the callers least likely to be refused next, and the attacker's own
// bucket — the emptiest in the map — is the very last thing evicted.
func (l *Limiter) evict(now time.Time) {
	for k, b := range l.buckets {
		if l.refill(b, now).tokens >= l.limit.Burst {
			delete(l.buckets, k)
		}
	}
	if len(l.buckets) > l.max {
		l.evictFullest(now)
	}

	// Sweep again once the map has doubled. Amortised, an insertion pays O(1) for the walk
	// it eventually triggers. The cap keeps the threshold from drifting above the bound it
	// is supposed to enforce.
	l.nextSweep = min(max(2*len(l.buckets), minSweepSize), l.max)
}

func (l *Limiter) evictFullest(now time.Time) {
	// Down to three quarters rather than exactly to the cap, so the next insertion does not
	// immediately trigger another full walk.
	target := l.max * 3 / 4

	type entry struct {
		key    string
		tokens float64
	}
	entries := make([]entry, 0, len(l.buckets))
	for k, b := range l.buckets {
		entries = append(entries, entry{key: k, tokens: l.refill(b, now).tokens})
	}
	// Descending: b before a, so the fullest bucket sorts first and is deleted first.
	slices.SortFunc(entries, func(a, b entry) int { return cmp.Compare(b.tokens, a.tokens) })
	for _, e := range entries[:len(entries)-target] {
		delete(l.buckets, e.key)
	}
}
