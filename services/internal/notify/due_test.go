package notify

import (
	"testing"
	"time"
)

func TestDueNotice(t *testing.T) {
	due := time.Date(2026, 9, 23, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name     string
		now      time.Time
		zone     string
		wantKind string
		wantDate string
		wantOK   bool
		wantErr  bool
	}{
		{
			name:     "the morning it is due",
			now:      time.Date(2026, 9, 23, 9, 0, 0, 0, time.UTC),
			zone:     "UTC",
			wantKind: DueToday,
			wantDate: "2026-09-23",
			wantOK:   true,
		},
		{
			name:     "before morning it says nothing",
			now:      time.Date(2026, 9, 23, 7, 59, 0, 0, time.UTC),
			zone:     "UTC",
			wantOK:   false,
			wantDate: "2026-09-23",
		},
		{
			name:     "the morning after, once is the sweep's problem",
			now:      time.Date(2026, 9, 24, 8, 0, 0, 0, time.UTC),
			zone:     "UTC",
			wantKind: DueOverdue,
			wantDate: "2026-09-24",
			wantOK:   true,
		},
		{
			name:     "a future date is not news",
			now:      time.Date(2026, 9, 22, 12, 0, 0, 0, time.UTC),
			zone:     "UTC",
			wantOK:   false,
			wantDate: "2026-09-22",
		},
		{
			name:     "morning is the team's morning, not UTC",
			now:      time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC), // 08:00 in New York
			zone:     "America/New_York",
			wantKind: DueToday,
			wantDate: "2026-09-23",
			wantOK:   true,
		},
		{
			name:     "an hour earlier in that zone is still night",
			now:      time.Date(2026, 9, 23, 11, 0, 0, 0, time.UTC), // 07:00 in New York
			zone:     "America/New_York",
			wantOK:   false,
			wantDate: "2026-09-23",
		},
		{
			name:    "a zone the process cannot load is an error, not a guess",
			now:     time.Date(2026, 9, 23, 9, 0, 0, 0, time.UTC),
			zone:    "Not/Azone",
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			kind, localDate, ok, err := DueNotice(due, tc.now, tc.zone)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected an error for an unusable timezone")
				}
				return
			}
			if err != nil {
				t.Fatalf("DueNotice: %v", err)
			}
			if ok != tc.wantOK || kind != tc.wantKind || localDate != tc.wantDate {
				t.Fatalf("DueNotice() = (%q, %q, %v), want (%q, %q, %v)",
					kind, localDate, ok, tc.wantKind, tc.wantDate, tc.wantOK)
			}
		})
	}
}

func TestDueGroupKeySeparatesMornings(t *testing.T) {
	today := DueGroupKey(DueToday, "2026-09-23")
	overdue := DueGroupKey(DueOverdue, "2026-09-23")
	next := DueGroupKey(DueToday, "2026-09-24")
	if today == overdue || today == next || overdue == next {
		t.Fatalf("group keys collided: %s %s %s", today, overdue, next)
	}
}
