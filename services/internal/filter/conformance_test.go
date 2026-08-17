package filter_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	// The fixture pins a timezone by name. A machine without a zoneinfo database would
	// fall back to UTC without saying so and move every relative date by an hour, so the
	// table is embedded and the test answers the same question everywhere it runs.
	_ "time/tzdata"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/peixotolabs/polaris/services/internal/filter"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The conformance fixture, run against a real Postgres.
//
// schema/filter-conformance.json is the contract between this package and web/src/filter.
// Neither suite computes the expected answer: it is recorded in the file, so a change that
// makes both implementations agree on something wrong still fails. That is the whole point
// of the file — two evaluators that agree with each other and disagree with the spec are
// exactly as broken as one that is simply wrong, and much harder to notice.
//
// The workspace goes in through raw SQL rather than through the domain layer. The fixture
// names its own ids and carries archived and soft-deleted issues, neither of which the
// create path produces, and routing it through the domain layer would make this test fail
// whenever issue creation had a bug — a conformance failure pointing at the wrong
// subsystem.

// idPrefix expands the fixture's short names: "e1" is ...-0000000000e1 and "a11" is
// ...-000000000a11. Written out in full those arrays are unreadable, and an unreadable
// fixture is one nobody checks when it disagrees with them.
const idPrefix = "01900000-0000-7000-8000-"

// uuidFields are the fields whose values are ids, and therefore the ones whose values get
// expanded.
//
// Decided by field rather than by the shape of the string. A pattern match would be a
// guess, and the day somebody adds {"field":"title","op":"contains","values":["e2"]} the
// guess turns a text search into a uuid and the case fails for a reason nobody can see.
var uuidFields = map[string]bool{
	"state": true, "assignee": true, "creator": true, "subscriber": true,
	"label": true, "team": true, "parent": true, "blockedBy": true, "blocking": true,
}

type conformance struct {
	EvaluatedAt time.Time `json:"evaluatedAt"`
	Timezone    string    `json:"timezone"`

	Workspace struct {
		ID     uuid.UUID `json:"id"`
		Name   string    `json:"name"`
		URLKey string    `json:"urlKey"`
		Plan   string    `json:"plan"`
	} `json:"workspace"`

	Users []struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
		Role string    `json:"role"`
	} `json:"users"`

	Teams []struct {
		ID   uuid.UUID `json:"id"`
		Key  string    `json:"key"`
		Name string    `json:"name"`
	} `json:"teams"`

	WorkflowStates []struct {
		ID        uuid.UUID `json:"id"`
		TeamID    uuid.UUID `json:"teamId"`
		Name      string    `json:"name"`
		Category  string    `json:"category"`
		Position  string    `json:"position"`
		IsDefault bool      `json:"isDefault"`
	} `json:"workflowStates"`

	Labels []struct {
		ID       uuid.UUID  `json:"id"`
		Name     string     `json:"name"`
		Color    string     `json:"color"`
		Position string     `json:"position"`
		IsGroup  bool       `json:"isGroup"`
		ParentID *uuid.UUID `json:"parentId"`
		TeamID   *uuid.UUID `json:"teamId"`
	} `json:"labels"`

	Issues []struct {
		ID                uuid.UUID   `json:"id"`
		TeamID            uuid.UUID   `json:"teamId"`
		Number            int64       `json:"number"`
		Title             string      `json:"title"`
		Description       string      `json:"description"`
		StateID           uuid.UUID   `json:"stateId"`
		AssigneeID        *uuid.UUID  `json:"assigneeId"`
		CreatorID         *uuid.UUID  `json:"creatorId"`
		Priority          int         `json:"priority"`
		Estimate          *int        `json:"estimate"`
		DueDate           *string     `json:"dueDate"`
		ParentID          *uuid.UUID  `json:"parentId"`
		SortOrder         string      `json:"sortOrder"`
		SubIssueSortOrder *string     `json:"subIssueSortOrder"`
		LabelIDs          []uuid.UUID `json:"labelIds"`
		CompletedAt       *time.Time  `json:"completedAt"`
		ArchivedAt        *time.Time  `json:"archivedAt"`
		DeletedAt         *time.Time  `json:"deletedAt"`
		CreatedAt         time.Time   `json:"createdAt"`
		UpdatedAt         time.Time   `json:"updatedAt"`
	} `json:"issues"`

	Relations []struct {
		ID             uuid.UUID `json:"id"`
		IssueID        uuid.UUID `json:"issueId"`
		RelatedIssueID uuid.UUID `json:"relatedIssueId"`
		Type           string    `json:"type"`
	} `json:"relations"`

	Subscriptions []struct {
		ID           uuid.UUID `json:"id"`
		IssueID      uuid.UUID `json:"issueId"`
		UserID       uuid.UUID `json:"userId"`
		Reason       string    `json:"reason"`
		Unsubscribed bool      `json:"unsubscribed"`
	} `json:"subscriptions"`

	Cases []struct {
		Name   string          `json:"name"`
		Filter json.RawMessage `json:"filter"`
		Expect []string        `json:"expect"`
	} `json:"cases"`

	Errors []struct {
		Name    string          `json:"name"`
		Filter  json.RawMessage `json:"filter"`
		Message string          `json:"message"`
	} `json:"errors"`
}

