package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The rules the schema enforces itself, asserted rather than assumed.
//
// Every case here corresponds to a comment in a migration claiming that the database
// prevents something. Two of these were written as prose first and were wrong when
// executed — a BEFORE trigger cannot read a GENERATED column, and "a group is a label
// with children" makes an empty group applicable — so the claims are now tested.
//
// The point is not that the application would allow these writes. The point is that the
// application is not the only writer: an importer, a migration, a support script and a
// human with psql all reach these tables, and an invariant that only the API enforces is
// an invariant that holds until the first bulk import.

const (
	ws    = "'00000000-0000-7000-8000-00000000ff01'"
	engID = "'00000000-0000-7000-8000-0000000000a1'"
	desID = "'00000000-0000-7000-8000-0000000000a2'"

	engIssue  = "'00000000-0000-7000-8000-0000000000c1'"
	engIssue2 = "'00000000-0000-7000-8000-0000000000c2'"
	desIssue  = "'00000000-0000-7000-8000-0000000000c3'"

	groupPriority = "'00000000-0000-7000-8000-0000000000d0'"
	labelP0       = "'00000000-0000-7000-8000-0000000000d1'"
	labelP1       = "'00000000-0000-7000-8000-0000000000d2'"
	labelDesOnly  = "'00000000-0000-7000-8000-0000000000d3'"

	userAda = "'00000000-0000-7000-8000-000000000091'"
)

// fixture is the smallest workspace that can exercise cross-team and grouped-label rules:
// two teams, three issues, one label group with two children, one team-scoped label.
var fixture = []string{
	`INSERT INTO workspace (id, name, url_key) VALUES (` + ws + `, 'Check', 'check')`,

	`INSERT INTO team (id, workspace_id, key, name) VALUES
	   (` + engID + `, ` + ws + `, 'ENG', 'Engineering'),
	   (` + desID + `, ` + ws + `, 'DES', 'Design')`,

	`INSERT INTO workflow_state (id, workspace_id, team_id, name, color, category, position, is_default) VALUES
	   ('00000000-0000-7000-8000-0000000000b1', ` + ws + `, ` + engID + `, 'Todo', '#888', 'unstarted', 'a0', true),
	   ('00000000-0000-7000-8000-0000000000b2', ` + ws + `, ` + desID + `, 'Todo', '#888', 'unstarted', 'a0', true)`,

	`INSERT INTO issue (id, workspace_id, team_id, number, title, state_id, sort_order) VALUES
	   (` + engIssue + `,  ` + ws + `, ` + engID + `, 1, 'Engineering issue',        '00000000-0000-7000-8000-0000000000b1', 'a0'),
	   (` + engIssue2 + `, ` + ws + `, ` + engID + `, 2, 'Second engineering issue', '00000000-0000-7000-8000-0000000000b1', 'a1'),
	   (` + desIssue + `,  ` + ws + `, ` + desID + `, 1, 'Design issue',             '00000000-0000-7000-8000-0000000000b2', 'a0')`,

	`INSERT INTO label (id, workspace_id, name, color, position, is_group) VALUES
	   (` + groupPriority + `, ` + ws + `, 'Priority', '#f00', 'a0', true)`,

	`INSERT INTO label (id, workspace_id, parent_id, name, color, position) VALUES
	   (` + labelP0 + `, ` + ws + `, ` + groupPriority + `, 'P0', '#f00', 'a0'),
	   (` + labelP1 + `, ` + ws + `, ` + groupPriority + `, 'P1', '#fa0', 'a1')`,

	`INSERT INTO label (id, workspace_id, team_id, name, color, position) VALUES
	   (` + labelDesOnly + `, ` + ws + `, ` + desID + `, 'needs-mockup', '#0af', 'a0')`,

	`INSERT INTO "user" (id, workspace_id, name, display_name, timezone, role) VALUES
	   (` + userAda + `, ` + ws + `, 'Ada', 'Ada', 'Europe/Lisbon', 'owner')`,
}

