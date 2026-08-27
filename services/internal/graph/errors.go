package graph

import (
	"context"
	"errors"
	"runtime/debug"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2/gqlerror"

	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The transport's error contract, in one place.
//
// Clients branch on extensions.code and never on the message: the codes are stable, the
// wording is not, and a client that string-matches "not found" breaks the day somebody
// improves a sentence. `field` names the offending input on a validation failure so a form
// can attach the message to the control that caused it instead of showing a toast.
var (
	_ graphql.ErrorPresenterFunc = PresentError
	_ graphql.RecoverFunc        = RecoverPanic
)

// PresentError turns any error into what the client is allowed to see.
//
// It is installed as the transport's error presenter and also called by the resolvers
// themselves. The duplication is deliberate: an unclassified error's text routinely
// contains a database string — a constraint name, a fragment of SQL, another workspace's
// id — and letting that reach a user is an information leak. Making the guard a wiring
// line in main() means one forgotten call turns a security property off with no failing
// test, so the resolvers do not depend on it. Presenting twice is harmless; the function
// is idempotent.
func PresentError(ctx context.Context, err error) *gqlerror.Error {
	if err == nil {
		return nil
	}

	var perr *platform.Error
	if errors.As(err, &perr) {
		if perr.Code == platform.CodeInternal {
			// Logged here in full, and reported to the caller as nothing at all. This is
			// the only place the cause of an internal failure is written down, so it is
			// logged with the field path that produced it.
			platform.Log(ctx).Error("internal error while resolving a GraphQL field",
				"error", err, "path", graphql.GetPath(ctx))
			return internalError(ctx)
		}
		ext := map[string]any{"code": string(perr.Code)}
		if perr.Field != "" {
			ext["field"] = perr.Field
		}
		// An entitlement refusal carries structure the code alone cannot: which feature,
		// which plan would permit it, which ceiling was hit, and whether this is a lapse
		// rather than a packaging decision. Without this the client had a sentence and a
		// PLAN_LIMIT, so the only way to render a paywall that says anything specific was to
		// string-match the message — which is the thing the comment at the top of this file
		// tells clients never to do. The keys are disjoint from `code` and `field` by
		// construction; see entitlement.Details.
		var eerr *entitlement.Error
		if errors.As(err, &eerr) {
			for key, value := range eerr.Details().Extensions() {
				ext[key] = value
			}
		}
		return &gqlerror.Error{
			Err:        err,
			Message:    perr.Message,
			Path:       graphql.GetPath(ctx),
			Extensions: ext,
		}
	}

	// gqlgen's own failures — a query that will not parse, a variable that will not
	// coerce — arrive already carrying a message written for the client and a code of
	// their own. Rewriting them would replace a useful "unknown field" with "internal
	// error" and make every client integration harder to debug.
	var gqlErr *gqlerror.Error
	if errors.As(err, &gqlErr) {
		return gqlErr
	}

	platform.Log(ctx).Error("unclassified error escaped the domain layer",
		"error", err, "path", graphql.GetPath(ctx))
	return internalError(ctx)
}

// RecoverPanic reports a panicking resolver as INTERNAL.
//
// A panic is the one failure mode whose message is guaranteed to be about the server's
// internals — a nil map, an index, a type assertion — so the client is told nothing and
// the stack is written to the log, where it is the only thing that makes the crash
// diagnosable after the fact.
func RecoverPanic(ctx context.Context, p any) error {
	platform.Log(ctx).Error("panic while resolving a GraphQL field",
		"panic", p, "path", graphql.GetPath(ctx), "stack", string(debug.Stack()))
	return internalError(ctx)
}

// internalError deliberately carries no wrapped cause. Anything attached here would be
// reachable by a second pass through PresentError, and would be logged twice.
func internalError(ctx context.Context) *gqlerror.Error {
	return &gqlerror.Error{
		Message:    "internal error",
		Path:       graphql.GetPath(ctx),
		Extensions: map[string]any{"code": string(platform.CodeInternal)},
	}
}
