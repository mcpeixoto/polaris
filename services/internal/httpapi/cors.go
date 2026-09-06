package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// CORS, in two disjoint policies.
//
// The web client is served by this same origin and needs none of this — that is stated in
// NewRouter and it is still true. Two things do need it, and they need opposite answers.
//
//  1. The packaged desktop app is a separate origin by construction: it loads its renderer
//     locally and talks to whichever server the user pointed it at. It authenticates with
//     an HttpOnly cookie, so it gets the credentialed policy described below — an
//     allowlist, echoed.
//
//  2. The MCP and OAuth surface is called by browser-hosted MCP clients this server has
//     never heard of and cannot allowlist. Those paths get Access-Control-Allow-Origin: *
//     and never Allow-Credentials. See isPublicCORSPath for why that is safe.
//
// The two sets are disjoint by path and must stay that way.
//
// Two decisions here are load-bearing, and both are about the fact that this API
// authenticates with an HttpOnly cookie.
//
//   - The allowed origin is ECHOED FROM AN ALLOWLIST, never `*`. A wildcard is not merely
//     discouraged with credentials, it is refused by every browser — and the reflex fix,
//     echoing back whatever Origin arrived, turns any website the user visits into a
//     client of their workspace with their own cookies attached.
//
//   - `file://` is deliberately NOT supported. A page loaded from a file has the origin
//     `null`, and so does every sandboxed iframe on the internet; allowlisting the string
//     "null" would hand a session to any page that framed one. The desktop app therefore
//     serves its renderer from its own privileged scheme, whose origin is unique to it.
//     See desktop/src/main/main.ts.
const desktopOrigin = "polaris-app://app"

// corsMaxAge is how long a browser may cache a preflight. Ten minutes rather than the
// twenty-four hours some guides suggest: a shorter window means a change to this policy
// takes effect while somebody is still on the phone about it.
const corsMaxAge = "600"

// allowedHeaders is exactly what the client sends, and nothing else.
//
// Listing them rather than reflecting Access-Control-Request-Headers matters: reflecting
// would let a cross-origin caller nominate its own headers and have the server bless them,
// which defeats the point of the preflight.
var allowedHeaders = strings.Join([]string{
	"Authorization",
	"Content-Type",
	"X-Polaris-Workspace",
	"X-Polaris-Client",
	"Accept",
}, ", ")

var allowedMethods = "GET, POST, PATCH, DELETE, OPTIONS"

// isPublicCORSPath is the bearer-only surface: the MCP transport, and the OAuth documents
// and endpoints an MCP client walks on its way to a token.
//
// These are answered with a wildcard because the clients cannot be enumerated. Claude,
// MCP Inspector and anything else browser-hosted registers itself dynamically, from an
// origin this server learns about for the first time when the preflight arrives; an
// allowlist would mean a code change per client, and before this branch existed the
// preflight simply 403'd and no browser client could connect at all.
//
// The wildcard is safe on exactly these paths because Authenticate resolves a caller from
// Authorization: Bearer and from nothing else — there is no cookie-to-principal path, so a
// cross-origin page making these requests supplies no credential it did not already hold.
// mcp_cors_test.go pins that invariant, because the 403 preflight was standing in front of
// it by accident and is about to stop.
//
// Exact matches rather than a prefix: "/.well-known/oauth-" as a prefix would also cover
// "/.well-known/oauth-protected-resource-anything", and the value of this list is that it
// can be read end to end.
func isPublicCORSPath(path string) bool {
	switch strings.TrimSuffix(path, "/") {
	case "/mcp",
		"/mcp/readonly",
		"/oauth/register",
		"/oauth/token",
		"/oauth/revoke",
		"/.well-known/oauth-protected-resource",
		"/.well-known/oauth-protected-resource/mcp",
		"/.well-known/oauth-authorization-server",
		"/.well-known/oauth-authorization-server/mcp":
		return true
	default:
		return false
	}
}

// publicAllowedMethods is what the router actually registers on those paths. Not PATCH.
var publicAllowedMethods = "GET, POST, DELETE, OPTIONS"

// publicAllowedHeaders is the Streamable HTTP request headers, listed rather than
// reflected for the same reason allowedHeaders is.
var publicAllowedHeaders = strings.Join([]string{
	"Authorization",
	"Content-Type",
	"Accept",
	"Mcp-Session-Id",
	"MCP-Protocol-Version",
	"Last-Event-ID",
}, ", ")

