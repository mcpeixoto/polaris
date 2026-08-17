package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The limiter is the one piece of this transport whose failure modes point in both
// directions: too loose and one looping integration takes the process down, too tight and
// three people on a self-hosted box cannot use their issue tracker. Every case below is one
// of those two.

// tightConfig is a configuration nobody would run, chosen so a test can reach a wall in a
// handful of requests without sleeping. The periods are long so nothing refills mid-test.
func tightConfig() platform.Config {
	return platform.Config{
		RateLimitEnabled:           true,
		RateLimitGraphQLRequests:   3,
		RateLimitGraphQLComplexity: 10_000,
		RateLimitGraphQLPeriod:     time.Hour,
		RateLimitLoginAttempts:     2,
		RateLimitLoginPeriod:       10 * time.Minute,
		RateLimitAnonRequests:      2,
		RateLimitAnonPeriod:        time.Minute,
		RateLimitBootstraps:        2,
		RateLimitBootstrapPeriod:   10 * time.Minute,
		RateLimitMaxCallers:        1000,
	}
}

func reached() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("reached"))
	})
}

// asUser returns a request carrying a resolved principal, which is what Authenticate would
// have put there and what the limiter keys on.
func asUser(userID uuid.UUID) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	return r.WithContext(authz.WithPrincipal(r.Context(), &authz.Principal{
		UserID:      userID,
		AccountID:   uuid.New(),
		WorkspaceID: uuid.New(),
		Role:        authz.RoleMember,
	}))
}

func serve(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("the refusal body was not the shape every other error on this API uses: %v", err)
	}
	return body.Error.Code
}

// A refusal has to be actionable. 429 alone tells a client it lost; Retry-After tells it when
// to come back, and without that every refused client turns into a retry loop — more load
// than the request that was refused.
func TestRateLimit_RefusesWith429AndAUsableRetryAfter(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.GraphQL(reached())
	user := uuid.New()

	for i := range 3 {
		if rec := serve(h, asUser(user)); rec.Code != http.StatusOK {
			t.Fatalf("request %d returned %d, but the budget was 3", i, rec.Code)
		}
	}

	rec := serve(h, asUser(user))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if got := errorCode(t, rec); got != string(platform.CodeRateLimited) {
		t.Errorf("error code = %q, want %q", got, platform.CodeRateLimited)
	}

	retry := rec.Header().Get("Retry-After")
	if retry == "" {
		t.Fatal("no Retry-After — a limiter that will not say when to come back forces a retry loop")
	}
	seconds, err := strconv.Atoi(retry)
	if err != nil || seconds < 1 {
		t.Errorf("Retry-After = %q, want a whole number of seconds of at least 1", retry)
	}
}

func TestRateLimit_CallersDoNotShareABudget(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.GraphQL(reached())

	busy := uuid.New()
	for range 4 {
		serve(h, asUser(busy))
	}
	if rec := serve(h, asUser(busy)); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("the busy caller should be refused by now, got %d", rec.Code)
	}

	if rec := serve(h, asUser(uuid.New())); rec.Code != http.StatusOK {
		t.Fatalf("a second user was refused because the first had been busy (%d) — "+
			"the whole feature is per-caller", rec.Code)
	}
}

// The reason this exists at all. The fixed 10,000-point cap in cmd/api stops one enormous
// query and is perfectly happy to serve a thousand medium ones, so the per-caller budget has
// to be denominated in the same points and spent by the same traffic.
func TestRateLimit_SpendsTheComplexityBudgetNotTheRequestCount(t *testing.T) {
	cfg := tightConfig()
	cfg.RateLimitGraphQLRequests = 1000 // deliberately not the binding limit
	limits := NewLimits(cfg)

	// A handler standing in for the gqlgen extension, which is the only thing that knows
	// what a query actually cost.
	h := limits.GraphQL(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ChargeComplexity(r.Context(), 4000, false)
	}))

	user := uuid.New()
	served := 0
	var last *httptest.ResponseRecorder
	for range 10 {
		last = serve(h, asUser(user))
		if last.Code == http.StatusOK {
			served++
		}
	}

	// 10,000 points at 4,000 apiece: three get in — the third on the last of the budget —
	// and the fourth meets the debt the third left behind.
	if served != 3 {
		t.Errorf("%d expensive requests were served out of a 10,000-point budget at 4,000 each, want 3", served)
	}
	// And the request counter was never the thing refusing: it has spent exactly the three
	// requests that were served, because a refusal on one budget does not bill the other.
	if remaining := last.Header().Get("X-RateLimit-Requests-Remaining"); remaining != "997" {
		t.Errorf("X-RateLimit-Requests-Remaining = %q, want 997 — these were refused by the "+
			"complexity budget, and a test that cannot tell the two apart proves nothing", remaining)
	}
}

