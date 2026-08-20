package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// IssueMatchesFilter reports whether one issue satisfies a compiled filter fragment.
//
// The fragment comes from internal/filter.Compile with Alias "issue" and ArgOffset 1, so
// its placeholders start at $2. $1 is this issue's id. Assembled here for the same reason
// search_dynamic.go is: sqlc cannot take SQL as a parameter.
func (q *Queries) IssueMatchesFilter(
	ctx context.Context, issueID uuid.UUID, fragment string, args []any,
) (bool, error) {
	if fragment == "" {
		return false, fmt.Errorf("store: empty filter fragment")
	}
	sql := "SELECT EXISTS (SELECT 1 FROM issue WHERE id = $1 AND " + fragment + ")"
	all := make([]any, 0, 1+len(args))
	all = append(all, issueID)
	all = append(all, args...)
	var ok bool
	if err := q.db.QueryRow(ctx, sql, all...).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}
