package main

import (
	"context"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"

	"github.com/peixotolabs/polaris/services/internal/httpapi"
)

// complexityBudget bills each operation's measured complexity to the caller's budget.
//
// It exists because the two halves of a complexity budget live on opposite sides of the
// transport. gqlgen is the only thing that knows what a query costs — extension.ComplexityLimit
// computes the score against the real schema, with the real pagination arguments, and it does
// it once — and internal/httpapi is the only thing that knows whose budget to charge and how
// to answer 429. This is the seam, and it is deliberately the whole of the seam: five lines
// of glue in the composition root, no gqlgen import in httpapi, no rate-limiter import in the
// resolvers.
//
// It charges and never refuses. Refusal happens at admission, in Limits.GraphQL, before the
// query is parsed — so a caller who overdraws is stopped on their *next* request rather than
// this one. Rejecting here instead would be strictly worse: the parse, the validation and the
// complexity walk have all already been paid for by the time the number exists, so throwing
// the request away at this point spends the cost and delivers nothing. The overspend is not
// forgiven, it is carried as debt (see ratelimit.Limiter.Spend), and the caller waits it off.
type complexityBudget struct{}

var _ interface {
	graphql.OperationContextMutator
	graphql.HandlerExtension
} = complexityBudget{}

func (complexityBudget) ExtensionName() string { return "PolarisComplexityBudget" }

func (complexityBudget) Validate(graphql.ExecutableSchema) error { return nil }

func (complexityBudget) MutateOperationContext(
	ctx context.Context, opCtx *graphql.OperationContext,
) *gqlerror.Error {
	// Written by extension.ComplexityLimit, which must therefore be registered first —
	// gqlgen runs operation-context mutators in registration order. Reading the number it
	// already computed rather than calling complexity.Calculate again matters for more than
	// the wasted walk: two calculations are two chances to disagree, and a budget that
	// charges a different number from the one the hard cap enforced is a budget nobody can
	// reconcile against the X-Complexity header.
	// Nil when there is no score to read, which happens in exactly two ways. Either the
	// complexity extension is not installed — impossible in this binary, and a silent no-op is
	// still the right answer for a caller that is not being budgeted — or the query exceeded
	// maxQueryComplexity, in which case ComplexityLimit returned an error and gqlgen abandoned
	// the operation before reaching this mutator. That second case leaves an over-cap query
	// billed one request and no points, which is deliberate: the request budget is what stops
	// somebody hammering the endpoint with queries that are rejected before they run.
	stats := extension.GetComplexityStats(ctx)
	if stats == nil {
		return nil
	}
	isMutation := opCtx.Operation != nil && opCtx.Operation.Operation == ast.Mutation
	httpapi.ChargeComplexity(ctx, stats.Complexity, isMutation)
	return nil
}