func TestRateLimit_MutationsCostMoreThanQueriesOfTheSameShape(t *testing.T) {
	limits := NewLimits(tightConfig())

	remainingAfter := func(isMutation bool) float64 {
		h := limits.GraphQL(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ChargeComplexity(r.Context(), 100, isMutation)
		}))
		rec := serve(h, asUser(uuid.New()))
		got, err := strconv.ParseFloat(rec.Header().Get("X-RateLimit-Complexity-Remaining"), 64)
		if err != nil {
			t.Fatalf("X-RateLimit-Complexity-Remaining = %q: %v",
				rec.Header().Get("X-RateLimit-Complexity-Remaining"), err)
		}
		return got
	}

	query := remainingAfter(false)
	mutation := remainingAfter(true)
	if mutation >= query {
		t.Errorf("a mutation left %v and a query %v — a write's cost is not in its response: "+
			"it is a transaction, a change_log row, a wakeup on every socket in the workspace "+
			"and a notification fan-out, none of which complexity scores", mutation, query)
	}
}

// Every response carries the budget, not only the refusals. A client that can see its
// remaining budget can pace itself; one that only finds out on a 429 cannot.
func TestRateLimit_ReportsBothBudgetsOnASuccessfulResponse(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.GraphQL(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ChargeComplexity(r.Context(), 250, false)
	}))

	rec := serve(h, asUser(uuid.New()))
	for header, want := range map[string]string{
		"X-RateLimit-Requests-Limit":       "3",
		"X-RateLimit-Requests-Remaining":   "2",
		"X-RateLimit-Complexity-Limit":     "10000",
		"X-RateLimit-Complexity-Remaining": "9750",
		"X-Complexity":                     "250",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if rec.Header().Get("X-RateLimit-Requests-Reset") == "" {
		t.Error("no Reset header — Remaining without Reset does not tell a client how to pace itself")
	}
}

// Brute-forcing a password is the attack a rate limiter most obviously exists to stop, and
// the thing under attack is ONE account — so the bucket has to be keyed by the account rather
// than by whoever happens to be doing the guessing.
func TestRateLimit_SignInIsBudgetedPerAccount(t *testing.T) {
	limits := NewLimits(tightConfig())

	attempt := func(email, from string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		r.RemoteAddr = from
		rec := httptest.NewRecorder()
		limits.LoginAttempt(rec, r, email)
		return rec
	}

	attempt("victim@example.com", "1.2.3.4:1111")
	attempt("victim@example.com", "5.6.7.8:2222")

	// A third guess from a third address. Keying this by source address would let a botnet
	// walk a dictionary one attempt per host and never meet a wall.
	rec := attempt("victim@example.com", "9.9.9.9:3333")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 — a distributed guess is still a guess at one account", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("no Retry-After on a refused sign-in")
	}

	// Somebody else signing in is unaffected: a locked-out account must not lock out a
	// workspace.
	if rec := attempt("bystander@example.com", "1.2.3.4:1111"); rec.Code == http.StatusTooManyRequests {
		t.Error("one account's budget was spent by another's")
	}
}

func TestRateLimit_SignInBudgetIsCaseInsensitive(t *testing.T) {
	limits := NewLimits(tightConfig())

	attempt := func(email string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		rec := httptest.NewRecorder()
		limits.LoginAttempt(rec, r, email)
		return rec
	}

	attempt("victim@example.com")
	attempt("  VICTIM@example.com ")
	if rec := attempt("Victim@Example.COM"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 — if the bucket were case-sensitive an attacker would "+
			"get a fresh budget for every capitalisation of the address they are attacking", rec.Code)
	}
}

func TestRateLimit_UnauthenticatedTrafficIsBudgetedPerAddress(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.Anonymous(reached())

	from := func(addr string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/auth/refresh", nil)
		r.RemoteAddr = addr
		return serve(h, r)
	}

	from("1.2.3.4:1111")
	from("1.2.3.4:2222") // same host, different ephemeral port: the same caller
	if rec := from("1.2.3.4:3333"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 — the port is not part of the caller's identity", rec.Code)
	}
	if rec := from("5.6.7.8:1111"); rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 — a different address is a different caller", rec.Code)
	}
}

