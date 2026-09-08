package main

import (
	"context"
	"testing"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/gqlerror"

	"github.com/peixotolabs/polaris/services/internal/complexity"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The code on the refusal, which is the whole of what a client can act on.
//
// This extension is where the 10,000-point ceiling is enforced and it had no test at all —
// the scoring model was covered thoroughly one package over, and the sentence the refusal
// actually puts on the wire was covered nowhere. It sent RATELIMITED, which every client in
// the repo maps to "too many requests, try again shortly": the iOS inbox was refused for
// asking `first: 100`, showed that sentence on every launch, offered a Retry button, and no
// 429 was ever sent by anything. A code is not a detail here. It is the only difference
// between "wait" and "this cannot work", and the two need opposite copy.
func TestOverTheCeiling_IsRefusedAsQueryTooComplexRatherThanRateLimited(t *testing.T) {
	// 100 notifications, each with an issue, each with an unpaginated list of labels — the
	// shape the iOS inbox sent. The page size multiplies the whole subtree and the inner list
	// inherits it, so the cost is quadratic and this lands far above the ceiling.
	err := refuse(t, `
		query Inbox($first: Int) {
		  notifications(first: $first) {
		    id
		    issue { id title labels { id name color teamId parentId isGroup } }
		  }
		}`, map[string]any{"first": 100})

	if err == nil {
		t.Fatal("a query well over the ceiling was admitted")
	}
	if got := err.Extensions["code"]; got != string(platform.CodeQueryTooComplex) {
		t.Errorf("refusal carries code %v, want %q.\n\nRATELIMITED is the other refusal on this "+
			"endpoint and it means the opposite thing: a budget refills, a query over the "+
			"ceiling never becomes affordable. Sharing one code is what made the app invite a "+
			"retry that could not succeed.", got, platform.CodeQueryTooComplex)
	}
	if _, hinted := err.Extensions["retryAfter"]; hinted {
		t.Error("the refusal carries a retryAfter; there is no time at which this query succeeds, " +
			"and a client would count that number down for nothing")
	}
	// The diagnostic pair an integration author needs to size their next request.
	if err.Extensions["limit"] != complexity.MaxPoints {
		t.Errorf("refusal reports limit %v, want %d", err.Extensions["limit"], complexity.MaxPoints)
	}
	points, ok := err.Extensions["complexity"].(int)
	if !ok || points <= complexity.MaxPoints {
		t.Errorf("refusal reports complexity %v, which is not a number over the ceiling",
			err.Extensions["complexity"])
	}
}

// The same query at a page size the client can afford is not refused at all.
//
// Worth asserting beside the one above: a ceiling that refuses everything would also pass
// every assertion in that test.
func TestUnderTheCeiling_IsAdmitted(t *testing.T) {
	if err := refuse(t, `query { viewer { syncVersion } }`, nil); err != nil {
		t.Fatalf("a trivial query was refused: %v", err)
	}
}

// refuse runs one operation through the extension and returns whatever it refused with.
//
// Scored off a validated document, because that is the only state in which the walk can tell
// a list from an object — `ast.Field.Definition` is filled in by the validator, and gqlgen
// runs operation-context mutators after validation for the same reason.
func refuse(t *testing.T, query string, vars map[string]any) *gqlerror.Error {
	t.Helper()

	schema := generated.NewExecutableSchema(generated.Config{}).Schema()
	doc, err := gqlparser.LoadQuery(schema, query)
	if err != nil {
		t.Fatalf("the test's own query does not validate against the schema: %v", err)
	}
	// No complexity charger on the context, so ChargeComplexity is the no-op it is on every
	// route that is not behind the rate limiter.
	return complexityBudget{}.MutateOperationContext(context.Background(), &graphql.OperationContext{
		Operation: doc.Operations[0],
		Variables: vars,
	})
}
