package acceptance_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The ten M1 acceptance tests, and the tests that actually prove them.
//
// docs/07-milestones/01-milestone-1.md lists ten criteria and the milestone is not done
// until they hold. That list lives in prose, and prose does not fail: a criterion whose
// proof is renamed in a refactor, moved into a file that stops running, or deleted along
// with the feature it covered goes on being listed as met by a document nobody re-reads.
// Three of this milestone's worst defects were exactly that shape — a complete, tested,
// documented mechanism with no caller — so the failure mode is not hypothetical here.
//
// This file is the manifest. It does not re-test anything: it asserts that every criterion
// still names a proof, and that every named proof still exists. Cheap, and it converts "we
// believe M1 is accepted" into something that breaks when it stops being true.
//
// What it cannot do is judge whether a proof is any good. That judgement is written down
// beside each entry instead, including where it is weaker than the criterion asks — see
// criterion 6, which is measured against a bound five times looser than the one published,
// and says so rather than claiming a pass.

// repoRoot is where this package sits relative to the repository, so the entries above can
// name files the way a review would. Wrong the day somebody moves this package, and loudly:
// every entry fails to read at once, which is not a failure anybody misreads.
const repoRoot = "../../.."

type criterion struct {
	// Number and text, quoted from the milestone document.
	number int
	text   string
	// proofs are Go test function names, or, for the client-side ones, the exact test title
	// as it appears in the .test.ts file.
	proofs []proof
	// caveat is stated when the proof is weaker than the criterion. Empty means the proof
	// establishes what the criterion says, on the terms the criterion sets.
	caveat string
}

type proof struct {
	// file is relative to the repository root, so an entry reads the way somebody would
	// cite it in a review rather than the way this package happens to be nested.
	file string
	// name is `func TestX` for Go, or the literal test title for TypeScript.
	name string
	// why says what this particular test establishes, when a criterion has several proofs
	// that each carry part of it.
	why string
}

var m1 = []criterion{
	{
		number: 1,
		text:   "Two clients add different labels to one issue at the same moment → both survive.",
		proofs: []proof{{
			file: "services/internal/domain/labels_test.go",
			name: "TestAddIssueLabel_ConcurrentAddsOfDifferentLabelsBothSurvive",
			why:  "drives two real transactions against one issue and asserts both rows",
		}},
	},
	{
		number: 2,
		text: "A filter expressed in the UI, in a saved view and in a search returns identical " +
			"ids for the same workspace state.",
		proofs: []proof{
			{
				file: "services/internal/filter/conformance_test.go",
				name: "TestConformance",
				why:  "the Go compiler against every case in schema/filter-conformance.json",
			},
			{
				file: "services/internal/domain/search_conformance_test.go",
				name: "TestSearchConformance_AgreesWithTheClientOnEveryFixtureCase",
				why:  "the same fixture through real SQL, which is the search path",
			},
			{
				file: "web/src/filter/conformance.test.ts",
				name: "filter conformance",
				why: "the client evaluator against the same fixture — and the client is BOTH " +
					"the UI and the saved view, because a saved view's filter is evaluated " +
					"locally against the replica; there is no server-side view listing path",
			},
		},
	},
	{
		number: 3,
		text: "An issue is assigned → exactly one notification row exists for the assignee, " +
			"and none for anybody else.",
		proofs: []proof{
			{
				file: "services/internal/domain/notifications_test.go",
				name: "TestFanOut_AssignmentNotifiesOnlyTheAssignee",
				why:  "the engine, asserted for the assignee, the actor and a watcher",
			},
			{
				file: "services/internal/domain/fanout_schedule_test.go",
				name: "TestFanOutAll_DeliversWithoutBeingToldWhichWorkspace",
				why: "and that anything runs it at all. The criterion was met by the engine " +
					"and not by the product for the whole milestone: FanOut had no caller " +
					"outside its own tests, so `notification` stayed empty on every live " +
					"system while this criterion read as green",
			},
		},
	},
	{
		number: 4,
		text:   "A sub-issue's completion updates its parent's progress with no extra round trip.",
		proofs: []proof{
			{
				file: "services/internal/graph/issue_roundtrip_test.go",
				name: "TestIssue_TheNestedFieldsResolveToWhatTheDatabaseHolds",
				why:  "Issue.progress resolves in the same response, rather than to null",
			},
			{
				file: "services/internal/domain/issue_bulk_test.go",
				name: "TestIssueProgress_CountsDirectChildrenOnly",
				why:  "and the number it resolves to is the right one",
			},
		},
	},
	{
		number: 5,
		text: "Deleting an issue and undoing within the window restores it, its comments and " +
			"its relations.",
		proofs: []proof{{
			file: "services/internal/domain/restore_stream_test.go",
			name: "TestRestoreIssue_LeavesAReplayedReplicaHoldingWhatABootstrapWouldGive",
			why: "stronger than the criterion: not only that the rows come back, but that a " +
				"replica which replayed the delete and the restore holds exactly what a " +
				"fresh bootstrap would give it — comments and relations included",
		}},
	},
	{
		number: 6,
		text:   "Filter with four active clauses re-renders in < 50 ms.",
		proofs: []proof{{
			file: "web/src/store/perf.test.ts",
			name: "filters, groups and sorts",
			why: "5,000 seeded issues, four active clauses, grouped and sorted, asserted " +
				"against the published 50ms rather than a CI allowance — it was 250ms, so a " +
				"run five times over budget would have passed and said nothing. Measuring " +
				"settled it: the median is a fraction of a millisecond, which is margin " +
				"enough that the real number can be the assertion",
		}},
	},
	{
		number: 7,
		text:   "Search returns in < 300 ms p95.",
		proofs: []proof{{
			file: "services/internal/domain/search_test.go",
			name: "TestSearch_ReturnsWithinTheP95Budget",
			why:  "asserted at the published value against the seeded workspace",
		}},
	},
	{
		number: 8,
		text: "The notification fan-out for a bulk update of 200 issues completes in < 2 s and " +
			"produces one row per affected subscriber, not per issue per subscriber.",
		proofs: []proof{
			{
				file: "services/internal/domain/notifications_test.go",
				name: "TestFanOut_BulkEditCoalescesIntoOneRowPerSubscriber",
				why:  "both halves: the coalescing and the wall clock",
			},
			{
				file: "services/internal/domain/notification_fanout_test.go",
				name: "TestFanOut_BulkEditGivesEachSubscriberExactlyOneRow",
				why:  "the count, seeded differently so the two cannot pass for one reason",
			},
		},
	},
	{
		number: 9,
		text:   "Every new mutation is reachable over the public API — api_parity_test.go enforces it.",
		proofs: []proof{
			{
				file: "services/internal/graph/api_parity_test.go",
				name: "TestAPIParity_EveryDomainMutationIsReachableOverGraphQL",
				why:  "the criterion names this test itself",
			},
			{
				file: "services/internal/graph/api_parity_coverage_test.go",
				name: "TestAPIParity_EveryDomainMethodIsClassified",
				why: "and that the parity test cannot be escaped by naming a mutation " +
					"something its verb list does not expect",
			},
		},
	},
	{
		number: 10,
		text: "Every new entity carries workspace_id and appears on the change stream with a " +
			"scope.",
		proofs: []proof{
			{
				file: "services/internal/store/workspace_scoping_test.go",
				name: "TestSchema_EveryTableCarriesWorkspaceID",
				why:  "the column, read out of the live schema rather than a list",
			},
			{
				file: "services/internal/domain/change_scope_test.go",
				name: "TestChangeStream_EveryEntityTypeArrivesWithAUsableScope",
				why:  "and the scope, exercised per entity type",
			},
		},
	},
}

