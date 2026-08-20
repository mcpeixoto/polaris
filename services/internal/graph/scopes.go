package graph

import (
	"context"
	"strings"

	"github.com/99designs/gqlgen/graphql"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// EnforceOauthScopes refuses a GraphQL field the caller's token was not granted.
//
// Session cookies and unscoped API keys carry an empty scope list and pass. OAuth access
// tokens always carry at least `read`. `admin` is the wildcard. Writes need `write`, except
// the documented create-only scopes that can mint issues or comments without it.
func EnforceOauthScopes(ctx context.Context, next graphql.Resolver) (any, error) {
	fc := graphql.GetFieldContext(ctx)
	if fc == nil || (fc.Object != "Query" && fc.Object != "Mutation") {
		return next(ctx)
	}

	p, ok := authz.PrincipalFrom(ctx)
	if !ok || p.HasScope("admin") || len(p.Scopes) == 0 {
		return next(ctx)
	}

	if fc.Object == "Query" {
		if !p.HasScope("read") {
			return nil, PresentError(ctx, platform.Forbidden("this token does not have the read scope"))
		}
		return next(ctx)
	}

	need := mutationScopes(fc.Field.Name)
	for _, scope := range need {
		if p.HasScope(scope) {
			return next(ctx)
		}
	}
	return nil, PresentError(ctx, platform.Forbidden("this token does not have the "+need[0]+" scope"))
}

func mutationScopes(field string) []string {
	name := strings.ToLower(field)
	switch {
	case strings.HasPrefix(name, "createissue") || name == "createissue":
		return []string{"write", "issues:create"}
	case strings.HasPrefix(name, "createcomment"):
		return []string{"write", "comments:create"}
	case strings.Contains(name, "timeschedule"):
		return []string{"write", "timeSchedule:write"}
	case strings.Contains(name, "customer"):
		return []string{"write", "customer:write"}
	case strings.Contains(name, "initiative"):
		return []string{"write", "initiative:write"}
	default:
		return []string{"write"}
	}
}
