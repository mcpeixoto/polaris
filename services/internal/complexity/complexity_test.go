package complexity_test

import (
	"testing"

	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"

	"github.com/peixotolabs/polaris/services/internal/complexity"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// The scorer against the real schema, and against the numbers the API documentation
// publishes.
//
// docs/03-platform/01-graphql-api.md prints three worked totals — 2, 66 and 14 — and tells
// integration authors to size their requests by them. Those three are asserted here on
// Polaris queries with the same shape, so the published arithmetic and the server's cannot
// drift apart without this failing. It is the same kind of pin as schema_pin_test.go: a
// contract with a party that is not in this repository.

// score parses and validates against the real schema, then costs the result.
//
// Validated, not merely parsed, because the walk reads `field.Definition` to tell a list
// from an object — that is populated by the validator, and a parsed-only document would
// score every field as a property and pass every assertion for the wrong reason.
func score(t *testing.T, query string, vars map[string]any) int {
	t.Helper()
	schema := generated.NewExecutableSchema(generated.Config{}).Schema()
	doc, err := gqlparser.LoadQuery(schema, query)
	if err != nil {
		t.Fatalf("the query is not valid against the real schema: %v\n%s", err, query)
	}
	if len(doc.Operations) != 1 {
		t.Fatalf("want exactly one operation, got %d", len(doc.Operations))
	}
	return complexity.Points(complexity.Score(doc.Operations[0], vars))
}

// TestPublishedExamples is the whole contract.
func TestPublishedExamples(t *testing.T) {
	tests := []struct {
		name  string
		query string
		vars  map[string]any
		want  int
		why   string
	}{
		{
			name:  "an object and one property",
			query: `{ viewer { syncVersion } }`,
			want:  2,
			// The documentation's `user { name } = 2`: one object at 1 point, one property
			// at 0.1, rounded up.
			why: "1 (object) + 0.1 (property) = 1.1, rounded up",
		},
		{
			name:  "an object holding an unpaginated list of three properties",
			query: `{ team(id: "00000000-0000-0000-0000-000000000000") { issues { id title createdAt } } }`,
			want:  66,
			// The documentation's second example, exactly: 1 + 50 + (50 x 3 x 0.1) = 66.
			// It reaches the same total by a different route because this schema has no
			// Relay `nodes` wrapper — the multiplier applies to the list field itself.
			why: "1 (team) + 50 x (1 + 0.3) = 66",
		},
		{
			name:  "the same shape with an explicit page of ten",
			query: `{ search(input: { query: "polaris", first: 10 }) { issues { id title createdAt } } }`,
			want:  14,
			// The documentation's "adding `first: 10` drops it to 14". The argument sits on
			// `search` and the list is `SearchResults.issues` one level below it, which is
			// why a page size has to travel down the selection rather than sit on the field
			// that names it.
			why: "1 (search) + 10 x (1 + 0.3) = 14",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := score(t, tc.query, tc.vars); got != tc.want {
				t.Errorf("scored %d points, want %d — %s\n\nquery: %s\n\n"+
					"This number is published in docs/03-platform/01-graphql-api.md and "+
					"integrations budget against it. Either the model changed and the "+
					"documentation has to change with it, or the scorer is wrong.",
					got, tc.want, tc.why, tc.query)
			}
		})
	}
}

func TestAnUnpaginatedListIsChargedAFullPage(t *testing.T) {
	// The reason the default is not small. A caller who declines to paginate is charged as
	// though they had asked for a page, because that is what the server is about to do.
	bare := score(t, `{ issues(teamId: "00000000-0000-0000-0000-000000000000") { id } }`, nil)
	if bare != complexity.DefaultPageSize*11/10 {
		t.Errorf("an unpaginated list scored %d, want %d",
			bare, complexity.DefaultPageSize*11/10)
	}
}

func TestAnExplicitPageIsChargedWhatItAsksFor(t *testing.T) {
	small := score(t, `{ notifications(first: 5) { id } }`, nil)
	large := score(t, `{ notifications(first: 500) { id } }`, nil)
	if small >= large {
		t.Fatalf("first: 5 scored %d and first: 500 scored %d — the pagination argument is "+
			"not reaching the scorer, so every caller is charged the default however "+
			"little they ask for", small, large)
	}
	if want := 6; small != want { // 5 x (1 + 0.1) = 5.5, rounded up
		t.Errorf("first: 5 scored %d, want %d", small, want)
	}
}