// The self-hosted install with three people on it, which is the case every default here is
// chosen around: they share one office address, and they must never be throttled as though
// they were one client.
func TestRateLimit_AnAuthenticatedCallerIsNotChargedToTheirOfficesAddress(t *testing.T) {
	limits := NewLimits(tightConfig())
	h := limits.Anonymous(reached())

	office := "203.0.113.7:4000"
	for range 5 {
		r := httptest.NewRequest(http.MethodPost, "/auth/refresh", nil)
		r.RemoteAddr = office
		r = r.WithContext(WithAccount(r.Context(), uuid.New()))
		if rec := serve(h, r); rec.Code != http.StatusOK {
			t.Fatalf("status = %d: signed-in colleagues sharing a NAT were throttled as one caller", rec.Code)
		}
	}
}

func TestRateLimit_BootstrapHasItsOwnBudget(t *testing.T) {
	limits := NewLimits(tightConfig())
	graphQL := limits.GraphQL(reached())
	bootstrap := limits.Bootstrap(reached())
	user := uuid.New()

	// Two snapshots is the whole budget in this configuration; the GraphQL budget is
	// untouched by them, because a snapshot is not an API call and pricing it as one would
	// mean a single resync cost a user a page of ordinary browsing.
	serve(bootstrap, asUser(user))
	serve(bootstrap, asUser(user))
	if rec := serve(bootstrap, asUser(user)); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("bootstrap status = %d, want 429", rec.Code)
	}
	if rec := serve(graphQL, asUser(user)); rec.Code != http.StatusOK {
		t.Errorf("graphql status = %d — the snapshot budget and the API budget are separate", rec.Code)
	}
}

// An operator who has put their own limiter in front of this process needs a way to turn
// this one off, and it has to be a real passthrough rather than a very large number.
func TestRateLimit_DisabledIsATruePassthrough(t *testing.T) {
	cfg := tightConfig()
	cfg.RateLimitEnabled = false
	limits := NewLimits(cfg)

	if limits != nil {
		t.Fatal("NewLimits must return nil when limiting is off, so every method is a nil-receiver no-op")
	}

	h := limits.GraphQL(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Must not panic with no charger on the context.
		ChargeComplexity(r.Context(), 999_999, true)
	}))
	user := uuid.New()
	for i := range 50 {
		if rec := serve(h, asUser(user)); rec.Code != http.StatusOK {
			t.Fatalf("request %d returned %d with limiting disabled", i, rec.Code)
		}
	}
	if rec := serve(limits.Anonymous(reached()), httptest.NewRequest(http.MethodGet, "/auth/refresh", nil)); rec.Code != http.StatusOK {
		t.Errorf("anonymous status = %d with limiting disabled", rec.Code)
	}
	r := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	if !limits.LoginAttempt(httptest.NewRecorder(), r, "someone@example.com") {
		t.Error("LoginAttempt refused with limiting disabled")
	}
}

// Concurrency, exercised through the middleware rather than asserted from one goroutine: real
// requests, real ResponseWriters, and a count of how many actually got through. Under -race
// this is also what catches a header written from the wrong goroutine.
func TestRateLimit_ConcurrentRequestsFromOneCallerGetExactlyTheBudget(t *testing.T) {
	const budget = 200
	cfg := tightConfig()
	cfg.RateLimitGraphQLRequests = budget
	limits := NewLimits(cfg)

	h := limits.GraphQL(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ChargeComplexity(r.Context(), 1, false)
	}))

	user := uuid.New()
	var served, refused atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for range 20 { // 800 attempts for 200 tokens
				switch serve(h, asUser(user)).Code {
				case http.StatusOK:
					served.Add(1)
				case http.StatusTooManyRequests:
					refused.Add(1)
				}
			}
		}()
	}
	close(start)
	wg.Wait()

	if served.Load() != budget {
		t.Errorf("served %d of a budget of %d — a lost update either hands out free capacity "+
			"or throws paid-for capacity away", served.Load(), budget)
	}
	if served.Load()+refused.Load() != 800 {
		t.Errorf("%d requests were neither served nor refused", 800-served.Load()-refused.Load())
	}
}

func TestWholeSeconds_RoundsUpAndNeverToZero(t *testing.T) {
	for _, tc := range []struct {
		in   time.Duration
		want int
	}{
		{0, 1},
		{time.Millisecond, 1},
		{time.Second, 1},
		{1500 * time.Millisecond, 2},
		{-time.Second, 1},
		{90 * time.Second, 90},
	} {
		// Rounding down would name a moment at which the token still does not exist, so the
		// client retries, is refused, and the header has produced the loop it exists to
		// prevent. Zero is worse: it reads as "immediately".
		if got := wholeSeconds(tc.in); got != tc.want {
			t.Errorf("wholeSeconds(%v) = %d, want %d", tc.in, got, tc.want)
		}
	}
}