type schemaCase struct {
	name string
	sql  string
	// wantErr is a substring of the error the database must produce. Empty means the
	// statement must succeed. Matching on the message rather than merely on "it failed"
	// is what stops a case from passing because of an unrelated typo in the SQL.
	wantErr string
}

func TestLabelSchemaInvariants(t *testing.T) {
	t.Parallel()
	run(t, []schemaCase{{
		name: "a label may only be parented to a group",
		sql: `INSERT INTO label (id, workspace_id, parent_id, name, color, position)
		      VALUES ('00000000-0000-7000-8000-0000000000d9', ` + ws + `, ` + labelP0 + `, 'P0a', '#f00', 'a5')`,
		wantErr: "is not a group",
	}, {
		name: "groups do not nest",
		sql: `INSERT INTO label (id, workspace_id, parent_id, name, color, position, is_group)
		      VALUES ('00000000-0000-7000-8000-0000000000dd', ` + ws + `, ` + groupPriority + `, 'Nested', '#f00', 'a5', true)`,
		wantErr: "label_groups_do_not_nest",
	}, {
		name: "a team label may not join a workspace group",
		sql: `INSERT INTO label (id, workspace_id, team_id, parent_id, name, color, position)
		      VALUES ('00000000-0000-7000-8000-0000000000da', ` + ws + `, ` + engID + `, ` + groupPriority + `, 'P2', '#f00', 'a2')`,
		wantErr: "does not match its group",
	}, {
		name:    "a group holding labels may not be demoted",
		sql:     `UPDATE label SET is_group = false WHERE id = ` + groupPriority,
		wantErr: "empty the group before demoting it",
	}, {
		name: "names are unique per scope, case-insensitively",
		sql: `INSERT INTO label (id, workspace_id, name, color, position)
		      VALUES ('00000000-0000-7000-8000-0000000000db', ` + ws + `, 'priority', '#f00', 'a9')`,
		wantErr: "label_scope_name_key",
	}, {
		name: "the same name in a different scope is fine",
		sql: `INSERT INTO label (id, workspace_id, team_id, name, color, position)
		      VALUES ('00000000-0000-7000-8000-0000000000dc', ` + ws + `, ` + engID + `, 'Priority', '#f00', 'a9')`,
	}, {
		name: "scope_key is generated from team_id",
		sql: `SELECT 1/count(*) FROM label
		      WHERE id = ` + labelDesOnly + ` AND scope_key = ` + desID,
	}, {
		name: "a workspace label gets the all-zero scope key",
		sql: `SELECT 1/count(*) FROM label
		      WHERE id = ` + groupPriority + ` AND scope_key = '00000000-0000-0000-0000-000000000000'`,
	}})
}

func TestIssueLabelSchemaInvariants(t *testing.T) {
	t.Parallel()
	apply := `INSERT INTO issue_label (id, workspace_id, issue_id, label_id) VALUES `
	run(t, []schemaCase{{
		name: "a label applies to an issue",
		sql:  apply + `('00000000-0000-7000-8000-0000000000e1', ` + ws + `, ` + engIssue + `, ` + labelP0 + `)`,
	}, {
		name: "team_id and group_id are denormalised on write",
		sql: `SELECT 1/count(*) FROM issue_label
		      WHERE id = '00000000-0000-7000-8000-0000000000e1'
		        AND team_id = ` + engID + ` AND group_id = ` + groupPriority,
	}, {
		// The rule that makes groups worth having.
		name:    "at most one label per group per issue",
		sql:     apply + `('00000000-0000-7000-8000-0000000000e2', ` + ws + `, ` + engIssue + `, ` + labelP1 + `)`,
		wantErr: "issue_label_one_per_group",
	}, {
		name:    "a team's label may not be applied to another team's issue",
		sql:     apply + `('00000000-0000-7000-8000-0000000000e3', ` + ws + `, ` + engIssue + `, ` + labelDesOnly + `)`,
		wantErr: "belongs to team",
	}, {
		name:    "a group itself may not be applied",
		sql:     apply + `('00000000-0000-7000-8000-0000000000e4', ` + ws + `, ` + engIssue + `, ` + groupPriority + `)`,
		wantErr: "is a group",
	}, {
		name:    "the same label twice is rejected",
		sql:     apply + `('00000000-0000-7000-8000-0000000000e5', ` + ws + `, ` + engIssue + `, ` + labelP0 + `)`,
		wantErr: "issue_label_key",
	}, {
		// Moving a label between groups must carry its applications with it, or the
		// one-per-group rule silently stops applying to every issue already labelled.
		name: "moving a label out of its group updates its applications",
		sql:  `UPDATE label SET parent_id = NULL WHERE id = ` + labelP0,
	}, {
		name: "...and the denormalised group_id followed",
		sql: `SELECT 1/count(*) FROM issue_label
		      WHERE id = '00000000-0000-7000-8000-0000000000e1' AND group_id IS NULL`,
	}, {
		name: "moving it back updates them again",
		sql:  `UPDATE label SET parent_id = ` + groupPriority + ` WHERE id = ` + labelP0,
	}, {
		name: "...and group_id followed back",
		sql: `SELECT 1/count(*) FROM issue_label
		      WHERE id = '00000000-0000-7000-8000-0000000000e1' AND group_id = ` + groupPriority,
	}})
}

