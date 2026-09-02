package store_test

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The index set is a gate, not a suggestion — every one of these sits under a query with
// no LIMIT, so its absence is a sequential scan plus a sort on a read path a user waits
// for. Asserting the names is the cheapest way to notice a migration that was written and
// never applied, or an index dropped by a later one that did not mean to.
//
// The planner's choice is not asserted: that depends on statistics a fresh test database
// does not have, and a test that fails on an empty table teaches nobody anything. What is
// asserted is that the index exists at all, which is the thing that was actually missing.
func TestHotPathIndexesExist(t *testing.T) {
	t.Parallel()

	db := testutil.NewDB(t)
	ctx := context.Background()

	// name → the read it exists for.
	wanted := map[string]string{
		"issue_team_sort_idx":             "ListIssuesForTeam — the team board, the hottest read in the product",
		"issue_assignee_updated_idx":      "ListMyIssues — every user, every session",
		"issue_archived_idx":              "ListArchivedIssuesForTeam — every other partial index excludes archived rows",
		"issue_creator_idx":               "the filter grammar's `creator` field, and every user deletion",
		"notification_issue_idx":          "the ON DELETE CASCADE Postgres runs on every issue delete",
		"notification_comment_idx":        "the ON DELETE CASCADE Postgres runs on every comment delete",
		"favorite_target_idx":             "ListFavoritesForTarget — once per restored issue",
		"webhook_delivery_created_at_idx": "the nightly webhook_delivery retention delete",
		"change_log_created_at_idx":       "the nightly change_log retention delete, on the highest-write table",
		"audit_log_created_at_idx":        "the 90-day audit_log retention this makes bounded",
	}

	for name, why := range wanted {
		var exists bool
		err := db.Pool().QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relkind IN ('i', 'I') AND relname = $1)`,
			name,
		).Scan(&exists)
		if err != nil {
			t.Fatalf("look up %s: %v", name, err)
		}
		if !exists {
			t.Errorf("index %s is missing; it is what makes %s an index scan rather than a full table scan", name, why)
		}
	}
}
