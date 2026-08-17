package filter_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/filter"
)

// Acceptance test 2 in docs/07-milestones/01-milestone-1.md:
//
//	A filter expressed in the UI, in a saved view and in a search returns identical ids
//	for the same workspace state.
//
// Only this level can prove the part `schema/filter-conformance.json` cannot. The fixture
// is genuinely strong — both suites run 45 cases over one workspace and compare id SETS
// against answers recorded in the file, so neither implementation can define its own
// correctness. What it cannot do is notice a token that only ONE evaluator has ever heard
// of, because a case exercising such a token could not be written: it would fail on the
// side that rejects it, so nobody adds it, so the divergence is invisible to exactly the
// mechanism built to prevent it.
//
// That is not hypothetical here. `web/src/filter/relative.ts` exports seven relative
// keywords; `parseRelative` in filter.go accepts two of them plus the signed offsets. The
// server's own comment on that function states the rule the client has broken:
//
//	Only these. A token this side understands and the client does not is a filter that
//	returns different issues depending on where it was evaluated, which is the failure the
//	single grammar exists to prevent — so the set grows in the spec first, not here.
//
// docs/03-architecture/06-filter-grammar.md lists `today` and `startOfWeek`, so the spec
// agrees with the server and the client is the side that grew without it. The user-visible
// consequence is that the filter bar builds a filter that works in the UI — the client
// evaluates it against the replica quite happily — and then `CreateView` refuses to save
// it, because `validateViewFilter` runs the token through this parser.
//
// THIS TEST DOCUMENTS A DEFECT. It asserts the divergence exactly as it stands today rather
// than asserting the parity the criterion claims, so that the gap is a fact in the test
// output instead of something a reader has to reconstruct from two files. Asserting the set
// exactly is what makes it useful: it fails when either side changes, in both directions,
// so reconciling the grammar cannot happen silently and neither can widening the gap.

// relativeFields are the fields whose values may be relative tokens. One is enough to
// exercise the parser; all four are used so that a field-specific acceptance rule cannot
// make the result look uniform when it is not.
var relativeFields = []filter.Field{
	filter.FieldDueDate,
	filter.FieldCreatedAt,
	filter.FieldUpdatedAt,
	filter.FieldCompletedAt,
}

// serverRejects is the divergence as it stands: tokens the client will emit and the server
// will refuse.
//
// When this is empty the grammars agree and this test should be deleted along with the
// entry that made it necessary.
var serverRejects = map[string]string{
	"now":          "an instant rather than a day; the server's relative type has no equivalent",
	"yesterday":    "expressible as -1d, which is what the server accepts",
	"tomorrow":     "expressible as +1d",
	"startOfMonth": "the server's relative type carries no month-start flag",
	"startOfYear":  "the server's relative type carries no year-start flag",
}

func TestRelativeTokens_TheClientEmitsTokensTheServerRefuses_DOCUMENTS_A_DEFECT(t *testing.T) {
	keywords := clientRelativeKeywords(t)

	var rejected []string
	for _, token := range keywords {
		// Rejected by every date field, or the divergence is field-specific and the
		// summary below would be a simplification of something worse.
		refusals := 0
		for _, field := range relativeFields {
			if err := parseRelativeClause(field, token); err != nil {
				refusals++
			}
		}
		switch refusals {
		case 0:
			// Accepted everywhere: the grammars agree about this token.
		case len(relativeFields):
			rejected = append(rejected, token)
		default:
			t.Errorf("the server accepts %q on some date fields and refuses it on others "+
				"(%d of %d refused). A token whose meaning depends on which field it is used in "+
				"is worse than one neither side has.", token, refusals, len(relativeFields))
		}
	}
	sort.Strings(rejected)

	for _, token := range rejected {
		if serverRejects[token] == "" {
			t.Errorf("the client emits the relative token %q and the server refuses it. A saved "+
				"view built with it in the filter bar cannot be saved, and a filter that means "+
				"different things in two evaluators is acceptance test 2 failing. Either teach "+
				"parseRelative the token, remove it from RELATIVE_KEYWORDS in "+
				"web/src/filter/relative.ts, or record it in serverRejects with the reason.", token)
		}
		delete(serverRejects, token)
	}
	for token, reason := range serverRejects {
		t.Errorf("%q is recorded as a token the server refuses (%s), but the server now accepts "+
			"it. Remove the entry — and if serverRejects is empty, the two grammars agree and "+
			"this test has done its job and can go.", token, reason)
	}

	if len(rejected) > 0 {
		t.Logf("acceptance test 2 FAILS at the grammar: the client emits %d relative tokens the "+
			"server refuses (%s). docs/03-architecture/06-filter-grammar.md lists only `today` and "+
			"`startOfWeek`, so the client is the side that is out of spec.",
			len(rejected), strings.Join(rejected, ", "))
	}
}

// The tokens both sides do agree on, asserted positively so that the test above cannot pass
// by the server having stopped accepting everything.
func TestRelativeTokens_TheSpelledSpecIsAccepted(t *testing.T) {
	// From docs/03-architecture/06-filter-grammar.md: "literal: -7d, -1M, +3d, today,
	// startOfWeek".
	for _, token := range []string{"today", "startOfWeek", "-7d", "-1M", "+3d", "+2w", "-1y"} {
		for _, field := range relativeFields {
			if err := parseRelativeClause(field, token); err != nil {
				t.Errorf("the server refuses %q on %s, which the grammar spec lists as valid: %v",
					token, field, err)
			}
		}
	}
}

// parseRelativeClause runs one token through the boundary a saved view's filter crosses.
//
// `filter.Parse` is what `validateViewFilter` and `domain.Search` both call, so this is the
// same gate a real request meets rather than a reimplementation of it.
func parseRelativeClause(field filter.Field, token string) error {
	raw, err := json.Marshal(map[string]any{
		"field": string(field), "op": "eq", "values": []string{token},
	})
	if err != nil {
		return err
	}
	_, err = filter.Parse(raw)
	return err
}

// clientRelativeKeywords reads RELATIVE_KEYWORDS out of the client's source.
//
// The same shape as the notification-preferences pin and the sync schema pin: a grammar
// shared by two languages with no compiler across the seam needs a test that reads both
// sides.
func clientRelativeKeywords(t *testing.T) []string {
	t.Helper()

	const relative = "../../../web/src/filter/relative.ts"
	source, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		// A hard failure rather than a skip, so that moving the file breaks the pin
		// loudly instead of quietly retiring it.
		t.Fatalf("cannot read the client's relative tokens at %s: %v", relative, err)
	}

	block := regexp.MustCompile(`RELATIVE_KEYWORDS[^=]*=\s*\[([^\]]*)\]`).FindStringSubmatch(string(source))
	if block == nil {
		t.Fatalf("no RELATIVE_KEYWORDS array in %s — if it was renamed, this test has to be "+
			"taught the new name rather than deleted", relative)
	}

	var out []string
	for _, m := range regexp.MustCompile(`'([A-Za-z]+)'`).FindAllStringSubmatch(block[1], -1) {
		out = append(out, m[1])
	}
	if len(out) == 0 {
		t.Fatalf("RELATIVE_KEYWORDS in %s parsed to nothing", relative)
	}
	return out
}
