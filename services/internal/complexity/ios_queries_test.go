package complexity_test

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"

	"github.com/peixotolabs/polaris/services/internal/complexity"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

/*
The iOS client's operations, scored against the ceiling — the sibling of
client_queries_test.go, which scores the web client's.

# Why a second one existed as a hole for a whole release

client_queries_test.go walks web/src and nothing else, and its own comment calls it "every
operation the web client actually sends". It is exactly right about that and exactly wrong
about what the product ships: iOS is a second hand-written client, its documents are Swift
string literals in one file, and nothing anywhere scored them. So `Query.projects` sat at
10,245 points against a 10,000 ceiling and the iOS Projects screen simply never loaded, and
the inbox asked for `first: 100` and was refused on every attempt — in production, for
everyone, with the server answering "Too many requests. Try again shortly."

# Why scoring the documents would NOT have been enough

This is the part worth being careful about, because the obvious version of this test passes
while the bug is live.

A document is not a request. `complexity.Score(op, nil)` charges an unbound `$first` at the
documented default of 50, and at 50 the inbox query scores 4,850 — comfortably under. The
client sent 100, and the cost is not linear in that number (`IssueFields` contains `labels`,
an unpaginated list that inherits its parent's page size, making the query quadratic), so the
real request scored 17,700. A gate that scored documents alone would have printed "notifications
4,850 points" in green while every inbox in the world was failing. Being able to say that is
the difference between a gate and a decoration.

So the variables have to come from somewhere, and this closes it from both ends:

 1. The page sizes live in one file — PolarisCore/Networking/PageSize.swift — and every
    operation here is scored with each of its Int variables bound to the LARGEST of them.
    That is an over-approximation on purpose: it does not try to prove which constant reaches
    which call site, it charges every paginated document the biggest page any call site can
    ask for. Wrong only in the direction that refuses something safe, which is the direction
    internal/complexity itself chose for unresolvable variables.

 2. A page size written as a literal at a call site would defeat (1) by never appearing in
    that file, so the second half of this test forbids exactly that: no integer literal may be
    passed to a pagination argument anywhere in the iOS sources. `first: 100` — the change
    that caused the outage — cannot be written again without either failing this test or
    moving the number into PageSize.swift, where (1) prices it.

Together those mean: every page size the client can request is a page size CI has scored. Not
"the documents look reasonable".
*/
func TestEveryIOSOperationFitsUnderTheCeilingAtTheLargestPageTheClientRequests(t *testing.T) {
	documents := iosDocuments(t)
	page := largestIOSPageSize(t)
	schema := generated.NewExecutableSchema(generated.Config{}).Schema()

	operations := 0
	for name, body := range documents {
		doc, err := gqlparser.LoadQuery(schema, body)
		if err != nil {
			// The node lint at scripts/lint-ios-graphql.mjs is the primary check for this and
			// says it far better; failing here too costs nothing and means a Go-only CI run
			// still catches a document that has drifted from the schema.
			t.Errorf("%s does not validate against the schema this server serves: %v", name, err)
			continue
		}
		for _, op := range doc.Operations {
			operations++
			points := complexity.Points(complexity.Score(op, pageVariables(op, page)))
			if points > complexity.MaxPoints {
				t.Errorf("iOS %s costs %d points at first: %d, over the %d ceiling — the app "+
					"cannot run its own query, and the server refuses it with QUERY_TOO_COMPLEX "+
					"before it executes.\n\nEither ask for fewer rows (lower the constant in "+
					"PageSize.swift), or drop a nested unpaginated list from the selection: a "+
					"list inside a list is charged page size TIMES page size, so one scalar under "+
					"it costs %d points on its own.",
					name, points, page, complexity.MaxPoints, page*page/10)
				continue
			}
			t.Logf("%-28s %5d points at first: %d", name, points, page)
		}
	}

	if operations == 0 {
		t.Fatal("extracted iOS documents but none of them was an operation; this test is " +
			"passing without scoring anything")
	}
}

