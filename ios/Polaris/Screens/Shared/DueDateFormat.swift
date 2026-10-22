import Foundation
import PolarisCore

/// How a due date is said on a row: short, and red once it has passed.
///
/// `Issue.dueDate` is the wire string — a calendar day, `2006-01-02`, with no timezone — so
/// it is interpreted in the *reader's* calendar. A deadline of "the 30th" is the 30th
/// wherever the reader is, which is what a date with no time means.
enum DueDateFormat {
    struct Presentation: Equatable {
        let text: String
        /// Strictly before today. Due today is not overdue; it is the day it is due.
        let isOverdue: Bool
    }

    /// Nil for a value that is not a calendar day, so a malformed date renders as no date
    /// rather than as a lie about when something is due.
    static func present(
        _ dueDate: String,
        relativeTo now: Date = .now,
        calendar: Calendar = .current
    ) -> Presentation? {
        guard let date = day(dueDate, calendar: calendar) else { return nil }
        let today = calendar.startOfDay(for: now)
        let isOverdue = date < today
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: today)
        var style = Date.FormatStyle(calendar: calendar).month(.abbreviated).day()
        if !sameYear { style = style.year() }
        return Presentation(text: date.formatted(style), isOverdue: isOverdue)
    }

    /// `2026-09-30` as midnight of that day in the given calendar.
    ///
    /// The implementation moved to `CalendarDay` in Core when the due-date *buckets* needed it:
    /// a row that calls something overdue and a heading that files it under "This week" have to
    /// be parsing the same way, and two copies of this would eventually disagree about
    /// `2026-02-30`.
    static func day(_ value: String, calendar: Calendar) -> Date? {
        CalendarDay.parse(value, calendar: calendar)
    }
}