// publicExposedHeaders is what a browser client may read back off the response.
//
// WWW-Authenticate is the load-bearing one. It is not on the CORS safelist, so without it
// a browser MCP client sees a bare 401 and never reads the resource_metadata= pointer that
// mcp.Unauthorized exists to hand it — the first step of discovery, dead-ended on a header
// the client is not allowed to look at.
var publicExposedHeaders = "WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version"

/*
usableOrigin normalises a configured origin, and refuses the ones that cannot safely be
allowed however they are spelled.

The refusals matter more than the normalisation, and the test suite is what forced this
function to exist: the first version simply trimmed and allowlisted whatever the operator
supplied, so the comment above claiming `null` was never supported was a description of an
intention rather than of the code.

  - "null" is refused outright. It is the origin of a file:// page and of every sandboxed
    iframe on the internet, so allowing it hands a credentialed session to any page that
    frames one. Somebody debugging a desktop build WILL try this, because it is the origin
    the browser tells them is being blocked.
  - Only http and https are accepted, plus the desktop scheme, which is allowed
    unconditionally elsewhere and does not need configuring.
  - Anything with a path, a query or no host is refused rather than silently trimmed: an
    entry that does not mean what it looks like is worse than one that is rejected loudly.
*/
func usableOrigin(raw string) (string, bool) {
	trimmed := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if trimmed == "" || strings.EqualFold(trimmed, "null") {
		return "", false
	}
	u, err := url.Parse(trimmed)
	if err != nil || u.Host == "" {
		return "", false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", false
	}
	if u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	// Lower-cased, because a browser sends the Origin header lower-cased and an operator
	// writing POLARIS_ALLOWED_ORIGINS=https://App.Example.com would otherwise build an
	// entry nothing can ever match — with an empty 403 as the only symptom.
	return u.Scheme + "://" + strings.ToLower(u.Host), true
}

// CORS answers preflights and attaches the response headers for allowed origins.
//
// extra carries any additional origins an operator has configured — a separate front end,
// a staging desktop build — so that self-hosters are not forced to patch the binary.
func CORS(extra []string, next http.Handler) http.Handler {
	allowed := map[string]bool{desktopOrigin: true}
	for _, o := range extra {
		if origin, ok := usableOrigin(o); ok {
			allowed[origin] = true
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Vary is set whether or not the origin is allowed, and whether or not there is an
		// Origin at all. Without it a shared cache can serve a response containing one
		// origin's Access-Control-Allow-Origin to a different origin — or serve a cached
		// no-CORS response to the desktop app, which then sees the request fail for no
		// visible reason.
		w.Header().Add("Vary", "Origin")

		if isPublicCORSPath(r.URL.Path) {
			// Wildcard unconditionally, including when there is no Origin at all, so the
			// response is byte-identical whoever asks for it and a shared cache cannot
			// hand one caller a policy meant for another.
			//
			// And never Allow-Credentials, even when the origin IS on the allowlist or is
			// the desktop app. A wildcard paired with credentials is refused outright by
			// every browser, so blessing a known origin here would break the very clients
			// this branch exists for.
			w.Header().Set("Access-Control-Allow-Origin", "*")
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				w.Header().Set("Access-Control-Allow-Methods", publicAllowedMethods)
				w.Header().Set("Access-Control-Allow-Headers", publicAllowedHeaders)
				w.Header().Set("Access-Control-Max-Age", corsMaxAge)
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.Header().Set("Access-Control-Expose-Headers", publicExposedHeaders)
			next.ServeHTTP(w, r)
			return
		}

		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			// A preflight from an origin that is not allowed gets 403 rather than a 200
			// with no CORS headers. Both stop the real request; only one of them tells
			// whoever is configuring a self-hosted install what went wrong.
			if origin == "" || !allowed[origin] {
				// With a body, which the 403 did not have. The comment above says this
				// status was chosen so the operator learns what went wrong, and an empty
				// 403 tells them nothing at all — least of all which setting to edit.
				writeError(w, r, platform.Forbidden(
					"this origin is not in POLARIS_ALLOWED_ORIGINS"))
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", allowedMethods)
			w.Header().Set("Access-Control-Allow-Headers", allowedHeaders)
			w.Header().Set("Access-Control-Max-Age", corsMaxAge)
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
