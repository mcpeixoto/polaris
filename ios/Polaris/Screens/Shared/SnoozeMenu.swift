import SwiftUI
import PolarisCore

/// The three snoozes Linear offers, and when each one lands.
///
/// Pure, with the clock and calendar injected, so "tomorrow at nine" is the reader's tomorrow
/// and the same in a test at midnight as at noon.
enum SnoozeOption: String, CaseIterable, Identifiable {
    case laterToday
    case tomorrow
    case nextWeek

    var id: String { rawValue }

    var title: String {
        switch self {
        case .laterToday: String(localized: "Later today")
        case .tomorrow: String(localized: "Tomorrow")
        case .nextWeek: String(localized: "Next week")
        }
    }

    var symbolName: String {
        switch self {
        case .laterToday: "clock"
        case .tomorrow: "sunrise"
        case .nextWeek: "calendar"
        }
    }

    /// Later today is three hours out; tomorrow and next week land at nine in the morning,
    /// because a notification that resurfaces at 03:17 is one that gets snoozed again.
    func date(from now: Date = .now, calendar: Calendar = .current) -> Date {
        switch self {
        case .laterToday:
            return now.addingTimeInterval(3 * 60 * 60)
        case .tomorrow:
            let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
            return at9(tomorrow, calendar: calendar)
        case .nextWeek:
            // The Monday of next week, never today: on a Monday morning "next week" is seven
            // days away, and on a Sunday it is tomorrow.
            var day = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
            while calendar.component(.weekday, from: day) != 2 {
                day = calendar.date(byAdding: .day, value: 1, to: day) ?? day
            }
            return at9(day, calendar: calendar)
        }
    }

    private func at9(_ day: Date, calendar: Calendar) -> Date {
        calendar.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
    }
}

/// The snooze options as a submenu, for a context menu or a toolbar. The row's own swipe
/// action keeps the one-tap default; this is for choosing.
struct SnoozeMenu: View {
    let onPick: (Date) -> Void
    var now: Date = .now

    var body: some View {
        Menu {
            ForEach(SnoozeOption.allCases) { option in
                Button {
                    onPick(option.date(from: now))
                } label: {
                    SwiftUI.Label {
                        Text(option.title)
                        Text(option.date(from: now), format: option == .laterToday
                             ? .dateTime.hour().minute()
                             : .dateTime.weekday(.abbreviated).hour().minute())
                    } icon: {
                        Image(systemName: option.symbolName)
                    }
                }
                .accessibilityIdentifier("snooze.\(option.rawValue)")
            }
        } label: {
            SwiftUI.Label("Snooze…", systemImage: "clock")
        }
    }
}
