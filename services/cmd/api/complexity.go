package main

import (
	"context"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"

	"github.com/peixotolabs/polaris/services/internal/complexity"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// complexityBudget scores every operation, refuses the ones over the published ceiling, and
// bills the rest to the caller's budget.
//
// One extension doing all three, because they are one number. It used to be two —
// gqlgen's extension.ComplexityLimit computed a score and this read it back — and the
// comment here warned that two calculations are two chances to disagree. That warning was
// the right instinct aimed at the wrong risk: the two never disagreed, they agreed on a
// number that was not the documented one. gqlgen scores every field at childComplexity+1
// unless a per-field Complexity function is supplied, and none were, so the ceiling was
// unreachable by any query a person could type and the X-Complexity header reported roughly
// "how many fields did you ask for".
//
// internal/complexity is now the only thing that scores, and it derives the cost from each
// field's TYPE rather than from a hand-maintained table — see the package comment for why
// that is the difference between a rule and a list somebody has to remember to extend.
//
// The seam this file exists to be is unchanged: the scorer knows what a query costs,
// internal/httpapi knows whose budget to charge and how to answer 429, and the two meet in
// the composition root with no gqlgen import in httpapi and no rate-limiter import in the
// resolvers.
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
	// Scored off the validated operation, which is what makes the walk able to tell a list
	// from an object: `ast.Field.Definition` is populated by the validator, and gqlgen runs
	// operation-context mutators after validation.
	points := complexity.Points(complexity.Score(opCtx.Operation, opCtx.Variables))

	isMutation := opCtx.Operation != nil && opCtx.Operation.Operation == ast.Mutation

	// Charged before the refusal below, and that is a change of mind worth recording. It
	// used to be that an over-cap query paid one request and no points — because gqlgen
	// abandoned the operation before this code ran, so there was nothing to decide. Now the
	// score exists at this point either way, and letting a refused query cost nothing would
	// make probing the ceiling free: a caller could send ten thousand 10,001-point queries
	// an hour and pay only the request budget for them. The parse, the validation and the
	// walk are real work and this is the caller's own doing.
	httpapi.ChargeComplexity(ctx, points, isMutation)

	if points > complexity.MaxPoints {
		// The ceiling on a single request, and nothing more: this limit is equally happy to
		// serve a thousand 9,999-point queries a second, which is what the per-caller budget
		// is for. Refused here rather than deeper because the alternative is asking Postgres
		// for every issue's every comment's author's every issue and finding out afterwards.
		//
		// Carries a code, not only a sentence. A client that has to string-match "exceeds
		// the limit" to tell a query it must split from a query it must fix is a client that
		// breaks when the wording improves.
		return &gqlerror.Error{
			Message: "this query is too expensive to run — ask for fewer rows, fewer nested " +
				"lists, or pass explicit pagination limits",
			Extensions: map[string]any{
				"code":       string(platform.CodeRateLimited),
				"complexity": points,
				"limit":      complexity.MaxPoints,
			},
		}
	}
	return nil
}