func TestSubIssueSchemaInvariants(t *testing.T) {
	t.Parallel()
	run(t, []schemaCase{{
		name: "an issue becomes a child of another",
		sql:  `UPDATE issue SET parent_id = ` + engIssue + ` WHERE id = ` + engIssue2,
	}, {
		// A platform task blocking a product feature is the normal case. Forcing them
		// into one team to express it is worse than allowing the cross-team link.
		name: "a sub-issue may live in another team",
		sql:  `UPDATE issue SET parent_id = ` + engIssue2 + ` WHERE id = ` + desIssue,
	}, {
		// Not a data-quality problem but a hang: the progress rollup, the breadcrumb and
		// the delete cascade all walk this chain.
		name:    "a parent cycle is rejected",
		sql:     `UPDATE issue SET parent_id = ` + desIssue + ` WHERE id = ` + engIssue,
		wantErr: "would create a cycle",
	}, {
		// Both the trigger and issue_not_own_parent reject this. The trigger's message is
		// the one that surfaces, because BEFORE triggers run ahead of CHECK constraints —
		// the constraint stays as the backstop for the case where the trigger is dropped.
		name:    "an issue may not be its own parent",
		sql:     `UPDATE issue SET parent_id = id WHERE id = ` + engIssue,
		wantErr: "would create a cycle",
	}, {
		name:    "due_date_source is closed to manual and sla",
		sql:     `UPDATE issue SET due_date_source = 'guessed' WHERE id = ` + engIssue,
		wantErr: "issue_due_date_source_check",
	}, {
		name:    "an absurd estimate is rejected",
		sql:     `UPDATE issue SET estimate = 5000 WHERE id = ` + engIssue,
		wantErr: "issue_estimate_check",
	}, {
		name:    "a scale the product does not have is rejected",
		sql:     `UPDATE team SET estimate_scale = 'roman-numerals' WHERE id = ` + engID,
		wantErr: "team_estimate_scale_check",
	}})
}

