import Foundation
import PolarisCore

/// A team's cycles, split the way the cycles screen lists them: the one running now, the
/// ones after it, and the ones that are over.
///
/// `now` is an argument everywhere so a test does not depend on the wall clock — the fixture
/// cycles are dated relative to launch for the same reason.
enum CycleBuckets {
    struct Buckets: Equatable {
        let active: [Cycle]
        /// Soonest first.
        let upcoming: [Cycle]
        /// Most recently ended first.
        let past: [Cycle]
    }

    static func bucket(_ cycles: [Cycle], at now: Date = .now) -> Buckets {
        var active: [Cycle] = []
        var upcoming: [Cycle] = []
        var past: [Cycle] = []
        for cycle in cycles {
            if cycle.isActive(at: now) {
                active.append(cycle)
            } else if cycle.isUpcoming(at: now) {
                upcoming.append(cycle)
            } else {
                // Ended, or closed early: `completedAt` set on a cycle still inside its dates
                // is a cycle somebody finished, not one that is running.
                past.append(cycle)
            }
        }
        return Buckets(
            active: active.sorted { $0.number < $1.number },
            upcoming: upcoming.sorted { $0.startsAt < $1.startsAt },
            past: past.sorted { $0.endsAt > $1.endsAt }
        )
    }

    /// Whole days until the cycle ends, clamped at zero — the same arithmetic as
    /// `CycleStore.daysRemaining(at:)`, for the rows that have a cycle but no store.
    static func daysRemaining(_ cycle: Cycle, at now: Date = .now) -> Int {
        max(0, Int((cycle.endsAt.timeIntervalSince(now) / 86_400).rounded(.up)))
    }

    /// Whole days until the cycle starts, for an upcoming one.
    static func daysUntilStart(_ cycle: Cycle, at now: Date = .now) -> Int {
        max(0, Int((cycle.startsAt.timeIntervalSince(now) / 86_400).rounded(.up)))
    }

    /// "4 days left", "Starts in 7 days", "Ended", "Completed". The count rounds up, so the
    /// last day of a cycle reads "1 day left" rather than a zero that means "still running".
    static func timing(_ cycle: Cycle, at now: Date = .now) -> String {
        if cycle.completedAt != nil { return String(localized: "Completed") }
        if now >= cycle.endsAt { return String(localized: "Ended") }
        if now < cycle.startsAt {
            let days = daysUntilStart(cycle, at: now)
            return days <= 1
                ? String(localized: "Starts tomorrow")
                : String(localized: "Starts in \(days) days")
        }
        return daysLeft(daysRemaining(cycle, at: now))
    }

    /// The words for a remaining-days count, shared with the detail screen whose count comes
    /// from `CycleStore` rather than from here.
    static func daysLeft(_ days: Int) -> String {
        days <= 1
            ? String(localized: "1 day left")
            : String(localized: "\(days) days left")
    }
}