func TestAPageSizeInAVariableIsChargedToo(t *testing.T) {
	// Every real client sends `first` as a variable, so a scorer that only understood
	// literals would charge the default to everybody who paginates properly — which is
	// exactly backwards from what the documentation asks people to do.
	const query = `query N($n: Int) { notifications(first: $n) { id } }`
	// JSON numbers arrive as float64, which is how a variable reaches this code in a real
	// request. Asserted in that form deliberately.
	got := score(t, query, map[string]any{"n": float64(5)})
	if want := 6; got != want {
		t.Errorf("a variable page size scored %d, want %d — check intValue's float64 case", got, want)
	}
}

func TestAMissingVariableFallsBackToTheDefault(t *testing.T) {
	// Over-charging a malformed request is the safe direction. Under-charging one is a way
	// to buy an unlimited page for the price of a variable nobody sent.
	const query = `query N($n: Int) { notifications(first: $n) { id } }`
	got := score(t, query, nil)
	if want := complexity.DefaultPageSize * 11 / 10; got != want {
		t.Errorf("an absent variable scored %d, want the default page's %d", got, want)
	}
}

func TestAScalarListCostsWhatAPropertyCosts(t *testing.T) {
	// `ApiKey.scopes: [String!]!` is one column read once. Charging it the connection
	// multiplier would price a string array at 50 points — five times an object with
	// children — for a value that has no children to multiply.
	withScopes := score(t, `{ apiKeys { id scopes } }`, nil)
	withoutScopes := score(t, `{ apiKeys { id } }`, nil)
	if withScopes != withoutScopes+complexity.DefaultPageSize*1/10 &&
		withScopes-withoutScopes > complexity.DefaultPageSize {
		t.Errorf("a scalar list added %d points; it should cost what a property costs",
			withScopes-withoutScopes)
	}
}

func TestNestingMultipliesRatherThanAdds(t *testing.T) {
	// The property that makes the ceiling worth having. A shallow query over a large list is
	// as expensive as a deep one, and a list inside a list is the product of the two — which
	// is the query shape that saturates Postgres for everybody else.
	flat := score(t, `{ issues(teamId: "00000000-0000-0000-0000-000000000000") { id } }`, nil)
	nested := score(t, `{ issues(teamId: "00000000-0000-0000-0000-000000000000") { id comments { id body } } }`, nil)
	if nested <= flat*10 {
		t.Errorf("a nested list scored %d against a flat %d — the multiplier is not "+
			"compounding, so the one query shape this limit exists to stop is cheap",
			nested, flat)
	}
}

func TestATrulyExpensiveQueryExceedsTheCap(t *testing.T) {
	// Three levels of unpaginated list. Before this package existed the same query scored
	// somewhere in the twenties and ran.
	const query = `{
		teams {
			id
			issues { id title comments { id body } }
		}
	}`
	got := score(t, query, nil)
	if got <= complexity.MaxPoints {
		t.Errorf("three nested unpaginated lists scored %d, which is inside the %d ceiling — "+
			"the ceiling is then unreachable by any query a person would type, which is the "+
			"state this package was written to fix", got, complexity.MaxPoints)
	}
}

func TestFragmentsCostWhatTheyExpandTo(t *testing.T) {
	// A fragment is a way of writing a selection, not a discount on it. Costing the spread
	// rather than its contents would make the limit avoidable by refactoring.
	inline := score(t, `{ viewer { syncVersion user { id name } } }`, nil)
	spread := score(t, `
		{ viewer { ...f } }
		fragment f on Viewer { syncVersion user { id name } }`, nil)
	if inline != spread {
		t.Errorf("the same selection scored %d written out and %d through a fragment", inline, spread)
	}
}

// TestScoreHandlesANilOperation is the boring one, and it is here because the extension
// calls this on every request including the ones gqlgen abandoned.
func TestScoreHandlesANilOperation(t *testing.T) {
	if got := complexity.Score(nil, nil); got != 0 {
		t.Errorf("a nil operation scored %d", got)
	}
	if got := complexity.Score(&ast.OperationDefinition{}, nil); got != 0 {
		t.Errorf("an empty operation scored %d", got)
	}
}

