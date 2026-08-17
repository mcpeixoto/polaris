package store_test

import (
	"context"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 10 in docs/07-milestones/01-milestone-1.md, first half:
//
//	Every new entity carries `workspace_id`.
//
// Only this level can prove it, and until now nothing did. The claim is about the shape of
// the schema rather than the behaviour of any one query, so no domain test can reach it: a
// table with no `workspace_id` behaves perfectly until the day a second workspace exists,
// at which point either the rows leak across the boundary or the query that was supposed to
// filter them was never written. Both failures arrive in production, in a multi-tenant
// install, as somebody seeing another company's data.
//
// The enumeration is dynamic. A hardcoded list of tables would pass forever after somebody
// adds the table it does not know about, which is precisely the event this is for — the
// criterion says "every NEW entity", so the test has to learn about new tables by itself.

// tablesWithoutWorkspaceID names the tables that legitimately have no `workspace_id`, each
// with the reason.
//
// Every entry is an argument that had to be made in review rather than an omission that
// happened. Three of them exist because the row is older than any workspace, and one
// because it hangs off a user who already carries one.
var tablesWithoutWorkspaceID = map[string]string{
	"account": "a person, not a membership: one account signs in to several workspaces, " +
		"and the workspace-scoped identity is `user`",
	"account_credential": "belongs to an account, before any workspace is chosen",
	"account_session":    "belongs to an account: a session spans the workspaces it can reach",

	"notification_email_cursor": "keyed by user_id, which is itself workspace-scoped; the " +
		"cursor is a delivery watermark rather than an entity anybody reads",

	"schema_migrations": "the migration tool's own bookkeeping",
}

// selfScoped names the tables whose workspace scope is their own primary key rather than a
// `workspace_id` column. Listed separately from the exemptions because the invariant holds
// for them — it is just spelled differently.
var selfScoped = map[string]string{
	"workspace": "the workspace itself: `id` IS the workspace id",
}

func TestSchema_EveryTableCarriesWorkspaceID(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()

	// Base tables only. Partitions inherit their parent's columns and would otherwise show
	// up as separate findings saying the same thing twice; views have no storage.
	const q = `
		SELECT c.relname,
		       EXISTS (
		         SELECT 1 FROM pg_attribute a
		         WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND a.attnum > 0
		           AND NOT a.attisdropped
		       )
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relkind IN ('r', 'p')
		  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
		ORDER BY c.relname`

	rows, err := db.Pool().Query(ctx, q)
	if err != nil {
		t.Fatalf("enumerate tables: %v", err)
	}
	type table struct {
		Name string
		Has  bool
	}
	tables, err := pgx.CollectRows(rows, pgx.RowToStructByPos[table])
	if err != nil {
		t.Fatalf("scan tables: %v", err)
	}
	// A guard against the query silently matching nothing, which would make this test pass
	// by enumerating an empty set — the most convincing kind of false green.
	if len(tables) < 20 {
		t.Fatalf("found only %d tables; the enumeration is wrong, not the schema", len(tables))
	}

	var missing []string
	for _, tbl := range tables {
		if tbl.Has {
			// A table that carries the column must not also claim an exemption, or the
			// exemption outlives the reason it was granted.
			if reason, ok := tablesWithoutWorkspaceID[tbl.Name]; ok {
				t.Errorf("%s carries workspace_id but is still listed as exempt (%q); remove the entry",
					tbl.Name, reason)
			}
			continue
		}
		if _, ok := selfScoped[tbl.Name]; ok {
			continue
		}
		if _, ok := tablesWithoutWorkspaceID[tbl.Name]; ok {
			continue
		}
		missing = append(missing, tbl.Name)
	}

	sort.Strings(missing)
	for _, name := range missing {
		t.Errorf(
			"table %q has no workspace_id column.\n"+
				"docs/07-milestones/01-milestone-1.md acceptance test 10 requires every entity to carry\n"+
				"one: it is what the visibility predicate filters on and what makes a multi-tenant\n"+
				"install safe by construction rather than by remembering a WHERE clause at each call\n"+
				"site. Either add the column, or add %q to tablesWithoutWorkspaceID with the reason.",
			name, name)
	}
}

// The exemption list must not rot. An entry naming a table that no longer exists reads as a
// considered decision about the current schema and is not one.
func TestSchema_EveryWorkspaceIDExemptionNamesARealTable(t *testing.T) {
	db := testutil.NewDB(t)
	ctx := context.Background()

	present := map[string]bool{}
	rows, err := db.Pool().Query(ctx,
		`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`)
	if err != nil {
		t.Fatalf("enumerate tables: %v", err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("scan tables: %v", err)
	}
	for _, n := range names {
		present[n] = true
	}

	for _, set := range []map[string]string{tablesWithoutWorkspaceID, selfScoped} {
		for name, reason := range set {
			if reason == "" {
				t.Errorf("%s is exempt from the workspace_id rule with no reason given", name)
			}
			// schema_migrations is created by the migration tool rather than by a
			// migration, so it may legitimately be absent from a freshly templated
			// database. Everything else must exist.
			if name == "schema_migrations" {
				continue
			}
			if !present[name] {
				t.Errorf("%s is listed as exempt from the workspace_id rule but no such table exists; "+
					"remove the entry rather than leaving a decision about a table nobody has", name)
			}
		}
	}
}
