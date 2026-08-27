//go:build ee

package audit

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// maxPageSize caps what one read can pull back.
//
// The cap is here rather than only in the caller because this is the layer that knows the
// query, and an unbounded LIMIT on a workspace with two years of history is a request that
// times out holding a connection. The caller clamps too; both are cheap and the failure this
// prevents is a slow one that only appears on the largest customer.
const maxPageSize = 200

// Record appends one entry, inside whatever transaction db represents.
//
// The id is minted here rather than taken from the caller because storage owns it, and it is
// a UUIDv7 so that the primary key is time-ordered: random v4 keys scatter inserts across the
// index and turn an append-only table into a write-amplified one.
//
// created_at is left to the column default rather than sent from Go. Every row then carries
// the database's clock, so entries from three application servers with three slightly
// different clocks still sort into the true order of commits — and the order is the whole
// point of the artefact.
func Record(ctx context.Context, db DBTX, e Entry) error {
	if e.WorkspaceID == uuid.Nil {
		// Refused rather than written. A row with no workspace is unreachable by the only
		// query that reads this table, so it would be an entry that exists and can never be
		// produced in an audit — worse than a loud failure at the moment of the bug.
		return fmt.Errorf("audit: entry for %q has no workspace", e.Action)
	}
	if e.Action == "" {
		return fmt.Errorf("audit: entry for workspace %s has no action", e.WorkspaceID)
	}

	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("audit: mint entry id: %w", err)
	}

	const q = `
		INSERT INTO audit_log (
			id, workspace_id,
			actor_user_id, actor_type, actor_label,
			action, target_type, target_id, target_label,
			before, after, ip, user_agent
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`

	if _, err := db.Exec(ctx, q,
		id, e.WorkspaceID,
		e.ActorUserID, e.ActorType, e.ActorLabel,
		e.Action, e.TargetType, e.TargetID, e.TargetLabel,
		e.Before, e.After, e.IP, e.UserAgent,
	); err != nil {
		return fmt.Errorf("audit: record %q: %w", e.Action, err)
	}
	return nil
}

// List returns one page of a workspace's entries, newest first.
//
// after is the id of the last entry of the previous page, or nil for the first page. The id
// alone rather than an encoded (timestamp, id) cursor because the client already has it —
// it is on the row it just rendered — and an opaque cursor would add an encoding, a decoder
// and a class of "malformed cursor" errors to buy nothing.
//
// The comparison is the row-value form `(created_at, id) < (…)` rather than two ANDed
// comparisons. Row-value is both correct at the tie and index-usable: Postgres seeks
// straight into audit_log_workspace_recent_idx with it, where the hand-expanded form
// degenerates into a scan of the workspace's whole history — the pagination bug that only
// appears once a customer has enough entries to page through.
//
// The subquery that resolves the cursor is itself scoped to workspace_id, and that is a
// security boundary rather than an optimisation: without it, an admin of one workspace could
// pass an id belonging to another and use the returned page boundary to probe when events
// happened somewhere they cannot see. An id that does not resolve yields NULL, the
// comparison is then unknown, and the page comes back empty — which is the safe direction.
func List(ctx context.Context, db DBTX, workspaceID uuid.UUID, first int, after *uuid.UUID) ([]Entry, error) {
	if first <= 0 || first > maxPageSize {
		first = 50
	}

	const columns = `
		SELECT id, workspace_id, actor_user_id, actor_type, actor_label,
		       action, target_type, target_id, target_label,
		       before, after, ip, user_agent, created_at
		FROM audit_log
		WHERE workspace_id = $1`
	const order = `
		ORDER BY created_at DESC, id DESC
		LIMIT $2`

	// Two statements rather than one with a nullable cursor. `($3::uuid IS NULL OR …)`
	// plans once for both shapes and picks the scan, which is the same second-page
	// regression stated above arriving through the planner instead of through the SQL.
	q := columns + order
	args := []any{workspaceID, first}

	if after != nil {
		q = columns + `
		  AND (created_at, id) <
		      (SELECT created_at, id FROM audit_log WHERE id = $3 AND workspace_id = $1)` + order
		args = append(args, *after)
	}

	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("audit: list: %w", err)
	}
	defer rows.Close()

	out := make([]Entry, 0, first)
	for rows.Next() {
		var e Entry
		if err := rows.Scan(
			&e.ID, &e.WorkspaceID, &e.ActorUserID, &e.ActorType, &e.ActorLabel,
			&e.Action, &e.TargetType, &e.TargetID, &e.TargetLabel,
			&e.Before, &e.After, &e.IP, &e.UserAgent, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("audit: scan entry: %w", err)
		}
		out = append(out, e)
	}
	// Checked explicitly: pgx reports a mid-stream failure here and not from Scan, so a
	// dropped connection halfway through would otherwise return a short page that reads as
	// "that is all there is" — the one answer an audit log must never give wrongly.
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("audit: read entries: %w", err)
	}
	return out, nil
}
