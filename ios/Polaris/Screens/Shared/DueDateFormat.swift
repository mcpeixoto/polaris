import Foundation

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
    static func day(_ value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              (1...12).contains(month), (1...31).contains(day)
        else { return nil }
        var components = DateComponents()
        components.calendar = calendar
        components.year = year
        components.month = month
        components.day = day
        guard let date = components.date, components.isValidDate(in: calendar) else { return nil }
        return calendar.startOfDay(for: date)
    }
}
