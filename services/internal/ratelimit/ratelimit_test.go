package ratelimit

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// clock is a hand-wound time source. A limiter test that sleeps to observe a refill is slow
// when it passes and flaky when the machine is busy, and the thing it is testing — arithmetic
// on a duration — is exactly the thing that does not need real time to be exercised.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *clock {
	return &clock{t: time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)}
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func wound(limit Limit, maxEntries int) (*Limiter, *clock) {
	c := newClock()
	l := New(limit, maxEntries)
	l.now = c.now
	return l, c
}

func TestAllow_SpendsTheBudgetAndThenRefuses(t *testing.T) {
	l, _ := wound(Limit{Name: "test", Burst: 3, Per: 3 * time.Second}, 0)

	for i := range 3 {
		if d := l.Allow("caller", 1); !d.OK {
			t.Fatalf("request %d was refused with %v remaining, but the bucket held 3", i, d.Remaining)
		}
	}

	d := l.Allow("caller", 1)
	if d.OK {
		t.Fatal("a fourth request was allowed out of a bucket of three")
	}
	// The whole point of the header this feeds: a refusal that does not say when to come
	// back turns one refused client into a retry loop.
	if d.RetryAfter != time.Second {
		t.Errorf("RetryAfter = %v, want 1s — one token refills in a third of the period", d.RetryAfter)
	}
	if d.Remaining != 0 {
		t.Errorf("Remaining = %v, want 0", d.Remaining)
	}
}

func TestAllow_RefusingCostsNothing(t *testing.T) {
	l, c := wound(Limit{Name: "test", Burst: 2, Per: 2 * time.Second}, 0)

	l.Allow("caller", 1)
	l.Allow("caller", 1)
	for range 100 {
		if l.Allow("caller", 1).OK {
			t.Fatal("an empty bucket allowed a request")
		}
	}

	// If refusals were charged, a hundred of them would have buried this caller for a
	// hundred seconds. A refused request is not served, so it must not be billed.
	c.advance(time.Second)
	if !l.Allow("caller", 1).OK {
		t.Fatal("one token's worth of time did not buy one token back")
	}
}

func TestAllow_RefillsAtTheConfiguredRateAndStopsAtFull(t *testing.T) {
	l, c := wound(Limit{Name: "test", Burst: 10, Per: 10 * time.Second}, 0)

	for range 10 {
		l.Allow("caller", 1)
	}
	c.advance(4 * time.Second)

	for i := range 4 {
		if !l.Allow("caller", 1).OK {
			t.Fatalf("only %d of 4 refilled tokens were spendable", i)
		}
	}
	if l.Allow("caller", 1).OK {
		t.Fatal("a fifth token appeared out of four seconds")
	}

	// An idle week must not accumulate a week's worth of credit — that would let one caller
	// bank a month of budget and spend it in a second.
	c.advance(7 * 24 * time.Hour)
	allowed := 0
	for range 100 {
		if l.Allow("caller", 1).OK {
			allowed++
		}
	}
	if allowed != 10 {
		t.Errorf("an idle week banked %d tokens, want the bucket's capacity of 10", allowed)
	}
}

func TestLimiter_CallersAreIndependent(t *testing.T) {
	l, _ := wound(Limit{Name: "test", Burst: 1, Per: time.Minute}, 0)

	if !l.Allow("alice", 1).OK {
		t.Fatal("alice's first request was refused")
	}
	if l.Allow("alice", 1).OK {
		t.Fatal("alice spent a budget of one twice")
	}
	if !l.Allow("bob", 1).OK {
		t.Fatal("bob was refused because alice had been busy — the whole feature is per-caller")
	}
}

