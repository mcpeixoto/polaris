package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// CORS, for the desktop app and for nothing else.
//
// The web client is served by this same origin and needs none of this — that is stated in
// NewRouter and it is still true. What changed is that the packaged desktop app is a
// separate origin by construction: it loads its renderer locally and talks to whichever
// server the user pointed it at.
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