func TestPointsRoundsUp(t *testing.T) {
	for units, want := range map[int]int{0: 0, 1: 1, 9: 1, 10: 1, 11: 2, 650: 65, 660: 66} {
		if got := complexity.Points(units); got != want {
			t.Errorf("Points(%d) = %d, want %d", units, got, want)
		}
	}
}

// TestNoPaginationArgumentGoesUnrecognised walks the real schema.
//
// The scorer derives cost from a field's TYPE, so a field added tomorrow is charged
// correctly the moment it exists — that is the whole reason it does not use gqlgen's
// per-field table. One thing does NOT follow from the type, though: which argument means
// "how many rows". A paginated field whose argument is spelled something this package does
// not know is charged the default page instead of what the caller asked for.
//
// That errs towards over-charging, so it is not a security hole; it is a published number
// being wrong for the client who did the right thing and paginated. This is the check that
// notices, and it is deliberately noisy about Int arguments in general rather than trying to
// guess intent from the name.
func TestNoPaginationArgumentGoesUnrecognised(t *testing.T) {
	// Int arguments that are values rather than page sizes. Listed by hand, because the
	// point of the test is that a NEW one has to be classified by a person.
	notPagination := map[string]string{
		"estimate":        "an issue's points, not a row count",
		"priority":        "0-4, not a row count",
		"durationWeeks":   "cadence length in weeks, not a row count",
		"cooldownWeeks":   "gap after a cycle in weeks, not a row count",
		"upcomingCount":   "how many future cycles to mint, not a page size",
		"autoCloseDays":   "inactivity period in days, not a row count",
		"autoArchiveDays": "inactivity period in days, not a row count",

		"projectUpdateReminderIntervalDays": "reminder cadence in days, not a row count",
		"projectUpdateReminderWeekday":      "reminder weekday 0-6, not a row count",
		"projectUpdateReminderHour":         "reminder hour 0-23, not a row count",
		"updateReminderIntervalDays":        "per-project reminder interval in days, not a row count",
		"updateReminderWeekday":             "per-project reminder weekday 0-6, not a row count",
		"updateReminderHour":                "per-project reminder hour 0-23, not a row count",
		"revenue":                           "customer revenue, not a row count",
		"size":                              "customer employee count, not a row count",
		"durationMinutes":                   "SLA duration in minutes, not a row count",
		"anchorStart":                       "inline comment offset in the description, not a row count",
		"anchorEnd":                         "inline comment offset in the description, not a row count",
	}

	schema := generated.NewExecutableSchema(generated.Config{}).Schema()

	recognised := map[string]bool{}
	for _, name := range complexity.PaginationArgs {
		recognised[name] = true
	}

	seen := map[string]bool{}
	check := func(where, name string, t2 *ast.Type) {
		if t2 == nil {
			return
		}
		base := t2
		for base.Elem != nil {
			base = base.Elem
		}
		if base.NamedType != "Int" || seen[name] {
			return
		}
		seen[name] = true
		if recognised[name] {
			return
		}
		if _, ok := notPagination[name]; ok {
			return
		}
		t.Errorf("%s takes an Int argument %q that internal/complexity does not recognise.\n\n"+
			"If it is a page size, add it to paginationArgs — otherwise every caller who "+
			"passes it is charged the default page of %d rather than what they asked for, "+
			"and the X-Complexity header disagrees with the published model. If it is a "+
			"value rather than a row count, add it to this test's notPagination map with "+
			"the reason.", where, name, complexity.DefaultPageSize)
	}

	for _, def := range schema.Types {
		for _, field := range def.Fields {
			for _, arg := range field.Arguments {
				check(def.Name+"."+field.Name, arg.Name, arg.Type)
			}
		}
		// Input objects too: `SearchInput.first` is the one that bounds SearchResults.
		if def.Kind == ast.InputObject {
			for _, field := range def.Fields {
				check(def.Name, field.Name, field.Type)
			}
		}
	}

	if len(seen) == 0 {
		t.Fatal("no Int arguments found anywhere in the schema — this test cannot be " +
			"passing for the right reason")
	}
}
