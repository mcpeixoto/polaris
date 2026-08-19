package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Deps is everything the router needs. Passed as a struct so adding a dependency does not
// churn every caller's argument list.
type Deps struct {
	Service *domain.Service
	Tokens  *Tokens
	Config  platform.Config

	// GraphQL is the gqlgen handler, wired by the caller so this package does not depend
	// on the generated executor.
	GraphQL http.Handler

	// Sync is the WebSocket hub handler. Nil in the api process, which does not serve it.
	Sync http.Handler

	// Limits carries the per-caller budgets. Passed in rather than built here because the
	// GraphQL handler needs the same instance: the complexity budget is charged from inside
	// gqlgen, and two limiters would each see half the traffic. Nil means no limiting.
	Limits *Limits
}

// NewRouter builds the HTTP surface.
//
// Everything lives under one hostname so the browser sees one origin: no CORS for
// first-party clients, cookies work everywhere, and the desktop app points at a single
// base URL. The reverse proxy routes these paths to this process; nothing here assumes a
// path prefix.
func NewRouter(d Deps) http.Handler {
	mux := http.NewServeMux()

	auth := &authHandlers{
		svc:       d.Service,
		tokens:    d.Tokens,
		publicURL: d.Config.PublicURL,
		// Secure cookies everywhere except plain-HTTP local development, where the
		// browser would silently drop them and sign-in would appear to do nothing.
		secure: !d.Config.IsDevelopment(),
		// Asked as the permissive question, so that anything other than an explicit
		// POLARIS_REGISTRATION_MODE=open leaves the server invite-only.
		openSignup:    d.Config.OpenSignupAllowed(),
		defaultPlan:   entitlement.Plan(d.Config.DefaultPlan),
		maxWorkspaces: d.Config.MaxWorkspacesPerAccount,
		limits:        d.Limits,
	}

	// --- health -----------------------------------------------------------------
	//
	// Checked before any authentication so a container healthcheck works, and kept free
	// of database access so that "is the process alive" and "is the database reachable"
	// stay separable during an incident.
	//
	// Neither carries a rate limit, deliberately. A probe that gets a 429 is a probe that
	// reports the process unhealthy and gets it restarted, which is a self-inflicted outage
	// caused by the thing that was supposed to prevent one — and the endpoints are a string
	// literal and a Ping, so there is nothing here worth protecting.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := d.Service.DB().Ping(ctx); err != nil {
			writeError(w, r, platform.Internal(err))
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ready"))
	})

	// --- auth -------------------------------------------------------------------
	//
	// Every one of these is reachable without a token, so every one of them carries the
	// per-address budget. register and login additionally charge a much tighter per-account
	// budget from inside the handler, where the address being attacked is known — see
	// Limits.LoginAttempt.
	//
	// register is reachable without a token but is not open: on a default install it admits
	// only somebody holding a valid invitation, or the very first account on an install that
	// has none. See the admission notes in internal/domain/account.go. The limiter still runs
	// first, so being refused costs the same budget as being let in.
	mux.Handle("POST /auth/register", d.Limits.Anonymous(http.HandlerFunc(auth.register)))
	mux.Handle("POST /auth/login", d.Limits.Anonymous(http.HandlerFunc(auth.login)))
	mux.Handle("POST /auth/refresh", d.Limits.Anonymous(http.HandlerFunc(auth.refresh)))
	mux.Handle("POST /auth/logout", d.Limits.Anonymous(http.HandlerFunc(auth.logout)))
	mux.Handle("GET /auth/workspaces", RequireAuth(http.HandlerFunc(auth.workspaces)))
	mux.Handle("POST /auth/workspaces", RequireAuth(http.HandlerFunc(auth.createWorkspace)))
	mux.Handle("POST /auth/invites/accept", RequireAuth(http.HandlerFunc(auth.acceptInvite)))

	// --- the API ----------------------------------------------------------------
	//
	// The limiter is inside RequireAuth, so an unauthenticated POST is refused before it can
	// spend anybody's budget and everything that gets past it has a caller to charge. The
	// development-only GET has no such guard and falls back to the source address, which is
	// the right answer for a playground.
	if d.GraphQL != nil {
		mux.Handle("POST /graphql", RequireAuth(d.Limits.GraphQL(d.GraphQL)))
		// GET is allowed so that the SDK and integrations can use persisted queries and
		// so a browser can hit the playground in development.
		if d.Config.IsDevelopment() {
			mux.Handle("GET /graphql", d.Limits.GraphQL(d.GraphQL))
		}
	}

	// --- sync -------------------------------------------------------------------
	mux.Handle("GET /sync/bootstrap",
		RequireWorkspace(d.Limits.Bootstrap(&bootstrapHandler{svc: d.Service})))
	if d.Sync != nil {
		// The socket authenticates itself with a hello frame rather than a header,
		// because browsers cannot set headers on a WebSocket handshake.
		mux.Handle("GET /sync", d.Sync)
	}

	github := &githubHandlers{
		svc:       d.Service,
		tokens:    d.Tokens,
		cfg:       d.Config,
		publicURL: d.Config.PublicURL,
		secure:    !d.Config.IsDevelopment(),
	}
	// Inbound GitHub traffic is unauthenticated: the signature is the credential.
	// Anonymous budget, because a loop of unsigned posts would otherwise be free.
	mux.Handle("POST /webhooks/github", d.Limits.Anonymous(http.HandlerFunc(github.events)))
	mux.Handle("POST /webhooks/github/commits/{workspaceId}", d.Limits.Anonymous(http.HandlerFunc(github.commits)))
	mux.Handle("GET /auth/github/start", RequireWorkspace(http.HandlerFunc(github.oauthStart)))
	mux.Handle("GET /auth/github/callback", d.Limits.Anonymous(http.HandlerFunc(github.oauthCallback)))

	var h http.Handler = mux
	h = Authenticate(d.Tokens, d.Service)(h)
	// Outside Authenticate, so a preflight is answered without a token: a browser sends no
	// credentials on a preflight, so authenticating one would reject every cross-origin
	// request before the real call was ever made.
	h = CORS(d.Config.AllowedOrigins, h)
	h = SecurityHeaders(h)
	h = Recover(h)
	h = RequestID(h)
	h = logRequests(h)
	return h
}

// logRequests emits one line per request with the status and duration.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		// /healthz is polled every few seconds by the container runtime; logging it
		// would bury everything else.
		if r.URL.Path == "/healthz" {
			return
		}
		platform.Log(r.Context()).Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Flush forwards to the underlying writer. Without it the wrapper silently disables
// streaming, and the bootstrap endpoint buffers its whole snapshot instead of streaming
// it — a bug that only shows up as "the first load is slow".
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
