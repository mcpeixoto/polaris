package filter_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/filter"
)

// These tests are the half of the contract the conformance fixture does not cover.
//
// The fixture pins semantics — which issues come back — and is shared with the TypeScript
// evaluator, so it says nothing about the SQL. What is asserted here is the shape of the
// generated fragment and the strictness of validation: that a negation over a nullable
// column keeps its NULLs, that an empty in-list becomes a literal false rather than a
// skipped clause, and that no value a user typed ever reaches the SQL text.

const (
	ada   = "01900000-0000-7000-8000-0000000000a1"
	grace = "01900000-0000-7000-8000-0000000000a2"
	bug   = "01900000-0000-7000-8000-0000000000d3"
)

// lisbon is the fixture's timezone, and the one the relative-date cases resolve in.
var lisbon = mustLoad("Europe/Lisbon")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

func TestValidate(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		json string
		// wantErr is a substring of the required message. Empty means the filter must be
		// accepted.
		wantErr string
	}{
		// Accepted.
		{name: "the column default", json: `{}`},
		{name: "an explicit empty and", json: `{"conj":"and","nodes":[]}`},
		{name: "an explicit empty or", json: `{"conj":"or","nodes":[]}`},
		{name: "a group without a conj defaults to and", json: `{"nodes":[{"field":"priority","op":"eq","values":["1"]}]}`},
		{name: "json null is an absent filter", json: `null`},
		{name: "a nested group", json: `{"conj":"and","nodes":[{"conj":"or","nodes":[
			{"field":"assignee","op":"eq","values":["` + ada + `"]},
			{"field":"assignee","op":"isNull"}]}]}`},
		{name: "in with an empty list is meaningful, not an error", json: `{"field":"priority","op":"in","values":[]}`},
		{name: "isNull with an empty values array carries nothing", json: `{"field":"assignee","op":"isNull","values":[]}`},
		{name: "a relative token", json: `{"field":"createdAt","op":"gte","values":["-7d"]}`},
		{name: "a relative keyword", json: `{"field":"updatedAt","op":"gte","values":["startOfWeek"]}`},
		{name: "a due date takes a relative token too", json: `{"field":"dueDate","op":"lte","values":["+3d"]}`},
		{name: "contains on text", json: `{"field":"description","op":"contains","values":["acao"]}`},
		{name: "customer status", json: `{"field":"customerStatus","op":"eq","values":["churned"]}`},
		{name: "customer count", json: `{"field":"customerCount","op":"gte","values":["2"]}`},

		// Rejected. Each of these would otherwise widen the result set silently.
		{name: "an unknown field", json: `{"field":"sprint","op":"eq","values":["x"]}`, wantErr: "unknown field"},
		{name: "a misspelt field is not an empty group",
			json: `{"feild":"assignee","op":"eq","values":["` + ada + `"]}`, wantErr: "clause"},
		{name: "an unknown key", json: `{"wat":true}`, wantErr: "clause"},
		{name: "both shapes at once",
			json: `{"field":"priority","op":"eq","values":["1"],"nodes":[]}`, wantErr: "clause"},
		{name: "a clause without a field", json: `{"op":"eq","values":["1"]}`, wantErr: "clause"},
		{name: "an unknown operator", json: `{"field":"priority","op":"between","values":["1"]}`, wantErr: "operator"},
		{name: "contains on a number", json: `{"field":"priority","op":"contains","values":["1"]}`, wantErr: "operator"},
		{name: "gt on text", json: `{"field":"title","op":"gt","values":["a"]}`, wantErr: "operator"},
		{name: "gt on a uuid", json: `{"field":"team","op":"gt","values":["` + ada + `"]}`, wantErr: "operator"},
		{name: "isNull on a column that is not nullable",
			json: `{"field":"createdAt","op":"isNull"}`, wantErr: "operator"},
		{name: "isNull on a relation field", json: `{"field":"label","op":"isNull"}`, wantErr: "operator"},
		{name: "isNull carrying values",
			json: `{"field":"assignee","op":"isNull","values":["` + ada + `"]}`, wantErr: "values"},
		{name: "eq without values", json: `{"field":"assignee","op":"eq"}`, wantErr: "values"},
		{name: "eq with two values",
			json: `{"field":"assignee","op":"eq","values":["` + ada + `","` + grace + `"]}`, wantErr: "values"},
		{name: "a conjunction that is neither and nor or", json: `{"conj":"xor","nodes":[]}`, wantErr: "conjunction"},
		{name: "a bad conjunction deep in the tree",
			json: `{"conj":"and","nodes":[{"conj":"nand","nodes":[]}]}`, wantErr: "conjunction"},
		{name: "a clause deep in the tree is checked too",
			json: `{"conj":"or","nodes":[{"field":"sprint","op":"eq","values":["x"]}]}`, wantErr: "unknown field"},
		{name: "a value that is not a uuid",
			json: `{"field":"assignee","op":"eq","values":["not-a-uuid"]}`, wantErr: "uuid"},
		{name: "a value that is not a number",
			json: `{"field":"priority","op":"eq","values":["high"]}`, wantErr: "number"},
		{name: "an unrecognised state category",
			json: `{"field":"stateCategory","op":"eq","values":["frozen"]}`, wantErr: "category"},
		{name: "a boolean field takes true or false",
			json: `{"field":"archived","op":"eq","values":["yes"]}`, wantErr: "true or false"},
		{name: "a malformed date", json: `{"field":"dueDate","op":"lte","values":["01/09/2026"]}`, wantErr: "date"},
		{name: "a malformed timestamp",
			json: `{"field":"createdAt","op":"gte","values":["2026-08-15"]}`, wantErr: "timestamp"},
		{name: "a relative token nobody defined",
			json: `{"field":"createdAt","op":"gte","values":["-7 days"]}`, wantErr: "timestamp"},
		{name: "a relative unit nobody defined",
			json: `{"field":"createdAt","op":"gte","values":["-7h"]}`, wantErr: "timestamp"},
		{name: "values are strings on the wire",
			json: `{"field":"priority","op":"in","values":[1,2]}`, wantErr: "string"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := filter.Parse([]byte(tc.json))
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("rejected a valid filter: %v", err)
			case tc.wantErr != "" && err == nil:
				t.Fatalf("accepted a filter that must be rejected")
			case tc.wantErr != "" && !strings.Contains(err.Error(), tc.wantErr):
				t.Fatalf("message %q does not mention %q", err, tc.wantErr)
			}
		})
	}
}

