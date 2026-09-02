package graph

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The loaders only earn their name when one set covers a whole request. Without the
// middleware every hydrate call mints a private set, so the memoisation lasts one
// function body and the batching layer is decoration — which is precisely the state the
// production chain was in until cmd/api mounted this.
//
// The fallback in loaders() is silent by design, so nothing else in the suite fails when
// the middleware goes missing. These two tests are the only thing that would.
func TestLoaderMiddleware_SharesOneSetForTheWholeRequest(t *testing.T) {
	r := &Resolver{}

	var first, second *Loaders
	h := LoaderMiddleware(nil)(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		// Two independent resolver calls within one request, which is what
		// hydrateTeam does three times over.
		first = r.loaders(req.Context())
		second = r.loaders(req.Context())
	}))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/graphql", nil))

	if first == nil || second == nil {
		t.Fatal("the middleware put no loaders on the request context")
	}
	if first != second {
		t.Fatal("two resolver calls in one request got two different loader sets; the request-wide cache is not shared")
	}
}

func TestLoaders_AreNotSharedBetweenRequests(t *testing.T) {
	r := &Resolver{}

	var seen []*Loaders
	h := LoaderMiddleware(nil)(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		seen = append(seen, r.loaders(req.Context()))
	}))

	for range 2 {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/graphql", nil))
	}

	if len(seen) != 2 {
		t.Fatalf("expected two requests, got %d", len(seen))
	}
	// Everything a loader holds was filtered for one principal, so a set that outlived
	// its request would be one caller's permissions answering the next caller's query.
	if seen[0] == seen[1] {
		t.Fatal("two requests shared one loader set; a cache of one principal's reads would be served to another")
	}
}

// Without the middleware the fallback is per-call, which is the N+1 the batching layer
// exists to remove. Asserting it here is what makes the two tests above mean something:
// they would both pass on a middleware that did nothing if this did not fail.
func TestLoaders_FallBackToAPrivateSetWithoutTheMiddleware(t *testing.T) {
	r := &Resolver{}
	req := httptest.NewRequest(http.MethodPost, "/graphql", nil)

	if r.loaders(req.Context()) == r.loaders(req.Context()) {
		t.Fatal("expected an unmounted middleware to mint a fresh set per call")
	}
}

func TestIsLoaderHandler(t *testing.T) {
	bare := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})

	if IsLoaderHandler(bare) {
		t.Fatal("a bare handler was reported as the loader middleware")
	}
	if !IsLoaderHandler(LoaderMiddleware(nil)(bare)) {
		t.Fatal("the loader middleware was not recognised as itself")
	}
}
