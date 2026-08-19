package domain

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	// The fixture pins a timezone by name, and so does the workspace it describes. A machine
	// without a zoneinfo database would fall back to UTC without saying so and move every
	// relative date by an hour.
	_ "time/tzdata"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Acceptance test 2, proved where it was actually broken.
//
//	A filter expressed in the UI, in a saved view and in a search returns identical ids for
//	the same workspace state.
//
// internal/filter/conformance_test.go already runs schema/filter-conformance.json through
// filter.Compile and a real Postgres, and web/src/filter/conformance.test.ts runs the same
// file through the client's evaluator. Both passed for months while `search` returned every
// hit regardless of the filter it was handed, because neither of them goes anywhere near
// `Search`: one tests the compiler and the other tests the evaluator, and the defect was in
// the wiring between the compiler and the only server-side caller that needs it.
//
// So this runs the fixture's recorded answers — the client's answers, checked into the
// contract file — through domain.Search. Agreement is the criterion, and this is the level
// at which the two sides can disagree without any test noticing.
//
// It is an internal test (package domain, not domain_test) for one reason: the clock. A
// filter saying `createdAt gte -10d` is only answerable relative to an instant, the fixture
// pins that instant so both languages answer the same question, and Service.now is how it
// gets in. Reaching it from outside would mean an exported setter that exists for a test.

const conformanceIDPrefix = "01900000-0000-7000-8000-"

// conformanceMarker is a word added to every fixture issue's description.
//
// Search is a text search that a filter narrows; the fixture is a filter fixture with no
// text query in it. Without a term every issue matches, each case would be measuring the
// intersection of a filter and an arbitrary title match, and a case failing would not say
// which half was wrong. One nonsense word in every description makes the text half a no-op
// and leaves the filter as the only thing deciding, which is what is under test.
const conformanceMarker = "zzconformancemarker"

// conformanceSkips are the fixture cases that Search cannot answer, with the reason.
//
// One case, and it is not a gap in the wiring: `search` never returns soft-deleted issues,
// whatever the filter says. That is a decision above the grammar — the trash is its own
// screen with its own query and its own thirty-day window, and a search box that surfaced
// deleted issues would be handing back rows every client has already been told to forget.
// The grammar's `deleted` clause exists for the trash screen's own filtering, where the
// client holds the deleted rows locally and evaluates against them.
var conformanceSkips = map[string]string{
	"deleted issues are reachable only by asking": "search excludes deleted issues unconditionally; the trash has its own query",
}

type conformanceFixture struct {
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
		TemplateID        *uuid.UUID  `json:"templateId"`
		RecurringIssueID  *uuid.UUID  `json:"recurringIssueId"`
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
}