func loadConformance(t *testing.T) *conformance {
	t.Helper()
	path := filepath.Join("..", "..", "..", "schema", "filter-conformance.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var c conformance
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return &c
}

// expandID turns a short fixture name into the id it stands for, and leaves anything
// already written out in full alone.
func expandID(name string) string {
	if len(name) == len(idPrefix)+12 {
		return name
	}
	return idPrefix + strings.Repeat("0", 12-len(name)) + name
}

// expandFilter rewrites the short ids inside a case's filter so the compiler sees the same
// bytes a real client would send.
func expandFilter(t *testing.T, raw json.RawMessage) json.RawMessage {
	t.Helper()

	var node map[string]any
	if err := json.Unmarshal(raw, &node); err != nil {
		t.Fatalf("parse case filter: %v", err)
	}
	expandNode(t, node)

	out, err := json.Marshal(node)
	if err != nil {
		t.Fatalf("re-encode case filter: %v", err)
	}
	return out
}

func expandNode(t *testing.T, node map[string]any) {
	t.Helper()

	if field, ok := node["field"].(string); ok && uuidFields[field] {
		values, _ := node["values"].([]any)
		for i, v := range values {
			s, ok := v.(string)
			if !ok {
				t.Fatalf("case filter: %s value %d is not a string", field, i)
			}
			values[i] = expandID(s)
		}
	}
	children, _ := node["nodes"].([]any)
	for _, child := range children {
		m, ok := child.(map[string]any)
		if !ok {
			t.Fatalf("case filter: a group's node is not an object")
		}
		expandNode(t, m)
	}
}

func TestConformance(t *testing.T) {
	t.Parallel()

	fx := loadConformance(t)
	loc, err := time.LoadLocation(fx.Timezone)
	if err != nil {
		t.Fatalf("load timezone %s: %v", fx.Timezone, err)
	}

	db := testutil.NewDB(t)
	ctx := context.Background()
	insertWorkspace(t, ctx, db.Pool(), fx)

	for _, tc := range fx.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			node, err := filter.Parse(expandFilter(t, tc.Filter))
			if err != nil {
				t.Fatalf("parse: %v", err)
			}

			compiled, err := filter.Compile(node, filter.Options{
				Now:      fx.EvaluatedAt,
				Location: loc,
				// The workspace scope belongs to the caller, exactly as it does in the
				// domain layer: this package compiles a fragment, never a whole query.
				ArgOffset: 1,
			})
			if err != nil {
				t.Fatalf("compile: %v", err)
			}

			query := `SELECT id FROM issue WHERE workspace_id = $1 AND ` + compiled.SQL
			args := append([]any{fx.Workspace.ID}, compiled.Args...)

			rows, err := db.Pool().Query(ctx, query, args...)
			if err != nil {
				t.Fatalf("query: %v\n%s\nargs: %v", err, query, args)
			}
			got, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
			if err != nil {
				t.Fatalf("scan: %v\n%s", err, query)
			}

			gotIDs := make([]string, 0, len(got))
			for _, id := range got {
				gotIDs = append(gotIDs, id.String())
			}
			wantIDs := make([]string, 0, len(tc.Expect))
			for _, name := range tc.Expect {
				wantIDs = append(wantIDs, expandID(name))
			}
			slices.Sort(gotIDs)
			slices.Sort(wantIDs)

			// Compared as a set. Ordering is a display option and is tested separately;
			// mixing the two here would make an ordering change look like a filter
			// regression.
			if !slices.Equal(gotIDs, wantIDs) {
				t.Fatalf("id set mismatch\n got: %v\nwant: %v\nsql:  %s\nargs: %v",
					shortIDs(gotIDs), shortIDs(wantIDs), compiled.SQL, compiled.Args)
			}
		})
	}

	for _, tc := range fx.Errors {
		t.Run("rejects/"+tc.Name, func(t *testing.T) {
			_, err := filter.Parse(expandFilter(t, tc.Filter))
			if err == nil {
				t.Fatalf("accepted a filter that must be rejected: %s", tc.Filter)
			}
			// A rejection carrying an unrecognisable message is only marginally better
			// than no rejection: whoever wrote the filter has to be told which part of it
			// the server could not read.
			if !strings.Contains(err.Error(), tc.Message) {
				t.Fatalf("message %q does not mention %q", err.Error(), tc.Message)
			}
		})
	}
}