func TestIssueRelationSchemaInvariants(t *testing.T) {
	t.Parallel()
	rel := `INSERT INTO issue_relation (id, workspace_id, issue_id, related_issue_id, type) VALUES `
	run(t, []schemaCase{{
		name: "one issue blocks another, across teams",
		sql:  rel + `('00000000-0000-7000-8000-0000000000f1', ` + ws + `, ` + engIssue + `, ` + desIssue + `, 'blocks')`,
	}, {
		name: "both team ids are denormalised, because the hub cannot re-read a deleted issue",
		sql: `SELECT 1/count(*) FROM issue_relation
		      WHERE id = '00000000-0000-7000-8000-0000000000f1'
		        AND team_id = ` + engID + ` AND related_team_id = ` + desID,
	}, {
		// `related` has no direction. Stored canonically, the unique index is enough to
		// stop A-related-B and B-related-A both existing; without it the duplicate is
		// invisible to the database and shows up twice in the UI.
		name:    "a symmetric relation must be stored with the smaller id first",
		sql:     rel + `('00000000-0000-7000-8000-0000000000f2', ` + ws + `, ` + desIssue + `, ` + engIssue + `, 'related')`,
		wantErr: "issue_relation_symmetric_canonical",
	}, {
		name: "canonical order is accepted",
		sql:  rel + `('00000000-0000-7000-8000-0000000000f3', ` + ws + `, ` + engIssue + `, ` + desIssue + `, 'related')`,
	}, {
		name:    "an issue may not relate to itself",
		sql:     rel + `('00000000-0000-7000-8000-0000000000f4', ` + ws + `, ` + engIssue + `, ` + engIssue + `, 'blocks')`,
		wantErr: "issue_relation_not_self",
	}, {
		name:    "only the three relation types exist",
		sql:     rel + `('00000000-0000-7000-8000-0000000000f5', ` + ws + `, ` + engIssue + `, ` + desIssue + `, 'inspires')`,
		wantErr: "issue_relation_type_check",
	}})
}

func TestNotificationSchemaInvariants(t *testing.T) {
	t.Parallel()
	notif := `INSERT INTO notification (id, workspace_id, user_id, type, change_version, group_key, actor_type) VALUES `
	run(t, []schemaCase{{
		name: "a notification lands",
		sql:  notif + `('00000000-0000-7000-8000-000000000081', ` + ws + `, ` + userAda + `, 'issue_assigned', 7, 'v7', 'system')`,
	}, {
		// This is what makes the fan-out safely resumable: a worker that crashes
		// mid-batch and restarts re-processes the same versions and conflicts, rather
		// than delivering everything twice.
		name:    "re-running the fan-out over the same version conflicts instead of duplicating",
		sql:     notif + `('00000000-0000-7000-8000-000000000082', ` + ws + `, ` + userAda + `, 'issue_assigned', 7, 'v7', 'system')`,
		wantErr: "notification_recipient_group_key",
	}, {
		name: "a different event for the same recipient is a separate row",
		sql:  notif + `('00000000-0000-7000-8000-000000000083', ` + ws + `, ` + userAda + `, 'comment', 8, 'v8', 'system')`,
	}, {
		// Deleting the row instead would mean the next comment auto-subscribes the user
		// again, so "unsubscribe" would be a button that works for about four minutes.
		name: "an explicit unsubscribe is a row, not a missing row",
		sql: `INSERT INTO issue_subscription (id, workspace_id, issue_id, user_id, reason, unsubscribed)
		      VALUES ('00000000-0000-7000-8000-000000000071', ` + ws + `, ` + engIssue + `, ` + userAda + `, 'manual', true)`,
	}, {
		name: "one subscription row per person per issue",
		sql: `INSERT INTO issue_subscription (id, workspace_id, issue_id, user_id)
		      VALUES ('00000000-0000-7000-8000-000000000072', ` + ws + `, ` + engIssue + `, ` + userAda + `)`,
		wantErr: "issue_subscription_key",
	}})
}