// The complexity budget's shape: admission asks whether there is anything left, the real
// price is charged once gqlgen has measured the query, and an expensive caller is slowed in
// proportion to what they actually spent rather than to how many requests they sent.
func TestSpend_ChargesInProportionSoTheExpensiveCallerWaitsLonger(t *testing.T) {
	l, _ := wound(Limit{Name: "complexity", Burst: 1000, Per: 1000 * time.Second}, 0)

	l.Spend("cheap", 10)
	l.Spend("expensive", 900)

	cheap := l.Check("cheap", 1)
	expensive := l.Check("expensive", 1)
	if !cheap.OK || !expensive.OK {
		t.Fatal("neither caller is over budget yet")
	}
	if cheap.Remaining <= expensive.Remaining {
		t.Fatalf("cheap has %v left and expensive %v — the expensive caller must be closer to the wall",
			cheap.Remaining, expensive.Remaining)
	}

	// Ninety more cheap requests cost exactly what the one expensive request did, and now
	// it is the chatty caller who is closer to the wall. This is the case a fixed
	// per-request complexity cap does nothing about: it stops one enormous query and has
	// no opinion at all about a thousand medium ones.
	for range 90 {
		l.Spend("cheap", 10)
	}
	if l.Check("cheap", 1).Remaining >= l.Check("expensive", 1).Remaining {
		t.Fatal("910 points of cheap queries must leave less budget than 900 points of one expensive one")
	}
	for range 10 {
		l.Spend("cheap", 10)
	}
	if l.Check("cheap", 1).OK {
		t.Fatal("a thousand medium queries must exhaust the budget just as one huge one does")
	}
}

func TestSpend_TakesTheCallerIntoBoundedDebt(t *testing.T) {
	l, c := wound(Limit{Name: "complexity", Burst: 100, Per: 100 * time.Second}, 0)

	// One admitted query that costs far more than was left. Clamping at zero would bill it
	// only what happened to remain, so the most expensive query in the system would be the
	// one that went under-billed.
	d := l.Spend("caller", 250)
	if d.OK {
		t.Fatal("overspending must leave the caller over budget")
	}
	if l.Check("caller", 1).OK {
		t.Fatal("the next request must be refused while the debt stands")
	}

	// Debt is floored at one full bucket, so the worst a single request can do to its caller
	// is cost them one refill period — never a day, whatever they asked for.
	c.advance(101 * time.Second)
	if !l.Check("caller", 1).OK {
		t.Fatal("a debt capped at one full bucket outlived a full refill period")
	}
}

func TestCheck_DoesNotCharge_AndDoesNotRememberStrangers(t *testing.T) {
	l, _ := wound(Limit{Name: "test", Burst: 5, Per: 5 * time.Second}, 0)

	for range 1000 {
		if !l.Check("stranger", 1).OK {
			t.Fatal("checking is not spending")
		}
	}
	if n := l.Len(); n != 0 {
		t.Errorf("Len = %d, want 0 — a read-only check must not be a way to grow the map", n)
	}
}

func TestLimit_ZeroMeansOff(t *testing.T) {
	for _, limit := range []Limit{
		{Name: "no-burst", Burst: 0, Per: time.Hour},
		{Name: "no-period", Burst: 100, Per: 0},
	} {
		l, _ := wound(limit, 0)
		for range 100 {
			if !l.Allow("caller", 1).OK {
				t.Fatalf("%s: zero must switch the class off, not make it impossible to satisfy — "+
					"0 is what an operator types when they mean 'stop doing this to me'", limit.Name)
			}
		}
		if n := l.Len(); n != 0 {
			t.Errorf("%s: a switched-off class allocated %d buckets", limit.Name, n)
		}
	}
}

