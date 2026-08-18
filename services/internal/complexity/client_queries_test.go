package complexity_test

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/vektah/gqlparser/v2"

	"github.com/peixotolabs/polaris/services/internal/complexity"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// Every operation the web client actually sends, scored against the ceiling.
//
// A scoring model that is correct and rejects the product is not correct in any sense worth
// having. This walks web/src/gql/operations.ts — the client's real documents, hand-written
// there and not generated — validates each against the real schema and asserts it fits.
//
// It is also the test that would have caught the change that introduced this package doing
// harm. Before internal/complexity existed every field scored 1 and nothing could approach
// 10,000; afterwards an unpaginated list costs fifty times its subtree, and a query the
// client sends on every boot is exactly the sort of thing that could quietly cross the line.
//
// A cross-language pin, like syncsrv/schema_pin_test.go: two files in two languages that
// have to agree, with no compiler between them.
func TestEveryClientOperationFitsUnderTheCeiling(t *testing.T) {
	const relative = "../../../web/src/gql/operations.ts"

	source, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		// Fatal, not skipped. A skip is silent on the day somebody moves the file, which is
		// exactly when this stops holding.
		t.Fatalf("cannot read the client's operations at %s: %v", relative, err)
	}

	documents := extractDocuments(string(source))
	if len(documents) == 0 {
		t.Fatal("found no GraphQL documents in the client's operations file; the extraction " +
			"below has stopped matching how they are written")
	}

	schema := generated.NewExecutableSchema(generated.Config{}).Schema()

	operations := 0
	for name, body := range documents {
		if !strings.Contains(body, "query ") && !strings.Contains(body, "mutation ") {
			continue // a bare fragment; it is scored as part of whatever includes it
		}
		operations++

		doc, err := gqlparser.LoadQuery(schema, inline(body, documents))
		if err != nil {
			t.Errorf("%s does not validate against the schema this server serves: %v", name, err)
			continue
		}
		for _, op := range doc.Operations {
			points := complexity.Points(complexity.Score(op, nil))
			if points > complexity.MaxPoints {
				t.Errorf("%s costs %d points, over the %d ceiling — the client cannot run "+
					"its own query.\n\nEither the operation asks for too much and should "+
					"paginate, or the model is charging something it should not.",
					name, points, complexity.MaxPoints)
				continue
			}
			t.Logf("%-28s %5d points", name, points)
		}
	}

	if operations == 0 {
		t.Fatal("extracted documents but none of them was an operation; this test is passing " +
			"without scoring anything")
	}
}

var documentPattern = regexp.MustCompile("(?s)export const (\\w+) = /\\* GraphQL \\*/ `(.*?)`;")

// extractDocuments pulls every tagged template out of the client's operations file.
//
// A regular expression over TypeScript, which is not something to do lightly and is the
// right amount of machinery here: the alternative is a Node process in a Go test, and the
// shape being matched is one line of boilerplate that a lint would notice changing.
func extractDocuments(source string) map[string]string {
	out := map[string]string{}
	for _, m := range documentPattern.FindAllStringSubmatch(source, -1) {
		out[m[1]] = m[2]
	}
	return out
}

// inline replaces ${FRAGMENT} interpolations with the fragment's text.
//
// The client composes documents by interpolating fragment constants, so an operation on its
// own does not parse — `...IssueFields` has nothing to refer to. Resolved repeatedly because
// a fragment may itself interpolate another.
func inline(body string, documents map[string]string) string {
	for range 8 {
		before := body
		for name, text := range documents {
			body = strings.ReplaceAll(body, fmt.Sprintf("${%s}", name), text)
		}
		if body == before {
			break
		}
	}
	return body
}
