package testutil

import (
	"fmt"
	"time"
)

// Budget is a wall-clock ceiling from an acceptance criterion, scaled for the binary that
// is checking it.
//
// A criterion like "the notification fan-out for a bulk update of 200 issues completes in
// < 2 s" is a statement about the product on a machine doing one thing. A test asserting it
// runs somewhere else entirely: CI runs `go test ./... -race`, two packages at a time, on a
// shared runner. Comparing a race-instrumented, contended measurement against the product's
// number is not a stricter test — it is a test that fails for a reason that has nothing to
// do with the code, which is how a real budget stops being believed.
//
// Measured on an 8-core Apple laptop against a local Postgres, for the 200-issue bulk edit
// plus fan-out in internal/domain (edit and fan-out timed together, seven runs each):
//
//	un-instrumented   0.28 s – 1.99 s   (best case 1.4 ms per issue)
//	-race             0.93 s – 6.09 s
//
// The spread inside each row is machine load, not the race detector: the same binary is
// seven times slower under a load average of 70 than on an idle box. The floor is what the
// code actually costs, and at 0.28 s it is comfortably inside the criterion — nothing here
// is slow. What the numbers say is that 2 s is roughly seven times the real cost rather
// than the "roughly forty times" the assertion used to claim for itself, and seven times is
// not enough headroom to survive an instrumented binary on a busy runner.
//
// So the stated number is kept, and checked literally in an un-instrumented build, which is
// the one that can be compared against the product. A race build gets the scale below.
type Budget struct {
	// Stated is the criterion's own number, and what a failure message should quote.
	Stated time.Duration
	// Limit is what an elapsed time is actually compared against here.
	Limit time.Duration
	// Scale is Limit/Stated: 1 normally, raceScale under -race.
	Scale int
}

// PerfBudget scales a criterion's wall-clock ceiling for the running binary.
func PerfBudget(stated time.Duration) Budget {
	return Budget{Stated: stated, Limit: stated * time.Duration(raceScale), Scale: raceScale}
}

// Exceeded reports whether an elapsed time is over the ceiling that applies here.
func (b Budget) Exceeded(elapsed time.Duration) bool { return elapsed > b.Limit }

// String names both numbers, so a failing run says which one it was held to.
func (b Budget) String() string {
	if b.Scale == 1 {
		return b.Stated.String()
	}
	return fmt.Sprintf("%s x%d for the race detector = %s", b.Stated, b.Scale, b.Limit)
}
