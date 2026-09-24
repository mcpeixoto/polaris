package notify

import (
	"fmt"
	"time"
)

// Due-date notices are not deliveries.
//
// Deliveries answers "somebody changed something". A deadline arriving is the calendar, and
// the sweep in internal/domain is what asks. This file is only the question: given a due
// date, a clock and a team's zone, is this the morning to speak, and which of the two
// things is there to say.
//
// Two, and then never again. The morning of the due date, and the morning after it. A third
// morning that repeats "still overdue" is how a lock screen teaches somebody to mute the
// channel, and the product would have spent its one interruption on a fact they already
// know. Whether they have already been told is the sweep's claim, not a decision this
// function can make — it has no memory.

const (
	// DueToday is the morning of the deadline.
	DueToday = "today"
	// DueOverdue is the morning after, once.
	DueOverdue = "overdue"

	// DueMorningHour is the local hour at which a notice may go out. Before it, the sweep
	// runs and says nothing: a deadline announced at 00:05 is a notification about a day
	// the recipient is not in yet.
	DueMorningHour = 8
)

// DueNotice reports whether due should be mentioned at now, in the team's timezone.
//
// kind is DueToday or DueOverdue. localDate is the calendar day in that zone, which is
// what the sweep groups a morning's notices under — three issues due on the same morning
// are one row, and a morning in another zone is a different morning.
//
// ok is false when it is not time: before morning, or a date that is still in the future.
// err is set only when timezone is not a zone the process can load. The caller skips that
// issue and logs it; guessing UTC would announce a deadline on the wrong day, which is the
// bug a due date stored as a date exists to prevent.
func DueNotice(due, now time.Time, timezone string) (kind, localDate string, ok bool, err error) {
	loc, loadErr := time.LoadLocation(timezone)
	if loadErr != nil {
		return "", "", false, fmt.Errorf("timezone %q: %w", timezone, loadErr)
	}

	local := now.In(loc)
	localDate = local.Format("2006-01-02")
	if local.Hour() < DueMorningHour {
		return "", localDate, false, nil
	}

	// The due date is a calendar day. Taking its UTC year, month and day is correct because
	// that is how a date column comes back: midnight UTC of the day it names, not an instant
	// anybody chose. Converting it into the team's zone first would move it to the previous
	// evening for every team west of UTC.
	dueDay := time.Date(due.UTC().Year(), due.UTC().Month(), due.UTC().Day(), 0, 0, 0, 0, time.UTC)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)

	switch {
	case dueDay.Equal(today):
		return DueToday, localDate, true, nil
	case dueDay.Before(today):
		return DueOverdue, localDate, true, nil
	default:
		return "", localDate, false, nil
	}
}

// DueGroupKey is the coalescing key for one person's notices on one morning.
//
// The user is not in it. The unique index is (user_id, group_key), so the key only has to
// separate mornings, and two people told about the same morning share a key without sharing
// a row.
func DueGroupKey(kind, localDate string) string {
	return "due:" + kind + ":" + localDate
}
