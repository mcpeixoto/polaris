package domain_test

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Search, against the seeded workspace M1 sizes its performance budgets against.
//
// Before this file `domain.Search` had no test of any kind — not a correctness one and not
// a timing one — which is worth stating plainly because search is the one read path in the
// product that runs its own SQL rather than reading the replica. The client cannot cover
// it: it is asked precisely when the answer is not in the local store.
//
// The seeded corpus is 5,000 issues and 2,000 comments, which is the size
// docs/07-milestones/01-milestone-1.md names for acceptance tests 6, 7 and 8. It is
// inserted with COPY rather than through the domain layer because 5,000 transactions would
// make the fixture cost more than everything it measures, and nothing here is testing the
// write path.
const (
	searchCorpusIssues   = 5000
	searchCorpusComments = 2000

	// The M1 budget for acceptance test 7, asserted at its stated value rather than an
	// inflated one. See the note on honesty in the p95 test itself.
	searchBudget = 300 * time.Millisecond
)

// searchVocabulary is what the seeded titles and bodies are built from.
//
// Deliberately Zipfian rather than uniform: `frequent` lands on roughly a seventh of the
// corpus and `rare` on a handful. A corpus where every term matches the same number of
// rows measures one planner decision over and over, and the term that actually hurts — the
// common one, where the GIN scan returns a large candidate set that then has to be ranked —
// would never appear.
var searchVocabulary = []struct {
	term  string
	every int
}{
	{"authentication", 7},
	{"rendering", 3},
	{"migration", 11},
	{"ação", 23}, // Accented, so the folded index is exercised rather than bypassed.
	{"telemetry", 97},
}

// seedSearchCorpus writes the issues and comments the timing tests measure over.
func seedSearchCorpus(t *testing.T, f *testutil.Fixture) {
	t.Helper()
	ctx := context.Background()
	pool := f.DB.Pool()

	// Read the state id the fixture seeded rather than inventing one: a COPY does not fire
	// the foreign key checks any later than an INSERT would, and a wrong id here surfaces
	// as a constraint error a hundred rows into the copy with no indication of which.
	issueRows := make([][]any, 0, searchCorpusIssues)
	issueIDs := make([]uuid.UUID, 0, searchCorpusIssues)
	for i := range searchCorpusIssues {
		id := uuid.Must(uuid.NewV7())
		issueIDs = append(issueIDs, id)

		var words []string
		for _, v := range searchVocabulary {
			if i%v.every == 0 {
				words = append(words, v.term)
			}
		}
		// Every issue gets at least one searchable word, so an empty result set never
		// stands in for a fast one.
		if len(words) == 0 {
			words = []string{"backlog"}
		}

		issueRows = append(issueRows, []any{
			id, f.WorkspaceID, f.TeamID, int64(1000 + i),
			fmt.Sprintf("Issue %d about %s", i, strings.Join(words, " and ")),
			fmt.Sprintf("A description mentioning %s at length.", words[0]),
			f.Backlog, f.UserID, int16(i % 5), fmt.Sprintf("a%06d", i),
		})
	}

	if _, err := pool.CopyFrom(ctx,
		pgx.Identifier{"issue"},
		[]string{
			"id", "workspace_id", "team_id", "number", "title", "description",
			"state_id", "creator_id", "priority", "sort_order",
		},
		pgx.CopyFromRows(issueRows),
	); err != nil {
		t.Fatalf("seed %d issues: %v", searchCorpusIssues, err)
	}

	commentRows := make([][]any, 0, searchCorpusComments)
	for i := range searchCorpusComments {
		term := searchVocabulary[i%len(searchVocabulary)].term
		commentRows = append(commentRows, []any{
			uuid.Must(uuid.NewV7()), f.WorkspaceID, issueIDs[i%len(issueIDs)],
			fmt.Sprintf("Comment %d: this is about %s and nothing else.", i, term),
			"user", f.UserID,
		})
	}
	if _, err := pool.CopyFrom(ctx,
		pgx.Identifier{"comment"},
		[]string{"id", "workspace_id", "issue_id", "body", "actor_type", "actor_id"},
		pgx.CopyFromRows(commentRows),
	); err != nil {
		t.Fatalf("seed %d comments: %v", searchCorpusComments, err)
	}

	// ANALYZE, because a table that has only ever been COPYed into has no statistics and
	// the planner falls back on a default selectivity guess. Without this the test would
	// measure the plan an empty table gets, which is not the plan production runs and is
	// occasionally the faster of the two — so omitting it would make the number optimistic
	// rather than merely noisy.
	if _, err := pool.Exec(ctx, "ANALYZE issue, comment"); err != nil {
		t.Fatalf("analyze: %v", err)
	}
}