// evaluatedAt is the fixed clock the relative-date cases resolve against. Midday UTC on a
// Saturday, so "startOfWeek" has a whole week to walk back through.
var evaluatedAt = time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC)

func TestCompile(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		json string
		sql  string
		args []any
	}{{
		name: "the canonical empty filter still carries the two defaults",
		json: `{}`,
		sql:  `(true AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "an or over nothing is vacuously false",
		json: `{"conj":"or","nodes":[]}`,
		sql:  `(false AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "eq binds a placeholder, never the value",
		json: `{"field":"assignee","op":"eq","values":["` + ada + `"]}`,
		sql:  `(issue.assignee_id = $1 AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{uuid.MustParse(ada)},
	}, {
		// The case the whole compiler exists for. NOT (NULL = 'ada') is NULL, so the
		// straightforward negation drops every unassigned issue.
		name: "neq over a nullable column keeps its nulls",
		json: `{"field":"assignee","op":"neq","values":["` + ada + `"]}`,
		sql: `((issue.assignee_id IS NULL OR NOT (issue.assignee_id = $1))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{uuid.MustParse(ada)},
	}, {
		name: "neq over a column that cannot be null stays plain",
		json: `{"field":"priority","op":"neq","values":["1"]}`,
		sql:  `(NOT (issue.priority = $1) AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{int32(1)},
	}, {
		name: "in becomes one array parameter",
		json: `{"field":"priority","op":"in","values":["1","2"]}`,
		sql:  `(issue.priority = ANY($1) AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{[]int32{1, 2}},
	}, {
		// The obvious SQL for an empty IN-list is a syntax error and the obvious fix is to
		// skip the clause, which turns "assigned to nobody in this list" into no filter.
		name: "an empty in-list is a literal false, not a skipped clause",
		json: `{"field":"priority","op":"in","values":[]}`,
		sql:  `(false AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "an empty not-in-list is a literal true",
		json: `{"field":"priority","op":"notIn","values":[]}`,
		sql:  `(true AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "not-in over a nullable column keeps its nulls too",
		json: `{"field":"estimate","op":"notIn","values":["1","2"]}`,
		sql: `((issue.estimate IS NULL OR NOT (issue.estimate = ANY($1)))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{[]int32{1, 2}},
	}, {
		name: "label membership is an EXISTS",
		json: `{"field":"label","op":"in","values":["` + bug + `"]}`,
		sql: `(EXISTS (SELECT 1 FROM issue_label f_label WHERE f_label.issue_id = issue.id` +
			` AND f_label.label_id = ANY($1))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{[]uuid.UUID{uuid.MustParse(bug)}},
	}, {
		// "has no label from this set", not "has some label that is not in this set". A
		// join would return a row per other label and match nearly every issue.
		name: "label notIn is a NOT EXISTS",
		json: `{"field":"label","op":"notIn","values":["` + bug + `"]}`,
		sql: `(NOT EXISTS (SELECT 1 FROM issue_label f_label WHERE f_label.issue_id = issue.id` +
			` AND f_label.label_id = ANY($1))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{[]uuid.UUID{uuid.MustParse(bug)}},
	}, {
		name: "an empty label in-list matches nothing",
		json: `{"field":"label","op":"in","values":[]}`,
		sql:  `(false AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "an empty label not-in-list matches everything",
		json: `{"field":"label","op":"notIn","values":[]}`,
		sql:  `(true AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "an unsubscribed row does not count as subscribed",
		json: `{"field":"subscriber","op":"eq","values":["` + grace + `"]}`,
		sql: `(EXISTS (SELECT 1 FROM issue_subscription f_sub WHERE f_sub.issue_id = issue.id` +
			` AND f_sub.unsubscribed = false AND f_sub.user_id = ANY($1))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{[]uuid.UUID{uuid.MustParse(grace)}},
	}, {
		name: "state category reads the status row rather than the issue",
		json: `{"field":"stateCategory","op":"in","values":["unstarted","started"]}`,
		sql: `(EXISTS (SELECT 1 FROM workflow_state f_state WHERE f_state.id = issue.state_id` +
			` AND f_state.category = ANY($1))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL)`,
		args: []any{[]string{"unstarted", "started"}},
	}, {
		name: "contains folds through the same function search does",
		json: `{"field":"title","op":"contains","values":["acao"]}`,
		sql: `(search_fold(issue.title) LIKE '%' || search_fold($1) || '%' ESCAPE '\'` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{"acao"},
	}, {
		// Somebody searching for "50%" wants the characters, not "anything ending in 50".
		name: "a wildcard in the needle is escaped, not honoured",
		json: `{"field":"title","op":"contains","values":["50% _done"]}`,
		sql: `(search_fold(issue.title) LIKE '%' || search_fold($1) || '%' ESCAPE '\'` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{`50\% \_done`},
	}, {
		name: "notContains negates the folded match",
		json: `{"field":"title","op":"notContains","values":["the"]}`,
		sql: `(NOT (search_fold(issue.title) LIKE '%' || search_fold($1) || '%' ESCAPE '\')` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{"the"},
	}, {
		name: "isNull needs no parameter at all",
		json: `{"field":"estimate","op":"isNull"}`,
		sql:  `(issue.estimate IS NULL AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		// Mentioning archived turns off the archived default for the whole query, and
		// leaves the deleted one alone: asking to see archived issues is not asking to
		// see deleted ones.
		name: "an archived clause turns off only the archived default",
		json: `{"field":"archived","op":"eq","values":["true"]}`,
		sql:  `(issue.archived_at IS NOT NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "archived false is the default, stated",
		json: `{"field":"archived","op":"eq","values":["false"]}`,
		sql:  `(issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "a deleted clause turns off only the deleted default",
		json: `{"field":"deleted","op":"eq","values":["true"]}`,
		sql:  `(issue.deleted_at IS NOT NULL AND issue.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "neq on a flag is the other value",
		json: `{"field":"archived","op":"neq","values":["true"]}`,
		sql:  `(issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "a flag in-list covering both values matches everything",
		json: `{"field":"archived","op":"in","values":["true","false"]}`,
		sql:  `(true AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		name: "a flag not-in-list covering both values matches nothing",
		json: `{"field":"archived","op":"notIn","values":["true","false"]}`,
		sql:  `(false AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
	}, {
		// The default is a property of the whole query, not of the group the clause is in.
		// Scoping it per group would let an OR resurrect deleted issues into a view that
		// never asked for them.
		name: "a clause deep inside an or still turns the default off globally",
		json: `{"conj":"or","nodes":[{"field":"priority","op":"eq","values":["1"]},
			{"field":"deleted","op":"eq","values":["true"]}]}`,
		sql:  `((issue.priority = $1 OR issue.deleted_at IS NOT NULL) AND issue.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{int32(1)},
	}, {
		name: "a nested group keeps its own parentheses",
		json: `{"conj":"and","nodes":[
			{"conj":"or","nodes":[{"field":"priority","op":"eq","values":["1"]},
			                      {"field":"priority","op":"eq","values":["4"]}]},
			{"field":"team","op":"eq","values":["` + ada + `"]}]}`,
		sql: `(((issue.priority = $1 OR issue.priority = $2) AND issue.team_id = $3)` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{int32(1), int32(4), uuid.MustParse(ada)},
	}, {
		name: "an absolute timestamp",
		json: `{"field":"createdAt","op":"lt","values":["2026-08-06T00:00:00Z"]}`,
		sql:  `(issue.created_at < $1 AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{time.Date(2026, 8, 6, 0, 0, 0, 0, time.UTC)},
	}, {
		// Resolved at evaluation time, in the workspace's timezone, and to the START of
		// the day: "in the last ten days" begins at midnight ten days ago, not at this
		// time of day ten days ago.
		name: "a relative day offset resolves to the start of that day, locally",
		json: `{"field":"createdAt","op":"gte","values":["-10d"]}`,
		sql:  `(issue.created_at >= $1 AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{time.Date(2026, 8, 5, 0, 0, 0, 0, lisbon)},
	}, {
		name: "today is the start of today",
		json: `{"field":"createdAt","op":"gte","values":["today"]}`,
		sql:  `(issue.created_at >= $1 AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{time.Date(2026, 8, 15, 0, 0, 0, 0, lisbon)},
	}, {
		// The clock says Saturday 15 August 2026, so the week began on Monday the 10th.
		// Go numbers Sunday as 0, which is the trap this pins.
		name: "startOfWeek walks back to Monday",
		json: `{"field":"updatedAt","op":"gte","values":["startOfWeek"]}`,
		sql:  `(issue.updated_at >= $1 AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{time.Date(2026, 8, 10, 0, 0, 0, 0, lisbon)},
	}, {
		name: "a month offset walks months, not thirty days",
		json: `{"field":"createdAt","op":"gte","values":["-1M"]}`,
		sql:  `(issue.created_at >= $1 AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{time.Date(2026, 7, 15, 0, 0, 0, 0, lisbon)},
	}, {
		name: "a due date is a calendar day",
		json: `{"field":"dueDate","op":"lte","values":["2026-09-01"]}`,
		sql:  `(issue.due_date <= $1 AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)},
	}, {
		name: "blockedBy reads the relation from the blocked end",
		json: `{"field":"blockedBy","op":"in","values":["` + ada + `"]}`,
		sql: `(EXISTS (SELECT 1 FROM issue_relation f_rel WHERE f_rel.related_issue_id = issue.id` +
			` AND f_rel.type = 'blocks' AND f_rel.issue_id = ANY($1))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{[]uuid.UUID{uuid.MustParse(ada)}},
	}, {
		name: "blocking reads the same row from the other end",
		json: `{"field":"blocking","op":"in","values":["` + ada + `"]}`,
		sql: `(EXISTS (SELECT 1 FROM issue_relation f_rel WHERE f_rel.issue_id = issue.id` +
			` AND f_rel.type = 'blocks' AND f_rel.related_issue_id = ANY($1))` +
			` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`,
		args: []any{[]uuid.UUID{uuid.MustParse(ada)}},
	}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			node, err := filter.Parse([]byte(tc.json))
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			got, err := filter.Compile(node, filter.Options{Now: evaluatedAt, Location: lisbon})
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			if got.SQL != tc.sql {
				t.Errorf("sql\n got: %s\nwant: %s", got.SQL, tc.sql)
			}
			if !argsEqual(got.Args, tc.args) {
				t.Errorf("args\n got: %#v\nwant: %#v", got.Args, tc.args)
			}
		})
	}
}

// argsEqual compares bound arguments, comparing instants by what they mean rather than by
// their internal representation: two time.Time values for the same moment in different
// locations are the same parameter as far as Postgres is concerned.
func argsEqual(got, want []any) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		g, gok := got[i].(time.Time)
		w, wok := want[i].(time.Time)
		if gok && wok {
			if !g.Equal(w) {
				return false
			}
			continue
		}
		if !reflect.DeepEqual(got[i], want[i]) {
			return false
		}
	}
	return true
}

// The compiler must never put a value into SQL text. Asserted over the whole grammar
// rather than over one clause, because one interpolated branch is all an injection needs
// and the branch that gets it wrong is the one nobody wrote a case for.
func TestNoValueReachesTheSQLText(t *testing.T) {
	t.Parallel()

	needle := "x' OR 1=1 --"
	filters := []string{
		`{"field":"title","op":"contains","values":["` + needle + `"]}`,
		`{"field":"title","op":"eq","values":["` + needle + `"]}`,
		`{"field":"description","op":"notContains","values":["` + needle + `"]}`,
		`{"field":"title","op":"in","values":["` + needle + `"]}`,
		`{"field":"title","op":"notIn","values":["` + needle + `"]}`,
	}

	for _, f := range filters {
		node, err := filter.Parse([]byte(f))
		if err != nil {
			t.Fatalf("parse %s: %v", f, err)
		}
		got, err := filter.Compile(node, filter.Options{})
		if err != nil {
			t.Fatalf("compile %s: %v", f, err)
		}
		if strings.Contains(got.SQL, "1=1") {
			t.Fatalf("value reached the SQL text: %s", got.SQL)
		}
		if len(got.Args) != 1 {
			t.Fatalf("expected the value to be bound as one argument, got %d", len(got.Args))
		}
	}
}

func TestArgOffset(t *testing.T) {
	t.Parallel()

	// The caller has already bound workspace_id as $1, so the fragment must start at $2.
	// Numbering from $1 regardless is the bug this pins: the fragment would silently read
	// the workspace id as its own first value and the query would still run.
	node, err := filter.Parse([]byte(`{"conj":"and","nodes":[
		{"field":"priority","op":"eq","values":["1"]},
		{"field":"assignee","op":"eq","values":["` + ada + `"]}]}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got, err := filter.Compile(node, filter.Options{ArgOffset: 1})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	want := `((issue.priority = $2 AND issue.assignee_id = $3)` +
		` AND issue.archived_at IS NULL AND issue.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = issue.state_id AND ws.category = 'triage'))`
	if got.SQL != want {
		t.Fatalf("sql\n got: %s\nwant: %s", got.SQL, want)
	}
}

func TestAlias(t *testing.T) {
	t.Parallel()

	node, err := filter.Parse([]byte(`{"field":"priority","op":"eq","values":["1"]}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	got, err := filter.Compile(node, filter.Options{Alias: "i"})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	want := `(i.priority = $1 AND i.archived_at IS NULL AND i.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = i.state_id AND ws.category = 'triage'))`
	if got.SQL != want {
		t.Fatalf("sql\n got: %s\nwant: %s", got.SQL, want)
	}

	// The alias is the only string that reaches SQL uninterpolated. It comes from the
	// caller rather than from a user, but so did every injection that ever shipped.
	if _, err := filter.Compile(node, filter.Options{Alias: `issue"; DROP TABLE issue; --`}); err == nil {
		t.Fatal("accepted an alias that is not an identifier")
	}
}

// A node that has been read and written again must mean the same thing.
//
// The case that matters is the empty OR group: with plain struct tags it serialises to {},
// which reads back as an empty AND and matches every issue in the workspace instead of
// none of them.
func TestRoundTrip(t *testing.T) {
	t.Parallel()

	for _, in := range []string{
		`{}`,
		`{"conj":"or","nodes":[]}`,
		`{"conj":"and","nodes":[]}`,
		`{"field":"assignee","op":"isNull"}`,
		`{"field":"priority","op":"in","values":["1","2"]}`,
		`{"conj":"or","nodes":[{"field":"priority","op":"eq","values":["1"]},
			{"conj":"and","nodes":[{"field":"assignee","op":"isNull"}]}]}`,
	} {
		node, err := filter.Parse([]byte(in))
		if err != nil {
			t.Fatalf("parse %s: %v", in, err)
		}
		first, err := filter.Compile(node, filter.Options{})
		if err != nil {
			t.Fatalf("compile %s: %v", in, err)
		}

		encoded, err := json.Marshal(node)
		if err != nil {
			t.Fatalf("marshal %s: %v", in, err)
		}
		reparsed, err := filter.Parse(encoded)
		if err != nil {
			t.Fatalf("reparse %s: %v", encoded, err)
		}
		second, err := filter.Compile(reparsed, filter.Options{})
		if err != nil {
			t.Fatalf("recompile %s: %v", encoded, err)
		}

		if first.SQL != second.SQL {
			t.Errorf("%s round-tripped to %s and changed meaning\n first: %s\nsecond: %s",
				in, encoded, first.SQL, second.SQL)
		}
	}
}

// A filter with no relative token must not depend on the clock at all, and one with a
// relative token must depend on nothing else.
func TestRelativeDatesResolveAtEvaluationTime(t *testing.T) {
	t.Parallel()

	node, err := filter.Parse([]byte(`{"field":"createdAt","op":"gte","values":["today"]}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	monday, err := filter.Compile(node, filter.Options{
		Now:      time.Date(2026, 3, 2, 9, 0, 0, 0, time.UTC),
		Location: lisbon,
	})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	thursday, err := filter.Compile(node, filter.Options{
		Now:      time.Date(2026, 3, 5, 9, 0, 0, 0, time.UTC),
		Location: lisbon,
	})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}

	// The same AST, two clocks, two answers. A view called "Updated today" that resolved
	// at save time would give the same answer for the rest of its life.
	if monday.Args[0].(time.Time).Equal(thursday.Args[0].(time.Time)) {
		t.Fatalf("today resolved to the same instant three days apart: %v", monday.Args[0])
	}
}

func TestHideCustomersMatchesNothing(t *testing.T) {
	t.Parallel()

	node, err := filter.Parse([]byte(`{"field":"customerCount","op":"eq","values":["0"]}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got, err := filter.Compile(node, filter.Options{HideCustomers: true})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if !strings.Contains(got.SQL, "false") {
		t.Fatalf("a guest customer filter must compile to false, got %s", got.SQL)
	}
	shown, err := filter.Compile(node, filter.Options{})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if !strings.Contains(shown.SQL, "COUNT") {
		t.Fatalf("a member customerCount filter must count requests, got %s", shown.SQL)
	}
}
