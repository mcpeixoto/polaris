package main

import (
	"testing"

	"github.com/peixotolabs/polaris/services/internal/graph"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The gate for the wiring, not for the middleware.
//
// graph.LoaderMiddleware existed, was documented, and was referenced from exactly one
// test — never from the handler this process serves. loaders() falls back to a private
// set when the middleware is absent, silently and correctly, so the only symptom was a
// list query paying per row for reads the design says it pays for once. Nothing failed.
//
// Both branches of newGraphQLHandler are asserted because the development branch returns
// a different handler (a mux carrying the playground), and wrapping only one of them is
// the shape this mistake would take next time.
func TestNewGraphQLHandler_MountsTheLoaderMiddleware(t *testing.T) {
	for _, env := range []string{"production", "development"} {
		t.Run(env, func(t *testing.T) {
			h := newGraphQLHandler(nil, platform.Config{Env: env})
			if !graph.IsLoaderHandler(h) {
				t.Fatalf("the %s GraphQL handler is not wrapped in the loader middleware; every hydrate call will mint its own cache", env)
			}
		})
	}
}
