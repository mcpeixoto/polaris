package entitlement

import (
	"errors"
	"testing"
)

// The cap has to bind on the boundary, in both directions. A workspace one issue short of
// its ceiling may create that issue; a workspace at its ceiling may not. Off by one here
// is a customer who cannot file the ten-thousandth issue they were promised, or a free
// tier that quietly holds more than it sells.
func TestCanAddIssues_Boundary(t *testing.T) {
	set := For(PlanFree)
	free := Set{features: set, writeFeatures: set}

	if err := free.CanAddIssues(9_999, 1); err != nil {
		t.Fatalf("the 10,000th issue was refused: %v", err)
	}
	if err := free.CanAddIssues(10_000, 1); err == nil {
		t.Fatal("a workspace at its ceiling was allowed one more")
	}
}

// An import creates thousands in one call, which is exactly the path a per-issue check
// misses: ask "does one more fit?" 50,000 times and every answer is yes until the last.
func TestCanAddIssues_CountsTheWholeBatch(t *testing.T) {
	set := For(PlanFree)
	free := Set{features: set, writeFeatures: set}

	if err := free.CanAddIssues(9_000, 500); err != nil {
		t.Fatalf("a batch that fits was refused: %v", err)
	}
	if err := free.CanAddIssues(9_000, 1_500); err == nil {
		t.Fatal("a batch that would cross the ceiling was allowed")
	}

	// A refusal a client can render, not just a sentence.
	var ent *Error
	if err := free.CanAddIssues(10_000, 1); !errors.As(err, &ent) {
		t.Fatalf("refusal is not an *Error: %T", err)
	} else if ent.Limit != LimitIssues {
		t.Fatalf("refusal names %q, want %q", ent.Limit, LimitIssues)
	}
}

// Nothing to add is not a refusal, whatever the count.
func TestCanAddIssues_ZeroAlwaysFits(t *testing.T) {
	set := For(PlanFree)
	full := Set{features: set, writeFeatures: set}
	if err := full.CanAddIssues(99_999, 0); err != nil {
		t.Fatalf("adding nothing was refused: %v", err)
	}
}

// The paid plans are unlimited, and a lapse must not hand a workspace more room than the
// plan it lapsed from — narrow() takes the smaller, and this is that invariant at the one
// place a customer would notice it.
func TestCanAddIssues_UnlimitedAndLapsed(t *testing.T) {
	pro := For(PlanPro)
	unlimited := Set{features: pro, writeFeatures: pro}
	if err := unlimited.CanAddIssues(5_000_000, 1); err != nil {
		t.Fatalf("an unlimited plan refused an issue: %v", err)
	}

	// A lapsed Pro writes as Free: reading keeps the full history, writing stops at the
	// free ceiling.
	lapsed := Set{features: pro, writeFeatures: pro.narrow(For(PlanFree))}
	if err := lapsed.CanAddIssues(10_000, 1); err == nil {
		t.Fatal("a lapsed workspace kept its unlimited issue ceiling")
	}
}
