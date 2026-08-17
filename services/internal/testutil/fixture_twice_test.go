package testutil_test

import (
	"testing"

	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Two fixtures against one database, which is what a test needs whenever it has to prove
// something about the boundary between two workspaces — that a read cannot see across it,
// that an invitation cannot be redeemed from the wrong side.
//
// It used to fail. The account email was built from the first eight characters of a UUIDv7,
// which are the top 32 bits of a millisecond timestamp and therefore change roughly once a
// minute, so two fixtures built inside the same window collided on account_email_lower_key.
// The symptom was a unique violation raised by a helper, in a test about something else,
// that disappeared when the test was run alone.
func TestNewFixture_CanBeBuiltTwiceAgainstOneDatabase(t *testing.T) {
	db := testutil.NewDB(t)

	first := testutil.NewFixture(t, db)
	second := testutil.NewFixture(t, db)

	if first.WorkspaceID == second.WorkspaceID {
		t.Fatal("two fixtures shared a workspace, so nothing about a boundary can be tested with them")
	}
	if first.AccountID == second.AccountID {
		t.Fatal("two fixtures shared an account")
	}
}
