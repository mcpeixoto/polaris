import Foundation

/// Rows bucketed by the day they happened, newest first: Today, Yesterday, then dated.
///
/// Pure, with `now` and the calendar injected, so the buckets are the same in a test at
/// midnight as at noon — and so "Today" is the reader's today rather than the server's.
enum DayGrouping {
    struct Group<Item>: Identifiable {
        let title: String
        let items: [Item]
        var id: String { title }
    }

    static func group<Item>(
        _ items: [Item],
        date: (Item) -> Date,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> [Group<Item>] {
        var groups: [Group<Item>] = []
        var current: (title: String, items: [Item])?
        // Consecutive runs, not a dictionary: the caller's order is the order — newest first
        // for an inbox — and a dictionary would have to be re-sorted by a key it threw away.
        for item in items {
            let title = self.title(for: date(item), now: now, calendar: calendar)
            if current?.title == title {
                current?.items.append(item)
            } else {
                if let current { groups.append(Group(title: current.title, items: current.items)) }
                current = (title, [item])
            }
        }
        if let current { groups.append(Group(title: current.title, items: current.items)) }
        return groups
    }

    static func title(for date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return String(localized: "Today") }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return String(localized: "Yesterday")
        }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        // Built from fields rather than from a `.abbreviated` base, which carries the year
        // whether it is wanted or not.
        var style = Date.FormatStyle(calendar: calendar).weekday(.abbreviated).month(.abbreviated).day()
        if !sameYear { style = style.year() }
        return date.formatted(style)
    }
}
