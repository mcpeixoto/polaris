package store

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// DateOf converts a Go time to the pgtype.Date that sqlc generates for a `date` column.
//
// It lives here so that the domain layer never has to import pgtype: the point of the
// store boundary is that database-driver types stop at it.
func DateOf(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}