// A needle is a substring, not a pattern.
//
// The fixture cannot pin this, because both evaluators would have to agree on what a
// wildcard means and neither offers one. What it pins instead is that Postgres honours the
// escaping the compiler emits: filter_test.go asserts the escaped needle is bound, and
// this asserts the database then reads it literally. Without both halves, somebody
// searching for "50%" gets every issue whose title starts with 50.
func TestContainsIsASubstringNotAPattern(t *testing.T) {
	t.Parallel()

	fx := loadConformance(t)
	db := testutil.NewDB(t)
	ctx := context.Background()
	insertWorkspace(t, ctx, db.Pool(), fx)

	literal := fx.Issues[0].ID
	decoy := fx.Issues[1].ID
	if _, err := db.Pool().Exec(ctx,
		`UPDATE issue SET title = CASE id WHEN $1 THEN 'Fix the 50% _redirect' ELSE 'Fix the 50XX yredirect' END
		 WHERE id IN ($1, $2)`, literal, decoy); err != nil {
		t.Fatalf("retitle: %v", err)
	}

	node, err := filter.Parse([]byte(`{"field":"title","op":"contains","values":["50% _redirect"]}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	compiled, err := filter.Compile(node, filter.Options{ArgOffset: 1})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}

	rows, err := db.Pool().Query(ctx,
		`SELECT id FROM issue WHERE workspace_id = $1 AND `+compiled.SQL,
		append([]any{fx.Workspace.ID}, compiled.Args...)...)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(got) != 1 || got[0] != literal {
		t.Fatalf("the wildcards were honoured rather than escaped: got %v, want [%v]", got, literal)
	}
}

// shortIDs trims the shared prefix back off, so a failure reads in the fixture's own
// vocabulary instead of as seven near-identical uuids.
func shortIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, strings.TrimLeft(strings.TrimPrefix(id, idPrefix), "0"))
	}
	return out
}

// insertWorkspace writes the fixture with raw SQL, in dependency order.
func insertWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fx *conformance) {
	t.Helper()

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture insert: %v\n%s\nargs: %v", err, sql, args)
		}
	}

	exec(`INSERT INTO workspace (id, name, url_key, plan) VALUES ($1, $2, $3, $4)`,
		fx.Workspace.ID, fx.Workspace.Name, fx.Workspace.URLKey, fx.Workspace.Plan)

	for _, u := range fx.Users {
		exec(`INSERT INTO "user" (id, workspace_id, name, display_name, role) VALUES ($1, $2, $3, $3, $4)`,
			u.ID, fx.Workspace.ID, u.Name, u.Role)
	}

	for _, tm := range fx.Teams {
		exec(`INSERT INTO team (id, workspace_id, key, name) VALUES ($1, $2, $3, $4)`,
			tm.ID, fx.Workspace.ID, tm.Key, tm.Name)
	}

	for _, s := range fx.WorkflowStates {
		exec(`INSERT INTO workflow_state (id, workspace_id, team_id, name, category, position, is_default)
		      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			s.ID, fx.Workspace.ID, s.TeamID, s.Name, s.Category, s.Position, s.IsDefault)
	}

	// Groups before their children: label_parent_integrity reads the parent row and
	// refuses a parent that is absent or is not a group. The fixture lists them in that
	// order and this loop preserves it.
	for _, l := range fx.Labels {
		exec(`INSERT INTO label (id, workspace_id, team_id, parent_id, is_group, name, color, position)
		      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			l.ID, fx.Workspace.ID, l.TeamID, l.ParentID, l.IsGroup, l.Name, l.Color, l.Position)
	}

	// Parents before children, for the same reason: issue_parent_acyclic walks the chain.
	for _, is := range fx.Issues {
		var dueDate *time.Time
		if is.DueDate != nil {
			d, err := time.Parse("2006-01-02", *is.DueDate)
			if err != nil {
				t.Fatalf("fixture issue %s: due date %q: %v", is.ID, *is.DueDate, err)
			}
			dueDate = &d
		}

		exec(`INSERT INTO issue (
		        id, workspace_id, team_id, number, title, description, state_id,
		        assignee_id, creator_id, priority, estimate, due_date, parent_id,
		        sort_order, sub_issue_sort_order,
		        completed_at, archived_at, deleted_at, created_at, updated_at)
		      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
		              $16, $17, $18, $19, $20)`,
			is.ID, fx.Workspace.ID, is.TeamID, is.Number, is.Title, is.Description, is.StateID,
			is.AssigneeID, is.CreatorID, is.Priority, is.Estimate, dueDate, is.ParentID,
			is.SortOrder, is.SubIssueSortOrder,
			is.CompletedAt, is.ArchivedAt, is.DeletedAt, is.CreatedAt, is.UpdatedAt)

		// team_id and group_id are left to issue_label_denormalise, which is the only
		// writer that can be trusted to keep them in step with the label tree.
		for _, labelID := range is.LabelIDs {
			exec(`INSERT INTO issue_label (id, workspace_id, issue_id, label_id) VALUES ($1, $2, $3, $4)`,
				uuid.Must(uuid.NewV7()), fx.Workspace.ID, is.ID, labelID)
		}
	}

	for _, r := range fx.Relations {
		exec(`INSERT INTO issue_relation (id, workspace_id, issue_id, related_issue_id, type)
		      VALUES ($1, $2, $3, $4, $5)`,
			r.ID, fx.Workspace.ID, r.IssueID, r.RelatedIssueID, r.Type)
	}

	for _, s := range fx.Subscriptions {
		exec(`INSERT INTO issue_subscription (id, workspace_id, issue_id, user_id, reason, unsubscribed)
		      VALUES ($1, $2, $3, $4, $5, $6)`,
			s.ID, fx.Workspace.ID, s.IssueID, s.UserID, s.Reason, s.Unsubscribed)
	}
}