// TestTheInboxRegressionWouldFailThisGate pins the numbers the outage was made of.
//
// The gate above passes today because PageSize.inbox is 50. That is not by itself evidence
// that it would have caught anything, so this scores the real inbox document at the page size
// that shipped and asserts the server refuses it — and at the largest one that survives, so
// the cliff is written down rather than rediscovered.
//
// The interesting number is 74. Nothing about `first: 74` looks different from `first: 50`,
// and the step between 73 and 74 is the step between a working inbox and an inbox that has
// never once loaded, because `IssueFields.labels` makes the cost quadratic in the page size.
func TestTheInboxRegressionWouldFailThisGate(t *testing.T) {
	schema := generated.NewExecutableSchema(generated.Config{}).Schema()
	doc, err := gqlparser.LoadQuery(schema, iosDocuments(t)["notifications"])
	if err != nil {
		t.Fatalf("the inbox document does not validate: %v", err)
	}

	score := func(first int) int {
		return complexity.Points(complexity.Score(doc.Operations[0], map[string]any{"first": first}))
	}

	for _, tc := range []struct {
		first   int
		points  int
		refused bool
	}{
		{first: 50, points: 4850, refused: false},  // what the client asks for now
		{first: 73, points: 9768, refused: false},  // the last page size that is served
		{first: 74, points: 10020, refused: true},  // the first that is not
		{first: 100, points: 17700, refused: true}, // what shipped in e659b12
	} {
		points := score(tc.first)
		if points != tc.points {
			t.Errorf("Notifications(first: %d) scores %d, expected %d — the scoring model "+
				"changed, and the page size in PageSize.swift was chosen against the old one",
				tc.first, points, tc.points)
		}
		if refused := points > complexity.MaxPoints; refused != tc.refused {
			t.Errorf("Notifications(first: %d) refused=%v, expected %v", tc.first, refused, tc.refused)
		}
	}
}

