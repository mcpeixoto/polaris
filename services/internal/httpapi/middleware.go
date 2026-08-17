// Package httpapi is the HTTP transport: routing, authentication middleware, the auth
// endpoints and the bootstrap stream. It owns no business rules — every write it performs
// goes through internal/domain, and every access decision through internal/authz.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// WorkspaceHeader names the workspace a request is scoped to.
//
// A header rather than a path segment because the GraphQL endpoint is a single URL that
// every client, integration and agent posts to; putting the workspace in the path would
// mean either a per-workspace endpoint or parsing it out of the query document.
const WorkspaceHeader = "X-Polaris-Workspace"

// Tokens issues and verifies access tokens. It exists as a small type rather than loose
// functions so the signing secret is held in exactly one place and cannot be passed to
// the wrong call site.
type Tokens struct {
	secret []byte
	ttl    time.Duration
}

func NewTokens(secret string, ttl time.Duration) *Tokens {
	return &Tokens{secret: []byte(secret), ttl: ttl}
}

func (t *Tokens) Issue(c auth.Claims) (string, error) {
	return auth.IssueAccessToken(t.secret, c, t.ttl)
}

func (t *Tokens) Parse(tok string) (auth.Claims, error) {
	return auth.ParseAccessToken(t.secret, tok)
}

// VerifyAccessToken satisfies syncsrv.TokenVerifier.
func (t *Tokens) VerifyAccessToken(tok string) (uuid.UUID, error) {
	c, err := t.Parse(tok)
	if err != nil {
		return uuid.Nil, err
	}
	return c.AccountID, nil
}

func (t *Tokens) TTL() time.Duration { return t.ttl }

type accountKey struct{}

// WithAccount stores the authenticated account id. Kept separate from the principal
// because the auth endpoints (list my workspaces, accept an invitation) operate on an
// account that has no workspace context yet.
func WithAccount(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, accountKey{}, id)
}

func AccountFrom(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(accountKey{}).(uuid.UUID)
	return id, ok && id != uuid.Nil
}

// RequestID tags every request so an HTTP log line, the queries it ran, the change rows
// it emitted and the jobs it enqueued can be tied together during an incident.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" || len(id) > 64 {
			var b [12]byte
			_, _ = rand.Read(b[:])
			id = hex.EncodeToString(b[:])
		}
		w.Header().Set("X-Request-Id", id)

		ctx := platform.WithRequestID(r.Context(), id)
		ctx = platform.WithLogger(ctx, platform.Log(ctx).With("request_id", id))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Authenticate resolves a bearer token to an account and, when the request names a
// workspace, to a full principal.
//
// It does NOT reject unauthenticated requests: the auth endpoints and /healthz are
// public, and a handler that needs a caller says so with RequireAuth. Rejecting here
// would mean every public route needed an exemption, and exemption lists are how a route
// accidentally becomes public.
func Authenticate(tokens *Tokens, svc *domain.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}

			// An API key is a bearer token too, and it is the credential every integration,
			// script and agent uses. Without this branch a `plk_` key reaches Tokens.Parse,
			// fails to be a JWT, and is answered "invalid or expired token" — which sends its
			// holder to a refresh flow that API keys do not have, to fix a key that was
			// perfectly valid. The whole API-key feature authenticated nothing.
			//
			// Chosen by prefix rather than by trying both, because falling through from a
			// failed Parse would give a revoked key that same misleading answer, and would put
			// a database read behind every malformed token.
			if domain.IsAPIKeyToken(token) {
				principal, err := svc.AuthenticateApiKey(r.Context(), token)
				if err != nil {
					writeError(w, r, err)
					return
				}

				// A key carries its own workspace, so the header is optional here — but when
				// it is present and names a different one, that is refused rather than
				// ignored. A caller who asked for workspace B and silently got answers about
				// workspace A has been given the wrong data with no way to notice.
				if ws := workspaceFromRequest(r); ws != uuid.Nil && ws != principal.WorkspaceID {
					writeError(w, r, platform.Unauthorized("this API key does not belong to that workspace"))
					return
				}

				ctx := WithAccount(r.Context(), principal.AccountID)
				ctx = authz.WithPrincipal(ctx, principal)
				ctx = platform.WithLogger(ctx, platform.Log(ctx).With(
					"workspace", principal.WorkspaceID, "user", principal.UserID, "auth", "api_key"))
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			claims, err := tokens.Parse(token)
			if err != nil {
				// An expired token is the normal case, not an attack: the client
				// refreshes and retries. Answering 401 here is what triggers that.
				writeError(w, r, platform.Unauthorized("invalid or expired token"))
				return
			}

			ctx := WithAccount(r.Context(), claims.AccountID)

			if ws := workspaceFromRequest(r); ws != uuid.Nil {
				principal, err := svc.ResolvePrincipal(ctx, claims.AccountID, ws)
				if err != nil {
					writeError(w, r, err)
					return
				}
				ctx = authz.WithPrincipal(ctx, principal)
				ctx = platform.WithLogger(ctx, platform.Log(ctx).With(
					"workspace", ws, "user", principal.UserID))
			}

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAuth rejects a request with no authenticated account.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := AccountFrom(r.Context()); !ok {
			writeError(w, r, platform.Unauthorized(""))
			return
		}
		next.ServeHTTP(w, r.WithContext(r.Context()))
	})
}

// RequireWorkspace rejects a request that did not resolve to a workspace principal.
func RequireWorkspace(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := authz.PrincipalFrom(r.Context()); !ok {
			writeError(w, r, platform.Unauthorized("this request must name a workspace"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Recover turns a panic into a 500 with a logged stack rather than a dropped connection.
// A dropped connection gives the client no error to show and leaves nothing in the logs
// tying the failure to a request.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				platform.Log(r.Context()).Error("panic serving request",
					"panic", rec, "path", r.URL.Path, "method", r.Method)
				writeError(w, r, platform.Internal(nil))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// SecurityHeaders sets the defence-in-depth headers that cost nothing.
//
// There is no Content-Security-Policy here on purpose: the SPA is served by nginx, which
// owns its CSP, and a second policy set on API responses would be either redundant or
// quietly contradictory.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// API responses are per-caller and must never be cached by an intermediary.
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(h) > len(prefix) && strings.EqualFold(h[:len(prefix)], prefix) {
		return h[len(prefix):]
	}
	return ""
}

func workspaceFromRequest(r *http.Request) uuid.UUID {
	raw := r.Header.Get(WorkspaceHeader)
	if raw == "" {
		raw = r.URL.Query().Get("workspace")
	}
	if raw == "" {
		return uuid.Nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil
	}
	return id
}

// clientIP reads the caller's address for the session list.
//
// It trusts X-Forwarded-For only because the only path to this process is through the
// reverse proxy, which overwrites it. Exposing this port directly would make the header
// caller-controlled and the recorded address a fiction — which is why production compose
// publishes no ports.
func clientIP(r *http.Request) *netip.Addr {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if first, _, ok := strings.Cut(xff, ","); ok {
			xff = first
		}
		if addr, err := netip.ParseAddr(strings.TrimSpace(xff)); err == nil {
			return &addr
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return &addr
	}
	return nil
}
