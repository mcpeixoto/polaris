// Package graph is the GraphQL transport.
//
// A resolver reads the caller off the context, makes one call into internal/domain, and
// maps the answer onto the schema's shape. It holds no business rules, no authorisation
// decisions and no SQL, and scripts/lint-imports.sh fails the build if it imports
// internal/store.
//
// That import rule is the whole reason this layer is thin. Every mutation has to emit its
// change_log row in the same transaction as the entity write, and the only way to
// guarantee that for a surface as wide as a GraphQL API is to make the database
// unreachable from here — a resolver that could write directly would eventually write an
// entity the sync stream never hears about, and the bug would be investigated as a sync
// failure for a day before anybody looked at the resolver.
package graph

import (
	"context"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Resolver is the root resolver. Its only dependency is the domain API, which is the
// point: anything a resolver needs that domain does not expose is a gap in the domain
// API, not an invitation to reach past it.
type Resolver struct {
	Svc *domain.Service
}

// principalFrom returns the caller, or the error every resolver returns when there is not
// one.
//
// Authentication happened in the HTTP middleware, which is the only layer that can read a
// bearer token or a session cookie. By the time a resolver runs, a missing principal means
// the request reached /graphql unauthenticated — so no resolver ever decides for itself
// who the caller is, and there is exactly one place that can get that wrong.
func principalFrom(ctx context.Context) (*authz.Principal, error) {
	p, ok := authz.PrincipalFrom(ctx)
	if !ok {
		return nil, platform.Unauthorized("")
	}
	return p, nil
}
