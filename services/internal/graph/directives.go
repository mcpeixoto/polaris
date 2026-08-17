package graph

import (
	"context"

	"github.com/99designs/gqlgen/graphql"

	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// Directives returns the schema's directive implementations.
//
// @idempotent is a marker, not an implementation. The actual replay protection lives in
// the resolver, where domain.Idempotent wraps the call — and it has to, because the
// stored result must be the resolver's typed payload, which a directive only ever sees
// as an untyped `any` after the fact.
//
// The directive still earns its place. It makes "which mutations are safe to retry?"
// answerable by reading schema.graphql rather than by reading nineteen resolver bodies,
// and gqlgen refuses to execute a field carrying an unimplemented directive — so
// declaring one and forgetting to wire it fails loudly on the first request instead of
// silently doing nothing.
func Directives() generated.DirectiveRoot {
	return generated.DirectiveRoot{
		Idempotent: func(ctx context.Context, _ any, next graphql.Resolver) (any, error) {
			return next(ctx)
		},
	}
}
