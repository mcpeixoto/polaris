package httpapi

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/ratelimit"
)

/*
Per-caller rate limiting, wired into the routes.

The mechanism — token buckets, eviction, concurrency — lives in internal/ratelimit and knows
nothing about HTTP. This file is the part that has opinions: who a caller is, what each kind
of traffic is worth, and what a refusal looks like on the wire.

# Where this sits in the chain

Inside Authenticate, never outside it. Authenticate is what turns a bearer token into an
account and, when the request names a workspace, into an authz.Principal; a limiter that ran
before it would have nothing to key on but an IP address, and would then throttle everybody
behind one office NAT as though they were one caller. Concretely that means each route wraps
its own handler in NewRouter rather than the whole mux being wrapped once — which is also
what makes it possible to give /graphql, /auth/login and /sync/bootstrap budgets that have
nothing to do with each other.

# Why the budgets differ

A read is not a write and a bootstrap is neither, so they do not share a bucket:

  - /graphql carries two budgets at once. The request count catches a client looping on a
    trivial query; the complexity budget catches the one looping on an expensive query, which
    the fixed 10,000-point per-request cap in cmd/api does nothing about — that cap stops one
    enormous query and has no opinion whatsoever about a thousand medium ones.

  - Mutations pay a surcharge into the complexity budget. Complexity scores the shape of the
    response, and a write's real cost is not in its response: it is a transaction, a
    change_log row, a wakeup on every connected socket in the workspace and a notification
    fan-out, none of which the score can see.

  - /auth/login and /auth/register carry the tightest budget in the process, per ACCOUNT.
    Guessing a password is the attack a rate limiter most obviously exists to stop, and the
    thing being attacked is one account — so the bucket has to be keyed by the account, not
    by whoever is doing the guessing. Ten attempts per ten minutes is well past what somebody
    who has forgotten their password will do and far short of what a dictionary needs.

  - /sync/bootstrap is a workspace snapshot: megabytes, minutes, and a query pattern that
    saturates Postgres. bootstrap.go already caps how many can run at once; this caps how
    often one user may ask, which is the other half of the resync-storm story — a client
    stuck in a bootstrap loop is refused instead of being queued.

# On the shape of a refusal

429 with a Retry-After header and the errorBody shape from errors.go.

docs/03-platform/01-graphql-api.md describes the reference product answering 400 with a
GraphQL errors array, and says so with an audible sigh ("however odd 400 looks"). We do not
copy it. This process already answers 429 with Retry-After for the bootstrap semaphore in
bootstrap.go, web/src/sync/api.ts already maps 429 to RATELIMITED, and 429 is what every
HTTP client, proxy and dashboard in existence already understands. Inventing a second
convention for the same condition on a different route would be a bug waiting to be written
by whoever handles only one of them.
*/

// writeSurcharge is what a mutation costs the complexity budget over and above the query
// complexity of whatever it returns.
//
// 500 points, against a default budget of 2,000,000 an hour, is about four thousand writes an
// hour before the surcharge alone exhausts the budget — an order of magnitude past the
// busiest human and past every bulk operation the API exposes, since those are one mutation
// each by design. The number is a stand-in for work the score cannot see, not a measurement;
// if writes ever need their own published budget, this is the line that becomes a bucket.
const writeSurcharge = 500

// minComplexityAdmission is what a request must be able to afford to be let in at all.
//
// One point, because the price cannot be known until gqlgen has parsed and measured the
// query — so admission asks only "is there anything left in this bucket", and the real charge
// lands afterwards through ChargeComplexity. One request therefore gets past the line when
// the bucket is nearly empty, and its overspend is taken out of the next one. That is the
// right trade: refusing it after measurement would mean the parse and validation had already
// been paid for and thrown away.
const minComplexityAdmission = 1