// Email delivery, and the one claim migration 000019 makes about the database: that a
// notification can be taken for a message at most once, without any counter in any process.
//
// It is the mirror image of the invariant above. The fan-out is idempotent because a second
// pass *conflicts* — repeating is free, since two inbox rows fold into one. Email has no
// fold: a second copy of a digest is in somebody's mailbox forever. So delivery is idempotent
// because a second pass *matches nothing*, and these cases are the difference stated as SQL.
func TestNotificationEmailSchemaInvariants(t *testing.T) {
	t.Parallel()

	const (
		pending   = "'00000000-0000-7000-8000-000000000085'"
		claimedAt = "'2026-01-01 09:00:00+00'"
		laterAt   = "'2026-06-01 09:00:00+00'"
		neverAt   = "'2020-01-01 00:00:00+00'"
		ghost     = "'00000000-0000-7000-8000-0000000000ff'"
	)

	run(t, []schemaCase{{
		name: "a notification arrives unclaimed",
		sql: `INSERT INTO notification (id, workspace_id, user_id, type, change_version, group_key, actor_type)
		      VALUES (` + pending + `, ` + ws + `, ` + userAda + `, 'issue_assigned', 9, 'v9', 'system')`,
	}, {
		name: "...and is therefore what a delivery pass would pick up",
		sql:  `SELECT 1/count(*) FROM notification WHERE id = ` + pending + ` AND emailed_at IS NULL`,
	}, {
		// The claim. Not a read followed by a mark: one conditional update, which is what
		// makes the set a pass describes in an email exactly the set it owns.
		name: "claiming it is one conditional update",
		sql: `UPDATE notification SET emailed_at = ` + claimedAt + `
		      WHERE id = ` + pending + ` AND emailed_at IS NULL`,
	}, {
		name: "a second pass runs the identical statement",
		sql: `UPDATE notification SET emailed_at = ` + laterAt + `
		      WHERE id = ` + pending + ` AND emailed_at IS NULL`,
	}, {
		// ...and changes nothing, which is the whole of the at-most-once guarantee. If this
		// row now carried the later timestamp, a restarted worker would have sent a second
		// copy of a digest that is already in somebody's mailbox.
		name: "...and matches nothing, so nobody is emailed twice",
		sql:  `SELECT 1/count(*) FROM notification WHERE id = ` + pending + ` AND emailed_at = ` + claimedAt,
	}, {
		// The release path, which is what keeps a relay outage from swallowing a digest
		// permanently. It is guarded on the exact claim so that it can only ever undo the
		// claim its own pass made.
		name: "releasing a claim that was not yours does nothing",
		sql: `UPDATE notification SET emailed_at = NULL
		      WHERE id = ` + pending + ` AND emailed_at = ` + neverAt,
	}, {
		name: "...so the row is still claimed",
		sql:  `SELECT 1/count(*) FROM notification WHERE id = ` + pending + ` AND emailed_at = ` + claimedAt,
	}, {
		name: "releasing your own claim puts the notification back",
		sql: `UPDATE notification SET emailed_at = NULL
		      WHERE id = ` + pending + ` AND emailed_at = ` + claimedAt,
	}, {
		name: "...and it is pending again",
		sql:  `SELECT 1/count(*) FROM notification WHERE id = ` + pending + ` AND emailed_at IS NULL`,
	}, {
		name:    "a delivery watermark belongs to somebody",
		sql:     `INSERT INTO notification_email_cursor (user_id, last_sent_at) VALUES (` + ghost + `, now())`,
		wantErr: "notification_email_cursor_user_id_fkey",
	}, {
		name: "one watermark per person",
		sql:  `INSERT INTO notification_email_cursor (user_id, last_sent_at) VALUES (` + userAda + `, now())`,
	}, {
		name:    "...and only one",
		sql:     `INSERT INTO notification_email_cursor (user_id, last_sent_at) VALUES (` + userAda + `, now())`,
		wantErr: "notification_email_cursor_pkey",
	}, {
		// Somebody removed from the workspace stops being mailed by the same act that removes
		// them, rather than by a job that has to remember to.
		name: "a watermark goes when the person does",
		sql:  `DELETE FROM "user" WHERE id = ` + userAda,
	}, {
		name: "...leaving none behind",
		sql: `SELECT 1/count(*) FROM (
		        SELECT 1 WHERE (SELECT count(*) FROM notification_email_cursor WHERE user_id = ` + userAda + `) = 0
		      ) t`,
	}})
}

