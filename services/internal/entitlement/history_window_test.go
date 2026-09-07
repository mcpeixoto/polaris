package entitlement

import (
	"testing"
	"time"
)

// The history window is the one limit in the matrix that a READ spends, so these assert the
// two things a read cares about: where the cutoff falls, and that a lapse never moves it.

func TestHistoryWindow_IsThePlansCutoff(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

	free := New(Facts{Plan: PlanFree})
	cutoff, windowed := free.HistoryWindow(now)
	if !windowed {
		t.Fatal("free advertises 90 days of activity and answered that it has no window")
	}
	if want := now.AddDate(0, 0, -90); !cutoff.Equal(want) {
		t.Errorf("free cutoff is %v, want %v", cutoff, want)
	}

	for _, p := range []Plan{PlanPro, PlanEnterprise, PlanSelfHosted} {
		if _, windowed := New(Facts{Plan: p}).HistoryWindow(now); windowed {
			t.Errorf("%s keeps history forever and must return no cutoff at all, so a caller "+
				"cannot filter against the zero time by accident", p)
		}
	}
}

// The lapsed rule, on the read side. A Pro workspace whose card failed keeps every entry it
// has ever had: shortening its history to the free window would be the product deleting a
// year of context from view over a billing problem, which is the failure Set.Limit's comment
// and the lapsed rule both exist to prevent.
func TestHistoryWindow_DoesNotNarrowOnALapse(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

	lapsed := New(Facts{Plan: PlanPro, PlanLapsedAt: lapsedAt})
	if !lapsed.Lapsed() {
		t.Fatal("this workspace was meant to be lapsed; the rest of the test proves nothing")
	}
	if _, windowed := lapsed.HistoryWindow(now); windowed {
		t.Error("a lapsed Pro workspace was given the free tier's 90-day window: reads keep " +
			"working through a lapse, and its history is a read")
	}
}

// A window that is neither the sentinel nor a positive number cannot come out of the matrix,
// and if one ever did the honest answer on a read is no window rather than an empty feed.
func TestHistoryWindow_FailsOpenOnANonsenseWindow(t *testing.T) {
	s := New(Facts{Plan: PlanFree})
	s.features.HistoryDays = 0

	if _, windowed := s.HistoryWindow(time.Now()); windowed {
		t.Error("a zero-day window hid a workspace's entire history; a wrong number must " +
			"not be able to blank a read")
	}
}