// Concurrency, measured the only way that proves anything: real goroutines racing on one
// limiter, with the total number of successes checked against the budget. Asserting a
// counter from a single goroutine would pass just as happily with no locking at all.
func TestLimiter_ConcurrentCallersSpendExactlyTheBudget(t *testing.T) {
	const budget = 500
	const goroutines = 50
	const each = 40 // 2,000 attempts for 500 tokens

	// A period long enough that no refill can happen while the test runs, so the expected
	// number of successes is exact rather than "about".
	l := New(Limit{Name: "test", Burst: budget, Per: time.Hour}, 0)

	var allowed atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for range each {
				if l.Allow("one-caller", 1).OK {
					allowed.Add(1)
				}
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := allowed.Load(); got != budget {
		t.Errorf("%d requests were allowed out of a budget of %d — a lost update either "+
			"hands out free capacity or throws it away", got, budget)
	}
}

func TestLimiter_ConcurrentDistinctCallersStayBounded(t *testing.T) {
	const maxEntries = 256
	l := New(Limit{Name: "test", Burst: 4, Per: time.Hour}, maxEntries)

	var wg sync.WaitGroup
	for g := range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range 1000 {
				l.Allow(fmt.Sprintf("caller-%d-%d", g, i), 1)
			}
		}()
	}
	wg.Wait()

	// 16,000 distinct callers went through a limiter told to remember 256.
	if n := l.Len(); n > maxEntries {
		t.Errorf("Len = %d after 16,000 distinct callers, want <= %d", n, maxEntries)
	}
}

func TestEvict_DropsRefilledBucketsAndKeepsTheOnesStillPaying(t *testing.T) {
	l, c := wound(Limit{Name: "test", Burst: 4, Per: 10 * time.Second}, 0)

	for i := range 50 {
		l.Allow(fmt.Sprintf("caller-%d", i), 1)
	}
	if n := l.Len(); n != 50 {
		t.Fatalf("Len = %d, want 50 before anything is reclaimed", n)
	}

	// Nothing has refilled yet, so nothing may be forgotten: forgetting a bucket that is
	// still down a token would hand its owner that token back for free.
	l.mu.Lock()
	l.evict(c.now())
	l.mu.Unlock()
	if n := l.Len(); n != 50 {
		t.Fatalf("Len = %d after sweeping buckets that are still in credit-debt, want 50", n)
	}

	// Once a bucket is full again it is arithmetically indistinguishable from a caller
	// never seen, so dropping it is free.
	c.advance(10 * time.Second)
	l.mu.Lock()
	l.evict(c.now())
	l.mu.Unlock()
	if n := l.Len(); n != 0 {
		t.Errorf("Len = %d after every bucket refilled to capacity, want 0", n)
	}
}

// The security property of the bound. If the map evicted arbitrarily, flooding it with fresh
// keys would clear your own throttled bucket — and the memory bound would be the bypass.
func TestEvict_AFloodOfNewKeysCannotClearAThrottledCaller(t *testing.T) {
	const maxEntries = 64
	l, _ := wound(Limit{Name: "test", Burst: 8, Per: time.Hour}, maxEntries)

	for range 8 {
		l.Allow("attacker", 1)
	}
	if l.Allow("attacker", 1).OK {
		t.Fatal("the attacker should be out of budget before the flood")
	}

	// Ten thousand invented keys, each spending a little so none of them is full and pass
	// one cannot reclaim them. This is the shape of a forged X-Forwarded-For flood.
	for i := range 10_000 {
		l.Allow(fmt.Sprintf("forged-%d", i), 1)
	}

	if n := l.Len(); n > maxEntries {
		t.Errorf("Len = %d, want <= %d", n, maxEntries)
	}
	if l.Allow("attacker", 1).OK {
		t.Fatal("flooding the map with new keys cleared the attacker's own bucket")
	}
}

func TestDecision_ReportsTheHeadersTheClientNeeds(t *testing.T) {
	l, _ := wound(Limit{Name: "test", Burst: 100, Per: 100 * time.Second}, 0)

	d := l.Allow("caller", 40)
	if d.Limit != 100 {
		t.Errorf("Limit = %v, want 100", d.Limit)
	}
	if d.Remaining != 60 {
		t.Errorf("Remaining = %v, want 60", d.Remaining)
	}
	if d.Reset != 40*time.Second {
		t.Errorf("Reset = %v, want 40s — the time to refill the 40 spent", d.Reset)
	}
	if d.RetryAfter != 0 {
		t.Errorf("RetryAfter = %v on an allowed request, want 0", d.RetryAfter)
	}

	if d := l.Allow("caller", 100); d.RetryAfter != 40*time.Second {
		t.Errorf("RetryAfter = %v, want 40s — the time until 100 tokens exist again", d.RetryAfter)
	}
}