// Limits holds the process's per-caller budgets, one limiter per class.
//
// A nil *Limits is a working, entirely permissive Limits — every method below tolerates a nil
// receiver. That is how POLARIS_RATE_LIMIT_ENABLED=false is implemented, and it keeps the
// wiring in NewRouter free of an `if` around every route.
type Limits struct {
	graphQLRequests   *ratelimit.Limiter
	graphQLComplexity *ratelimit.Limiter
	login             *ratelimit.Limiter
	anonymous         *ratelimit.Limiter
	bootstrap         *ratelimit.Limiter
}

// NewLimits builds the limiters from configuration, or returns nil when limiting is off.
func NewLimits(cfg platform.Config) *Limits {
	if !cfg.RateLimitEnabled {
		return nil
	}
	maxCallers := cfg.RateLimitMaxCallers
	return &Limits{
		graphQLRequests: ratelimit.New(ratelimit.Limit{
			Name:  "Requests",
			Burst: float64(cfg.RateLimitGraphQLRequests),
			Per:   cfg.RateLimitGraphQLPeriod,
		}, maxCallers),
		graphQLComplexity: ratelimit.New(ratelimit.Limit{
			Name:  "Complexity",
			Burst: float64(cfg.RateLimitGraphQLComplexity),
			Per:   cfg.RateLimitGraphQLPeriod,
		}, maxCallers),
		login: ratelimit.New(ratelimit.Limit{
			Name:  "Login",
			Burst: float64(cfg.RateLimitLoginAttempts),
			Per:   cfg.RateLimitLoginPeriod,
		}, maxCallers),
		anonymous: ratelimit.New(ratelimit.Limit{
			Name:  "Requests",
			Burst: float64(cfg.RateLimitAnonRequests),
			Per:   cfg.RateLimitAnonPeriod,
		}, maxCallers),
		bootstrap: ratelimit.New(ratelimit.Limit{
			Name:  "Bootstraps",
			Burst: float64(cfg.RateLimitBootstraps),
			Per:   cfg.RateLimitBootstrapPeriod,
		}, maxCallers),
	}
}