// TestIOSPageSizesAreNotWrittenAtCallSites is half the gate above, stated on its own.
//
// A literal page size is invisible to a test that reads documents, which is precisely how
// `first: 100` reached production past a repository with a complexity gate in it. Every page
// size therefore lives in PageSize.swift, where the scoring test finds it.
func TestIOSPageSizesAreNotWrittenAtCallSites(t *testing.T) {
	pattern := regexp.MustCompile(`\b(` + strings.Join(complexity.PaginationArgs, "|") + `):\s*\d+`)

	files := 0
	err := filepath.WalkDir(repoPath("ios"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			// Test and fixture code may say `first: 3` about a stub; it never reaches the API.
			if strings.Contains(entry.Name(), "Tests") {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".swift") {
			return nil
		}
		source, err := os.ReadFile(filepath.Clean(path))
		if err != nil {
			return err
		}
		files++
		for i, line := range strings.Split(string(source), "\n") {
			// Prose is not a call site, and PageSize.swift's own comment quotes the numbers
			// this forbids. Line comments only — the iOS sources use `//` and `///` and no
			// block comments, and a `/* first: 100 */` slipping through would fail this test
			// rather than pass it silently, which is the right way round.
			if strings.HasPrefix(strings.TrimSpace(line), "//") {
				continue
			}
			if match := pattern.FindString(line); match != "" {
				t.Errorf("%s:%d passes a page size as a literal (%q):\n\n    %s\n\n"+
					"Put it in PolarisCore/Networking/PageSize.swift and refer to it by name. "+
					"A number here is a page size no test can price, and the API refuses any "+
					"single operation over %d points.",
					path, i+1, match, strings.TrimSpace(line), complexity.MaxPoints)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("cannot walk the iOS sources: %v", err)
	}
	if files < 20 {
		t.Fatalf("scanned %d Swift files; the app is far larger than that, so this is "+
			"reading a fraction of the client and reporting on all of it", files)
	}
}

// pageVariables binds every Int variable an operation declares to the given page size.
//
// By type rather than by name. `first` is what this schema calls it, but a document that
// spelled it `$limit` or `$count` would otherwise be scored at the default while the client
// sent something larger — the exact shape of the hole this file exists to close. An Int
// variable that turns out not to be a page size is bound and then ignored, because
// internal/complexity only reads variables through a pagination argument.
func pageVariables(op *ast.OperationDefinition, page int) map[string]any {
	vars := map[string]any{}
	for _, def := range op.VariableDefinitions {
		t := def.Type
		for t != nil && t.Elem != nil {
			t = t.Elem
		}
		if t != nil && t.NamedType == "Int" {
			vars[def.Variable] = page
		}
	}
	return vars
}

var (
	swiftDocument = regexp.MustCompile(`(?s)static let (\w+)\s*=\s*"""\n(.*?)\n\s*"""`)
	swiftPageSize = regexp.MustCompile(`(?m)^\s*public static let (\w+)\s*=\s*(\d+)\s*$`)
)

// iosDocuments reads the operations out of GraphQLDocuments.swift, fragment resolved.
//
// The same extraction scripts/lint-ios-graphql.mjs does, in Go, and deliberately duplicated
// rather than shared: the two checks answer different questions (does it match the schema /
// what does it cost) and a shared extractor would put a JavaScript dependency inside `go test`.
// Both fail loudly if the literal format changes, which is the property that matters.
func iosDocuments(t *testing.T) map[string]string {
	t.Helper()

	path := repoPath("ios/PolarisCore/Sources/PolarisCore/Networking/GraphQLDocuments.swift")
	source, err := os.ReadFile(path)
	if err != nil {
		// Fatal rather than skipped. A skip is silent on the day somebody moves the client,
		// which is exactly the day this stops holding.
		t.Fatalf("cannot read the iOS documents at %s: %v", path, err)
	}

	raw := map[string]string{}
	for _, m := range swiftDocument.FindAllStringSubmatch(string(source), -1) {
		raw[m[1]] = m[2]
	}
	fragment, ok := raw["issueFields"]
	if !ok {
		t.Fatalf("no `issueFields` fragment in %s; the literal format has changed and this "+
			"test is now scoring nothing", path)
	}
	delete(raw, "issueFields")
	if len(raw) < 20 {
		t.Fatalf("found %d iOS documents; the client sends far more, so the extraction has "+
			"stopped matching how they are written", len(raw))
	}

	documents := map[string]string{}
	for name, body := range raw {
		documents[name] = strings.ReplaceAll(body, `\(issueFields)`, fragment)
	}
	return documents
}

// largestIOSPageSize is the biggest number in PageSize.swift.
//
// The largest rather than the matching one: see the file comment. Binding each operation to
// the page size its own call site passes would need this test to understand Swift, and the
// conservative version needs it to understand one line of it.
func largestIOSPageSize(t *testing.T) int {
	t.Helper()

	path := repoPath("ios/PolarisCore/Sources/PolarisCore/Networking/PageSize.swift")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("cannot read %s: %v", path, err)
	}

	largest := 0
	for _, m := range swiftPageSize.FindAllStringSubmatch(string(source), -1) {
		var n int
		if _, err := fmt.Sscanf(m[2], "%d", &n); err != nil {
			t.Fatalf("cannot read the page size %s = %q: %v", m[1], m[2], err)
		}
		if n > largest {
			largest = n
		}
	}
	if largest == 0 {
		t.Fatalf("no page sizes found in %s. Either they moved, or the declaration format "+
			"changed — and either way every document below is now being scored at the default "+
			"rather than at what the client asks for, which is the failure this test exists to "+
			"prevent", path)
	}
	return largest
}

func repoPath(rel string) string { return filepath.Join("..", "..", "..", rel) }
