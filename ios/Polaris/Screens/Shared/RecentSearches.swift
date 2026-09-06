import Foundation
import Observation

/// The last few things searched for, most recent first.
///
/// A phone search is mostly a re-search — the identifier from this morning, the phrase from
/// the standup — and typing it again on glass is the slowest part. Eight is enough to hold a
/// day without becoming a list to scroll. Kept on the device: it is the reader's own history,
/// and the server has no reason to know it.
///
/// The fixture app gets no `UserDefaults` at all, for the reason `InMemoryIssueCache` exists:
/// a UI test run must not leave yesterday's queries on disk for the next run to find.
@MainActor
@Observable
final class RecentSearches {
    nonisolated static let limit = 8
    nonisolated static let storageKey = "polaris.search.recent"

    private(set) var items: [String]
    private let defaults: UserDefaults?

    init(defaults: UserDefaults?) {
        self.defaults = defaults
        items = defaults?.stringArray(forKey: Self.storageKey) ?? []
    }

    /// Puts a query at the front, deduplicated without regard to case or surrounding space,
    /// and drops whatever falls off the end.
    nonisolated static func adding(_ query: String, to list: [String], limit: Int = RecentSearches.limit) -> [String] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return list }
        var next = list.filter { $0.caseInsensitiveCompare(trimmed) != .orderedSame }
        next.insert(trimmed, at: 0)
        return Array(next.prefix(limit))
    }

    func remember(_ query: String) {
        write(Self.adding(query, to: items))
    }

    func remove(_ query: String) {
        write(items.filter { $0 != query })
    }

    func clear() {
        write([])
    }

    private func write(_ list: [String]) {
        items = list
        defaults?.set(list, forKey: Self.storageKey)
    }
}