// Acceptance test 7 in docs/07-milestones/01-milestone-1.md:
//
//	Search returns in < 300 ms p95.
//
// Only this level can prove it. The client's own timing tests measure the replica, and
// search is definitionally the query asked when the answer is not in the replica; the
// filter package's conformance suite runs SQL but hand-writes its own query rather than
// calling the read path a request takes. What is measured here is one whole
// `domain.Search` call — four queries, the folding, the ranking and the row mapping —
// because that is what the 300 ms is a budget for.
func TestSearch_ReturnsWithinTheP95Budget(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	seedSearchCorpus(t, f)

	// Queries chosen to span the planner's range: a term on a seventh of the corpus, a
	// term on a third, a two-token AND, an accented term reached through the fold, and a
	// prefix of a word still being typed. Measuring only the selective one would report
	// the best case as the p95.
	queries := []string{
		"authentication",
		"rendering",
		"authentication migration",
		"acao",
		"telem",
	}

	// One untimed pass first. The first query of a process pays for connection setup, the
	// plan cache and a cold buffer pool, none of which a user's ninety-fifth percentile
	// includes — leaving it in would measure the harness rather than the product.
	for _, q := range queries {
		if _, err := svc.Search(ctx, p, domain.SearchInput{Query: q}); err != nil {
			t.Fatalf("warm-up search %q: %v", q, err)
		}
	}

	const samples = 60
	elapsed := make([]time.Duration, 0, samples)
	for i := range samples {
		q := queries[i%len(queries)]
		start := time.Now()
		got, err := svc.Search(ctx, p, domain.SearchInput{Query: q})
		took := time.Since(start)
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		// A search that matched nothing is a fast search that proves nothing, so the
		// timing is only meaningful alongside the assertion that there was work to do.
		if len(got.Issues) == 0 {
			t.Fatalf("search %q matched no issues; the corpus is not what this measures over", q)
		}
		elapsed = append(elapsed, took)
	}

	sort.Slice(elapsed, func(i, j int) bool { return elapsed[i] < elapsed[j] })
	p95 := elapsed[(len(elapsed)*95)/100]
	median := elapsed[len(elapsed)/2]

	t.Logf("search over %d issues and %d comments: median %s, p95 %s, worst %s (budget %s)",
		searchCorpusIssues, searchCorpusComments, median, p95, elapsed[len(elapsed)-1], searchBudget)

	if p95 > searchBudget {
		t.Errorf("search p95 is %s over %d issues, past the %s budget "+
			"(docs/07-milestones/01-milestone-1.md, acceptance test 7); median %s, worst %s",
			p95, searchCorpusIssues, searchBudget, median, elapsed[len(elapsed)-1])
	}
}

// The honest half of acceptance test 7.
//
// At five thousand issues a sequential scan is also fast, so the wall-clock assertion above
// has two orders of magnitude of slack and would not notice search losing its index — it
// would notice at fifty thousand, in production, in a report about the command menu hanging.
// A timing budget that cannot fail is a claim of evidence rather than evidence, so the
// mechanism is pinned separately here: the plan for the predicate `SearchIssues` runs must
// reach the rows through `issue_search_idx`, not by reading the table.
//
// The coupling is deliberate and is the test's one weakness: this repeats the predicate
// from internal/store/queries/search.sql rather than executing that query, because the
// generated query cannot be handed to EXPLAIN. If the two drift, this keeps passing while
// search regresses — so the predicate is quoted here exactly, and changing one means
// changing the other.
func TestSearch_ReachesTheRowsThroughTheFullTextIndex(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	ctx := context.Background()

	seedSearchCorpus(t, f)

	// enable_seqscan stays on: forcing the index would prove only that the index can be
	// used, not that the planner chooses it, and the planner choosing a scan is the actual
	// regression.
	const explain = `EXPLAIN (FORMAT TEXT)
		SELECT i.id FROM issue i
		WHERE i.workspace_id = $1
		  AND i.team_id = ANY($2::uuid[])
		  AND i.archived_at IS NULL
		  AND i.deleted_at IS NULL
		  AND issue_search_vector(i.title, i.description) @@ to_tsquery('simple', search_fold($3::text))
		ORDER BY ts_rank_cd(issue_search_vector(i.title, i.description),
		                    to_tsquery('simple', search_fold($3::text))) DESC,
		         i.updated_at DESC
		LIMIT 25`

	rows, err := db.Pool().Query(ctx, explain, f.WorkspaceID, []uuid.UUID{f.TeamID}, "authentication")
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	defer rows.Close()

	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan plan: %v", err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read plan: %v", err)
	}

	if !strings.Contains(plan.String(), "issue_search_idx") {
		t.Errorf("search does not use the full-text index. The plan was:\n%s\n"+
			"Acceptance test 7's 300ms budget passes at %d issues on a sequential scan too, so "+
			"this is the assertion that catches the regression while the corpus is still small.",
			plan.String(), searchCorpusIssues)
	}
}