func TestSearchVector(t *testing.T) {
	t.Parallel()
	vector := `issue_search_vector(title, description)`
	run(t, []schemaCase{{
		name: "the vector matches a word from the title",
		sql:  `SELECT 1/count(*) FROM issue WHERE ` + vector + ` @@ to_tsquery('simple', 'engineering')`,
	}, {
		// Prefix matching is what issue search is actually for: finding the issue whose
		// title you half-remember.
		name: "prefix matching works",
		sql:  `SELECT 1/count(*) FROM issue WHERE ` + vector + ` @@ to_tsquery('simple', 'engineer:*')`,
	}, {
		name: "the vector follows the title, because it is computed from it",
		sql:  `UPDATE issue SET title = 'Refactored beyond recognition' WHERE id = ` + engIssue,
	}, {
		name: "...and the old word no longer matches that row",
		sql: `SELECT 1/count(*) FROM issue
		      WHERE id = ` + engIssue + ` AND NOT (` + vector + ` @@ to_tsquery('simple', 'engineering'))`,
	}, {
		// The whole reason this is a function and not a stored generated column: sqlc maps
		// tsvector to interface{}, so a column would put an untyped field in the generated
		// model of the busiest table and every RETURNING list that omitted it would stop
		// matching that model. Asserting the column's absence keeps somebody from "fixing"
		// the extra typing by adding it back.
		name: "there is no stored search_vector column to drift from the function",
		sql: `SELECT 1/count(*) FROM information_schema.columns
		      WHERE table_name = 'issue' AND column_name <> 'search_vector'
		      HAVING count(*) = (SELECT count(*) FROM information_schema.columns WHERE table_name = 'issue')`,
	}})
}

// Search and the filter grammar's `contains` must fold identically.
//
// If they do not, a search for "acao" and a saved view filtering title-contains-"acao"
// return different issues — which is M1 acceptance test 2 failing at the storage layer,
// long before either evaluator is involved.
func TestSearchFoldingIsConsistent(t *testing.T) {
	t.Parallel()
	accented := `UPDATE issue SET title = 'Ação de limpeza' WHERE id = ` + engIssue
	run(t, []schemaCase{{
		name: "an accented title",
		sql:  accented,
	}, {
		name: "full-text search finds it from an unaccented query",
		sql: `SELECT 1/count(*) FROM issue
		      WHERE id = ` + engIssue + `
		        AND issue_search_vector(title, description) @@ to_tsquery('simple', 'acao')`,
	}, {
		name: "the contains path folds the same way",
		sql: `SELECT 1/count(*) FROM issue
		      WHERE id = ` + engIssue + ` AND search_fold(title) LIKE '%' || search_fold('AÇÃO') || '%'`,
	}, {
		name: "and an unaccented needle matches an accented haystack",
		sql: `SELECT 1/count(*) FROM issue
		      WHERE id = ` + engIssue + ` AND search_fold(title) LIKE '%acao%'`,
	}, {
		// Declared IMMUTABLE by naming the dictionary explicitly. Without that, Postgres
		// refuses it in the generated column and in the trigram index, and the whole
		// folding scheme silently degrades to a sequential scan — or does not build.
		name: "search_fold is immutable, which is what lets it be indexed",
		sql: `SELECT 1/count(*) FROM pg_proc
		      WHERE proname = 'search_fold' AND provolatile = 'i'`,
	}})
}

// run applies the fixture, then each case in order against one database. Order matters:
// several cases assert the effect of the case before them, which is the honest way to
// test a trigger that propagates.
func run(t *testing.T, cases []schemaCase) {
	t.Helper()
	db := testutil.NewDB(t)
	ctx := context.Background()

	for _, stmt := range fixture {
		if _, err := db.Pool().Exec(ctx, stmt); err != nil {
			t.Fatalf("fixture: %v\n%s", err, stmt)
		}
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := db.Pool().Exec(ctx, tc.sql)
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("expected success, got: %v", err)
			case tc.wantErr != "" && err == nil:
				t.Fatalf("expected an error containing %q, the write succeeded", tc.wantErr)
			case tc.wantErr != "" && !strings.Contains(err.Error(), tc.wantErr):
				// Failing for a different reason than the one under test — usually a
				// typo in the SQL — would otherwise read as a pass.
				t.Fatalf("expected an error containing %q, got: %v", tc.wantErr, err)
			}
		})
	}
}