// TestEveryM1CriterionStillHasItsProof is the manifest check.
func TestEveryM1CriterionStillHasItsProof(t *testing.T) {
	if len(m1) != 10 {
		t.Fatalf("the milestone lists ten acceptance criteria and this file holds %d", len(m1))
	}

	seen := map[int]bool{}
	for _, c := range m1 {
		if seen[c.number] {
			t.Errorf("criterion %d is listed twice", c.number)
		}
		seen[c.number] = true

		if len(c.proofs) == 0 {
			t.Errorf("criterion %d has no proof named at all:\n  %s", c.number, c.text)
			continue
		}

		for _, p := range c.proofs {
			source, err := os.ReadFile(filepath.Clean(filepath.Join(repoRoot, p.file)))
			if err != nil {
				t.Errorf("criterion %d cites %s, which cannot be read: %v\n  %s",
					c.number, p.file, err, c.text)
				continue
			}
			if !mentions(string(source), p.name) {
				t.Errorf("criterion %d cites %s in %s, and it is not there.\n\n"+
					"  criterion: %s\n"+
					"  that test: %s\n\n"+
					"A criterion whose proof has been renamed or removed is a criterion "+
					"nothing checks, listed as met in a document nobody re-reads. Point this "+
					"entry at whatever proves it now, or say plainly that nothing does.",
					c.number, p.name, p.file, c.text, p.why)
			}
		}
	}

	for n := 1; n <= 10; n++ {
		if !seen[n] {
			t.Errorf("criterion %d is missing from this file", n)
		}
	}
}

// TestTheWeakerProofsAreStated keeps the caveats honest rather than quiet.
//
// A criterion measured against a looser bound than it publishes is not met, and the useful
// thing to do with that is write it down where somebody deciding whether to ship will read
// it — not to delete the test, and not to let the manifest imply a pass it does not have.
func TestTheWeakerProofsAreStated(t *testing.T) {
	weak := 0
	for _, c := range m1 {
		if c.caveat == "" {
			continue
		}
		weak++
		t.Logf("criterion %d is NOT fully met:\n  %s\n  %s", c.number, c.text, c.caveat)
	}
	t.Logf("%d of %d criteria are fully proven; %d carry a stated caveat", len(m1)-weak, len(m1), weak)
}

// mentions finds a Go test function or a TypeScript test title.
//
// Substring rather than a parse, because the two languages would otherwise need two
// mechanisms for a question that is "does this name still appear where it is supposed to".
// A false pass would need somebody to write the test's name into the file without the test,
// which is not an accident anybody has.
func mentions(source, name string) bool {
	if strings.Contains(source, fmt.Sprintf("func %s(", name)) {
		return true
	}
	return strings.Contains(source, name)
}