func TestSearchConformance_AgreesWithTheClientOnEveryFixtureCase(t *testing.T) {
	fx := loadSearchConformance(t)

	db := testutil.NewDB(t)
	ctx := context.Background()
	insertConformanceWorkspace(t, ctx, db.Pool(), fx)

	// Every issue gains the marker word, so one query matches the whole corpus and the
	// filter is the only thing that can narrow it.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE issue SET description = description || ' ' || $2 WHERE workspace_id = $1`,
		fx.Workspace.ID, conformanceMarker); err != nil {
		t.Fatalf("mark the corpus: %v", err)
	}

	svc := NewService(db)
	// The fixture's instant, not the wall clock. Every relative token in the file was
	// recorded against it.
	svc.now = func() time.Time { return fx.EvaluatedAt }

	teams := make([]uuid.UUID, 0, len(fx.Teams))
	for _, tm := range fx.Teams {
		teams = append(teams, tm.ID)
	}
	p := &authz.Principal{
		UserID:      fx.Users[0].ID,
		WorkspaceID: fx.Workspace.ID,
		Role:        authz.RoleOwner,
		Teams:       authz.NewTeamSet(teams...),
	}

	for _, tc := range fx.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			if reason, skip := conformanceSkips[tc.Name]; skip {
				t.Skip(reason)
			}

			results, err := svc.Search(ctx, p, SearchInput{
				Query:  conformanceMarker,
				Filter: expandConformanceFilter(t, tc.Filter),
				// The whole corpus, so a truncated page cannot read as a filter that
				// matched less than it should have.
				First: 100,
				// The fixture's archived case expects the archived issue back when the
				// filter asks for it. The filter's own default still hides it from every
				// case that does not — which is the agreement being checked.
				IncludeArchived: true,
			})
			if err != nil {
				t.Fatalf("search: %v", err)
			}

			got := make([]string, 0, len(results.Issues))
			for _, issue := range results.Issues {
				got = append(got, issue.ID.String())
			}
			want := make([]string, 0, len(tc.Expect))
			for _, name := range tc.Expect {
				want = append(want, expandConformanceID(name))
			}
			slices.Sort(got)
			slices.Sort(want)

			// Compared as a set: ranking is search's business and ordering is a display
			// option, and asserting either here would make a ranking change read as a
			// filter regression.
			if !slices.Equal(got, want) {
				t.Fatalf("search disagrees with the recorded client answer\n got: %v\nwant: %v\nfilter: %s",
					shortConformanceIDs(got), shortConformanceIDs(want), tc.Filter)
			}

			// The count labels the list. A count taken over a different predicate is how a
			// UI ends up saying "showing 1 of 3" for a filter that matched one.
			if results.IssueCount != len(want) {
				t.Errorf("the total says %d and the list holds %d; both are answers to the same question",
					results.IssueCount, len(want))
			}
		})
	}
}

func loadSearchConformance(t *testing.T) *conformanceFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "schema", "filter-conformance.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var fx conformanceFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(fx.Cases) == 0 {
		t.Fatalf("%s holds no cases; a conformance run that checks nothing passes for the wrong reason", path)
	}
	return &fx
}

// expandConformanceID turns the fixture's short names ("e1") into the ids they stand for.
func expandConformanceID(name string) string {
	if len(name) == len(conformanceIDPrefix)+12 {
		return name
	}
	return conformanceIDPrefix + strings.Repeat("0", 12-len(name)) + name
}

// conformanceUUIDFields are the fields whose values are ids.
//
// By field rather than by the shape of the string, for the reason the sibling fixture reader
// gives: a pattern match would turn {"field":"title","op":"contains","values":["e2"]} into a
// uuid and fail the case for a reason nobody could see.
var conformanceUUIDFields = map[string]bool{
	"state": true, "assignee": true, "creator": true, "subscriber": true,
	"label": true, "team": true, "parent": true, "blockedBy": true, "blocking": true,
	"template": true,
}

func expandConformanceFilter(t *testing.T, raw json.RawMessage) []byte {
	t.Helper()
	var node map[string]any
	if err := json.Unmarshal(raw, &node); err != nil {
		t.Fatalf("parse case filter: %v", err)
	}
	expandConformanceNode(t, node)
	out, err := json.Marshal(node)
	if err != nil {
		t.Fatalf("re-encode case filter: %v", err)
	}
	return out
}

func expandConformanceNode(t *testing.T, node map[string]any) {
	t.Helper()
	if field, ok := node["field"].(string); ok && conformanceUUIDFields[field] {
		values, _ := node["values"].([]any)
		for i, v := range values {
			s, ok := v.(string)
			if !ok {
				t.Fatalf("case filter: %s value %d is not a string", field, i)
			}
			values[i] = expandConformanceID(s)
		}
	}
	children, _ := node["nodes"].([]any)
	for _, child := range children {
		m, ok := child.(map[string]any)
		if !ok {
			t.Fatalf("case filter: a group's node is not an object")
		}
		expandConformanceNode(t, m)
	}
}

func shortConformanceIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, strings.TrimLeft(strings.TrimPrefix(id, conformanceIDPrefix), "0"))
	}
	return out
}

