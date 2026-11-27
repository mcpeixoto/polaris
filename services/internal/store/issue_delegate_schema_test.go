package store_test

import "testing"

// Delegation's schema rules, asserted the same way the sub-issue rules are: the database
// is the backstop, and an importer that writes these tables does not pass through the API.
func TestIssueDelegateSchemaInvariants(t *testing.T) {
	t.Parallel()
	const bot = "'00000000-0000-7000-8000-000000000092'"
	run(t, []schemaCase{{
		name: "an issue may name a user as its delegate",
		sql: `INSERT INTO "user" (id, workspace_id, name, display_name, timezone, role, kind)
		      VALUES (` + bot + `, ` + ws + `, 'Bot', 'Bot', 'UTC', 'member', 'app')`,
	}, {
		name: "the delegate is stored",
		sql:  `UPDATE issue SET delegate_id = ` + bot + ` WHERE id = ` + engIssue,
	}, {
		// The person can leave. The issue should not go with them, and it should not
		// keep a name the directory no longer has.
		name: "deleting the delegate clears the column rather than the issue",
		sql:  `DELETE FROM "user" WHERE id = ` + bot,
	}, {
		name: "delegate_id is null after that delete",
		sql: `SELECT 1/count(*) FROM issue
		      WHERE id = ` + engIssue + ` AND delegate_id IS NULL`,
	}, {
		name:    "agent_run status is closed",
		sql:     `INSERT INTO agent_run (id, workspace_id, issue_id, agent_user_id, run_after, status) VALUES ('00000000-0000-7000-8000-0000000000a9', ` + ws + `, ` + engIssue + `, ` + userAda + `, now(), 'dreaming')`,
		wantErr: "agent_run_status",
	}, {
		name: "a queued run is a legal row",
		sql:  `INSERT INTO agent_run (id, workspace_id, issue_id, agent_user_id, run_after) VALUES ('00000000-0000-7000-8000-0000000000aa', ` + ws + `, ` + engIssue + `, ` + userAda + `, now())`,
	}, {
		// The claim walks this index. A missing WHERE would make every finished run part
		// of the queue, which is the opposite of what the worker asks for.
		name: "the queued claim index is partial",
		sql: `SELECT 1/count(*) FROM pg_indexes
		      WHERE indexname = 'agent_run_queued_idx'
		        AND indexdef ILIKE '%WHERE%'
		        AND indexdef ILIKE '%queued%'`,
	}, {
		name: "a session may be opened by a delegation",
		sql: `INSERT INTO agent_session (id, workspace_id, user_id, title, status, origin)
		      VALUES ('00000000-0000-7000-8000-0000000000ab', ` + ws + `, ` + userAda + `, 'Delegated', 'queued', 'delegation')`,
	}, {
		name:    "the origin check still refuses a value it does not list",
		sql:     `INSERT INTO agent_session (id, workspace_id, user_id, title, status, origin) VALUES ('00000000-0000-7000-8000-0000000000ac', ` + ws + `, ` + userAda + `, 'No', 'queued', 'pigeon')`,
		wantErr: "agent_session_origin",
	}})
}