// GraphQL guards the API endpoint with the request count and the complexity budget.
//
// The complexity charge is deferred rather than made here: ChargeComplexity is called from
// the gqlgen extension in cmd/api once the query has actually been measured, through the
// callback this installs on the context. Counting requests instead — which is what a limiter
// that does not reach into the GraphQL layer is reduced to — would price `{ viewer { id } }`
// and a five-hundred-issue export identically.
func (l *Limits) GraphQL(next http.Handler) http.Handler {
	if l == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := callerKey(r)

		// The complexity budget is consulted first, and read-only, so that a caller who has
		// run out of points does not also lose a request token every time they are told so.
		// The balance it reads is the one left by everything this caller has already spent,
		// which is what makes a caller who overdrew on their last query wait now: cheap for a
		// cheap caller, expensive for an expensive one.
		budget := l.graphQLComplexity.Check(key, minComplexityAdmission)
		writeLimitHeaders(w, budget)
		if !budget.OK {
			// Both budgets on the refusal too, so a client can see which of the two it hit.
			writeLimitHeaders(w, l.graphQLRequests.Check(key, 1))
			writeRateLimited(w, r, budget, "query complexity budget exhausted — retry after the time in Retry-After")
			return
		}

		requests := l.graphQLRequests.Allow(key, 1)
		writeLimitHeaders(w, requests)
		if !requests.OK {
			writeRateLimited(w, r, requests, "too many requests — slow down and retry after the time in Retry-After")
			return
		}

		ctx := withComplexityCharger(r.Context(), func(points int, isMutation bool) {
			cost := float64(points)
			if isMutation {
				cost += writeSurcharge
			}
			// Set before the response body is written: gqlgen's operation-context mutators run
			// inside CreateOperationContext, which the POST transport calls before writeJson.
			w.Header().Set("X-Complexity", strconv.Itoa(points))
			writeLimitHeaders(w, l.graphQLComplexity.Spend(key, cost))
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Anonymous guards the endpoints that are reachable without a token, keyed by source address.
//
// Deliberately a courtesy limit, and worth being honest about why. The address comes from
// clientIP, which trusts X-Forwarded-For because the only route to this process in production
// is through the reverse proxy that overwrites it — but a self-hoster who publishes this port
// directly makes that header caller-controlled, and an attacker who can set it can mint a
// fresh bucket per request. So this stops the naive flood and the accidental loop, and nothing
// more. The budget that actually stops a password guess is the per-account one below, whose
// key comes out of the request body and therefore cannot be rotated by whoever is attacking a
// particular account.
func (l *Limits) Anonymous(next http.Handler) http.Handler {
	if l == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// An authenticated caller on these routes — /auth/workspaces, a refresh with a live
		// session — is already identified and already budgeted elsewhere, and lumping them in
		// with every other request from the same office would throttle a team of ten as
		// though it were one client.
		if _, ok := AccountFrom(r.Context()); ok {
			next.ServeHTTP(w, r)
			return
		}
		d := l.anonymous.Allow(callerKey(r), 1)
		writeLimitHeaders(w, d)
		if !d.OK {
			writeRateLimited(w, r, d, "too many requests from this address")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Bootstrap guards the snapshot endpoint, per caller.
//
// The other half of what the semaphore in bootstrap.go does, and neither is sufficient alone.
// The semaphore bounds how many snapshots run at once, which is what keeps a resync storm from
// saturating Postgres; it says nothing about the same client asking again the moment it is let
// go, which is what a client with a bad resume watermark does forever. This bounds that, and it
// answers 429 rather than queueing, because a loop does not benefit from being made to wait.
func (l *Limits) Bootstrap(next http.Handler) http.Handler {
	if l == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d := l.bootstrap.Allow(callerKey(r), 1)
		writeLimitHeaders(w, d)
		if !d.OK {
			writeRateLimited(w, r, d,
				"too many workspace snapshots — a client that needs to resync this often has a bug")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// LoginAttempt charges one attempt against the named account and reports whether to proceed.
//
// Called from the handler rather than from a middleware, because the account being attacked
// is in the request body and the middleware would have to read and rewind it to find out.
// Doing it after decodeJSON costs nothing and keeps exactly one piece of code responsible for
// parsing a request body.
//
// It is charged on every attempt, not only on failures. Charging failures alone would make
// the limiter's behaviour depend on whether the password was right, which is a timing- and
// header-observable oracle for "does this password work" that survives even the constant-time
// comparison in domain.Login. Ten attempts per ten minutes is not a budget a person with a
// correct password ever meets.
func (l *Limits) LoginAttempt(w http.ResponseWriter, r *http.Request, email string) bool {
	if l == nil {
		return true
	}
	d := l.login.Allow(accountKeyFor(email), 1)
	writeLimitHeaders(w, d)
	if d.OK {
		return true
	}
	// The message says nothing about whether the address exists. An account-specific limiter
	// that announced itself only for real accounts would be an enumeration oracle, which is
	// the thing domain.Login goes out of its way to hash a throwaway password to avoid.
	writeRateLimited(w, r, d, "too many sign-in attempts — try again after the time in Retry-After")
	return false
}

// callerKey names who is being charged.
//
// The principal first, because that is the caller's real identity: everything else is a proxy
// for it. Note what this means for API keys, once they are wired into Authenticate — a key
// resolves through domain.AuthenticateApiKey to its owner's principal, so it shares its
// owner's bucket. That is the right default and it follows the rule stated in
// domain/apikeys.go: a key acts as its owner and never more. Giving each key its own budget
// would make "mint twenty keys" the documented way to have twenty times the rate limit.
//
// The account id is the fallback for the auth endpoints, which are authenticated but have no
// workspace and therefore no principal. The address is the last resort, for the endpoints
// that have no caller at all.
func callerKey(r *http.Request) string {
	if p, ok := authz.PrincipalFrom(r.Context()); ok {
		return "user:" + p.UserID.String()
	}
	if id, ok := AccountFrom(r.Context()); ok {
		return "account:" + id.String()
	}
	if addr := clientIP(r); addr != nil {
		return "ip:" + addr.String()
	}
	// A request whose address could not be parsed at all. One shared bucket for all of them
	// is deliberately harsh: this does not happen to a real client.
	return "ip:unknown"
}

// accountKeyFor is the login limiter's key.
//
// Lower-cased, which the account lookup in domain deliberately is not. The bucket must be
// COARSER than the lookup, never finer: if it were case-sensitive too, "Alice@example.com"
// and "alice@example.com" would be separate buckets, and an attacker would get a fresh ten
// attempts for every capitalisation of the address they are attacking.
func accountKeyFor(email string) string {
	return "login:" + strings.ToLower(strings.TrimSpace(email))
}

// writeLimitHeaders reports the budget on every response, spent or not.
//
// Named after the class rather than being one generic set, following the scheme in
// docs/03-platform/01-graphql-api.md, so a client that sees X-RateLimit-Complexity-Remaining
// fall knows which of its two budgets it is burning. The class comes off the decision rather
// than being repeated at the call site: passing it by hand is how a response ends up
// reporting one budget's numbers under another budget's name.
//
// Reset is in seconds, which is what Retry-After uses; the docs' UTC-epoch-milliseconds
// variant is a clock-skew bug waiting for a client whose clock is wrong.
func writeLimitHeaders(w http.ResponseWriter, d ratelimit.Decision) {
	if d.Limit <= 0 || d.Class == "" {
		return
	}
	h := w.Header()
	h.Set("X-RateLimit-"+d.Class+"-Limit", strconv.FormatFloat(d.Limit, 'f', -1, 64))
	h.Set("X-RateLimit-"+d.Class+"-Remaining", strconv.FormatFloat(math.Floor(d.Remaining), 'f', -1, 64))
	h.Set("X-RateLimit-"+d.Class+"-Reset", strconv.Itoa(wholeSeconds(d.Reset)))
}

// writeRateLimited answers a refusal, with the one header that makes it actionable.
func writeRateLimited(w http.ResponseWriter, r *http.Request, d ratelimit.Decision, msg string) {
	w.Header().Set("Retry-After", strconv.Itoa(wholeSeconds(d.RetryAfter)))
	writeError(w, r, platform.RateLimited(msg))
}

// wholeSeconds rounds UP, and never to zero.
//
// Retry-After is measured in whole seconds, so rounding down would tell a client to come back
// at a moment when the token it needs still does not exist — it retries, is refused again, and
// the header has produced the tight retry loop it was added to prevent. Zero has the same
// problem and is worse, because it reads as "immediately".
func wholeSeconds(d time.Duration) int {
	s := int(math.Ceil(d.Seconds()))
	if s < 1 {
		return 1
	}
	return s
}

// --- the GraphQL complexity charge -----------------------------------------------------
//
// The measurement happens inside gqlgen and the charge happens here, so something has to
// carry one to the other. A callback on the request context, rather than an exported limiter
// the graph layer reaches into: the callback already knows the caller, the bucket and the
// ResponseWriter, so the GraphQL side has to supply nothing but the number it measured — and
// when limiting is off there is no callback and the call is a no-op with no branch anywhere
// near the resolvers.

type complexityChargerKey struct{}

func withComplexityCharger(ctx context.Context, fn func(points int, isMutation bool)) context.Context {
	return context.WithValue(ctx, complexityChargerKey{}, fn)
}

// ChargeComplexity bills a measured query to the caller's complexity budget.
//
// Called once per operation from the gqlgen extension wired in cmd/api, which is the only
// place the computed complexity exists. A request that never went through Limits.GraphQL —
// anything on another route, or every request when limiting is switched off — carries no
// charger and this does nothing.
func ChargeComplexity(ctx context.Context, points int, isMutation bool) {
	if fn, ok := ctx.Value(complexityChargerKey{}).(func(points int, isMutation bool)); ok {
		fn(points, isMutation)
	}
}