// insertConformanceWorkspace writes the fixture with raw SQL, in dependency order.
//
// Raw SQL rather than the domain layer, for the reason the sibling reader gives: the fixture
// names its own ids and carries archived and soft-deleted issues, neither of which the create
// path produces, and routing it through CreateIssue would make a conformance failure point at
// whichever unrelated subsystem happened to be broken.
func insertConformanceWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fx *conformanceFixture) {
	t.Helper()

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture insert: %v\n%s\nargs: %v", err, sql, args)
		}
	}

	exec(`INSERT INTO workspace (id, name, url_key, plan) VALUES ($1, $2, $3, $4)`,
		fx.Workspace.ID, fx.Workspace.Name, fx.Workspace.URLKey, fx.Workspace.Plan)

	// The users carry the fixture's timezone, because that is where Search reads the zone
	// its relative tokens are measured in when a search is not narrowed to one team — see
	// Service.searchLocation. A user left on the 'UTC' default would move every relative
	// date by an hour and make the date cases fail for a reason that has nothing to do with
	// the filter.
	for _, u := range fx.Users {
		exec(`INSERT INTO "user" (id, workspace_id, name, display_name, role, timezone)
		      VALUES ($1, $2, $3, $3, $4, $5)`,
			u.ID, fx.Workspace.ID, u.Name, u.Role, fx.Timezone)
	}

	for _, tm := range fx.Teams {
		exec(`INSERT INTO team (id, workspace_id, key, name, timezone) VALUES ($1, $2, $3, $4, $5)`,
			tm.ID, fx.Workspace.ID, tm.Key, tm.Name, fx.Timezone)
	}

	for _, s := range fx.WorkflowStates {
		exec(`INSERT INTO workflow_state (id, workspace_id, team_id, name, category, position, is_default)
		      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			s.ID, fx.Workspace.ID, s.TeamID, s.Name, s.Category, s.Position, s.IsDefault)
	}

	// Groups before their children: label_parent_integrity reads the parent row.
	for _, l := range fx.Labels {
		exec(`INSERT INTO label (id, workspace_id, team_id, parent_id, is_group, name, color, position)
		      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			l.ID, fx.Workspace.ID, l.TeamID, l.ParentID, l.IsGroup, l.Name, l.Color, l.Position)
	}

	for _, is := range fx.Issues {
		if is.TemplateID != nil {
			exec(`INSERT INTO issue_template (id, workspace_id, team_id, name, title, body, properties, position)
			      VALUES ($1, $2, $3, 'Fixture', '', '', '{}'::jsonb, 'a0')
			      ON CONFLICT (id) DO NOTHING`,
				*is.TemplateID, fx.Workspace.ID, is.TeamID)
		}
		if is.RecurringIssueID != nil {
			exec(`INSERT INTO recurring_issue (id, workspace_id, team_id, title, cadence, next_due_date)
			      VALUES ($1, $2, $3, 'Fixture schedule', 'weekly', DATE '2026-09-01')
			      ON CONFLICT (id) DO NOTHING`,
				*is.RecurringIssueID, fx.Workspace.ID, is.TeamID)
		}
	}

	// Parents before children: issue_parent_acyclic walks the chain.
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
		        sort_order, sub_issue_sort_order, template_id, recurring_issue_id,
		        completed_at, archived_at, deleted_at, created_at, updated_at)
		      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
		              $16, $17, $18, $19, $20, $21, $22)`,
			is.ID, fx.Workspace.ID, is.TeamID, is.Number, is.Title, is.Description, is.StateID,
			is.AssigneeID, is.CreatorID, is.Priority, is.Estimate, dueDate, is.ParentID,
			is.SortOrder, is.SubIssueSortOrder, is.TemplateID, is.RecurringIssueID,
			is.CompletedAt, is.ArchivedAt, is.DeletedAt, is.CreatedAt, is.UpdatedAt)

		// team_id and group_id are left to issue_label_denormalise.
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