// Acceptance test 2, the half that is false today.
//
//	A filter expressed in the UI, in a saved view and in a search returns identical ids
//	for the same workspace state.
//
// THIS TEST DOCUMENTS A DEFECT. It asserts the behaviour the code has, not the behaviour
// the criterion claims, and it exists so that the gap is visible in the test output and so
// that fixing it fails here rather than passing silently.
//
// `domain.Search` accepts a filter AST, validates it against the same grammar saved views
// use — and then never applies it. `SearchInput.Filter` is read once by `filter.Parse` and
// referenced nowhere afterwards; `store.SearchIssuesParams` has no filter field and the SQL
// in internal/store/queries/search.sql has no filter fragment. `filter.Compile`, the
// function that turns the AST into that fragment, has no caller anywhere outside tests.
//
// The consequence is the exact failure docs/07-milestones/01-milestone-1.md names as the
// reason the grammar is one compiler: "ignoring one silently widens the result set, and a
// filter that quietly matches more than it says is what makes people stop trusting
// filters." schema/schema.graphql advertises the opposite to every API caller — "a search
// and a saved view with identical filters return identical ids" — and an integration
// holding no replica has nothing to narrow the results with.
//
// When search learns to apply the filter, this test will fail. Replace it then with the
// inverted assertion: `filtered` must contain only the P0 issue, and `len(filtered) <
// len(unfiltered)` becomes the point rather than the defect.
func TestSearch_IgnoresTheFilterItAccepts_DOCUMENTS_A_DEFECT(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	// Three issues that all match the query and differ only in priority, so a filter on
	// priority is the only thing that could tell them apart.
	for i, priority := range []int{0, 0, 1} {
		id := uuid.Must(uuid.NewV7())
		if _, err := db.Pool().Exec(ctx,
			`INSERT INTO issue (id, workspace_id, team_id, number, title, description,
			                    state_id, creator_id, priority, sort_order)
			 VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8, $9)`,
			id, f.WorkspaceID, f.TeamID, int64(500+i),
			fmt.Sprintf("Widget %d needs attention", i),
			f.Backlog, f.UserID, priority, fmt.Sprintf("b%03d", i),
		); err != nil {
			t.Fatalf("seed issue %d: %v", i, err)
		}
	}

	unfiltered, err := svc.Search(ctx, p, domain.SearchInput{Query: "widget"})
	if err != nil {
		t.Fatalf("unfiltered search: %v", err)
	}
	if len(unfiltered.Issues) != 3 {
		t.Fatalf("the corpus is not what this test assumes: %d hits, want 3", len(unfiltered.Issues))
	}

	// A filter the grammar accepts and the compiler can turn into SQL: exactly the AST a
	// saved view would hold, narrowing three issues to one.
	urgentOnly, err := json.Marshal(map[string]any{
		"field": "priority", "op": "eq", "values": []string{"1"},
	})
	if err != nil {
		t.Fatalf("marshal filter: %v", err)
	}

	filtered, err := svc.Search(ctx, p, domain.SearchInput{Query: "widget", Filter: urgentOnly})
	if err != nil {
		t.Fatalf("filtered search: %v", err)
	}

	if len(filtered.Issues) != len(unfiltered.Issues) {
		t.Fatalf("search now narrows by its filter (%d hits filtered vs %d unfiltered). "+
			"That is the fix this test was written to wait for — acceptance test 2 is no "+
			"longer failing, so replace this test with the assertion that only the P0 issue "+
			"comes back.", len(filtered.Issues), len(unfiltered.Issues))
	}

	t.Logf("acceptance test 2 FAILS: search returned all %d hits for a filter that selects 1. "+
		"SearchInput.Filter is validated and discarded; filter.Compile has no production caller.",
		len(filtered.Issues))
}
