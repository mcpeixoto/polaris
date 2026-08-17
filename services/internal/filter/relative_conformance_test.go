package filter_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	// The fixture pins a timezone by name, and the whole point of these cases is the
	// timezone arithmetic. A machine with no zoneinfo database would fall back to UTC
	// without saying so, every expectation below would be off by an hour, and the failure
	// would look like a resolver bug rather than a missing table.
	_ "time/tzdata"

	"github.com/peixotolabs/polaris/services/internal/filter"
)

// Every relative token, resolved, against the instants recorded in the shared fixture.
//
// `TestConformance` already runs 48 cases through this compiler and compares the ids that
// come back. This asks a stricter question of a smaller thing: not "do the two evaluators
// select the same issues" but "do they resolve the same token to the same instant". The
// distinction matters because the fixture holds seven issues, and with seven issues a great
// many wrong instants still select the right rows — a resolver that ignored the workspace
// timezone entirely would pass every date case in that file, because nothing in it was
// created within an hour of midnight.
//
// It also reaches the tokens the case list structurally cannot. A case using a token only
// one side accepts fails on the side that rejects it, so nobody writes one, so exactly the
// divergence the fixture exists to prevent is the one it cannot see. Five tokens sat in that
// blind spot: the client shipped `now`, `yesterday`, `tomorrow`, `startOfMonth` and
// `startOfYear`, and `parseRelative` refused all five, so the filter bar built filters that
// worked against the replica and that `CreateView` then declined to save.
//
// Resolved through `filter.Compile` rather than by calling the resolver directly, because
// the resolver is unexported and, more usefully, because `Compile` is the path a real
// request takes. A token that resolves correctly and is then bound to the wrong placeholder
// is not a token that works.
func TestRelativeTokens_ResolveToTheInstantsTheFixtureRecords(t *testing.T) {
	fixture := loadRelativeFixture(t)

	loc, err := time.LoadLocation(fixture.Timezone)
	if err != nil {
		t.Fatalf("cannot load %q: %v", fixture.Timezone, err)
	}

	tokens := make([]string, 0, len(fixture.RelativeTokens))
	for token := range fixture.RelativeTokens {
		tokens = append(tokens, token)
	}
	// Sorted so a failing run reads the same way twice. Map order would shuffle the
	// output of an unchanged test between runs, which is how a real regression gets
	// mistaken for flakiness.
	sort.Strings(tokens)

	for _, token := range tokens {
		t.Run(token, func(t *testing.T) {
			want, err := time.Parse(time.RFC3339, fixture.RelativeTokens[token])
			if err != nil {
				t.Fatalf("fixture value for %q is not RFC 3339: %v", token, err)
			}

			got := resolveThroughCompile(t, token, fixture.EvaluatedAt, loc)
			if !got.Equal(want) {
				t.Errorf(
					"%q resolved to %s, and the fixture says %s (a difference of %s).\n\n"+
						"The fixture is the contract, not either implementation. If this value "+
						"is genuinely wrong, fix it there and watch web/src/filter/conformance."+
						"test.ts fail too — a token that resolves differently in the two "+
						"evaluators is a saved view that means one thing on screen and another "+
						"in a digest.",
					token, got.UTC().Format(time.RFC3339), want.Format(time.RFC3339), got.Sub(want),
				)
			}
		})
	}
}

// The fixture must cover every token the grammar accepts, or a token can be added to both
// implementations and pinned by neither.
//
// The keyword list is read from the client's source — the same read `clientRelativeKeywords`
// does — so this cannot be satisfied by a Go-side list that has itself gone stale.
func TestRelativeTokens_TheFixtureCoversEveryKeyword(t *testing.T) {
	fixture := loadRelativeFixture(t)

	for _, token := range clientRelativeKeywords(t) {
		if _, ok := fixture.RelativeTokens[token]; !ok {
			t.Errorf("the grammar accepts %q and schema/filter-conformance.json records no "+
				"instant for it, so nothing checks that the two evaluators resolve it the "+
				"same way. Add it to relativeTokens.", token)
		}
	}

	// At least one of each offset unit, because the units are where the two resolvers can
	// diverge without either looking wrong: months and years are calendar arithmetic, and
	// "one month before the 31st" is a question with more than one defensible answer.
	for _, form := range []string{"-7d", "+2w", "-1M", "-1y"} {
		if _, ok := fixture.RelativeTokens[form]; !ok {
			t.Errorf("no instant recorded for the offset form %q", form)
		}
	}
}

// resolveThroughCompile compiles `createdAt gte <token>` and returns the bound instant.
//
// createdAt is a timestamp field rather than a date one deliberately: `now` is the only
// token that is not the start of a day, and a DATE column has no instants in it, so the
// date path deliberately flattens `now` to today. Asking the timestamp path is what makes
// this test able to see the difference between the two.
func resolveThroughCompile(t *testing.T, token string, now time.Time, loc *time.Location) time.Time {
	t.Helper()

	raw, err := json.Marshal(map[string]any{
		"field": "createdAt", "op": "gte", "values": []string{token},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	node, err := filter.Parse(raw)
	if err != nil {
		t.Fatalf("the server refuses %q, which the client emits: %v", token, err)
	}

	compiled, err := filter.Compile(node, filter.Options{Now: now, Location: loc})
	if err != nil {
		t.Fatalf("compile %q: %v", token, err)
	}
	if len(compiled.Args) != 1 {
		t.Fatalf("expected exactly one bound argument for %q, got %d: %v",
			token, len(compiled.Args), compiled.Args)
	}

	instant, ok := compiled.Args[0].(time.Time)
	if !ok {
		t.Fatalf("%q bound a %T rather than a time.Time: %v", token, compiled.Args[0], compiled.Args[0])
	}
	return instant
}

type relativeFixture struct {
	EvaluatedAt time.Time `json:"evaluatedAt"`
	Timezone    string    `json:"timezone"`
	// Raw rather than map[string]string because the object also holds `$comment`, which is
	// an array of lines like every other comment in that file. Decoded per key below so
	// that a token whose value is not a string is an error rather than a silent omission.
	RawTokens      map[string]json.RawMessage `json:"relativeTokens"`
	RelativeTokens map[string]string          `json:"-"`
}

func loadRelativeFixture(t *testing.T) relativeFixture {
	t.Helper()

	const relative = "../../../schema/filter-conformance.json"
	data, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		t.Fatalf("cannot read %s: %v", relative, err)
	}

	var fixture relativeFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("cannot parse %s: %v", relative, err)
	}
	// `$comment` sits in the same object as the tokens. Dropped here rather than skipped at
	// every use, so a reader of the loop above is not left wondering.
	delete(fixture.RawTokens, "$comment")

	fixture.RelativeTokens = make(map[string]string, len(fixture.RawTokens))
	for token, raw := range fixture.RawTokens {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatalf("relativeTokens[%q] is not a string: %v", token, err)
		}
		fixture.RelativeTokens[token] = value
	}

	if len(fixture.RelativeTokens) == 0 {
		t.Fatalf("no relativeTokens in %s — if the section was renamed, this test has to be "+
			"taught the new name rather than deleted", relative)
	}
	return fixture
}
