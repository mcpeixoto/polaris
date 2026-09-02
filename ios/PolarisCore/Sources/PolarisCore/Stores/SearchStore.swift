import Foundation
import Observation

/// Search, against the server's `search` query — the same one the web client uses, so a
/// phrase that finds an issue on a laptop finds it on a phone.
///
/// Debounced here rather than in the view. A `.searchable` field fires on every keystroke, and
/// a query per keystroke is both a load the server did not agree to and a race: the answer to
/// "pol" can arrive after the answer to "polaris" and overwrite it. The generation counter is
/// what stops the second half of that.
@MainActor
@Observable
public final class SearchStore {
    public private(set) var results: Loadable<SearchResults> = .idle
    /// What the last completed search was for, so a screen can say "no results for …" using
    /// the query that was actually run rather than whatever is in the field now.
    public private(set) var lastQuery = ""

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    /// How long the field must be quiet before a request goes out.
    public static let debounce = Duration.milliseconds(250)

    private let api: any PolarisAPI
    private var generation = 0
    private var inFlight: Task<Void, Never>?

    public init(api: any PolarisAPI) {
        self.api = api
    }

    /// Called on every keystroke. Cancels the pending request, waits, then searches.
    public func query(_ text: String, debounce: Duration = SearchStore.debounce) {
        inFlight?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            // An empty field is `.idle`, not "no results": the screen shows its prompt rather
            // than telling somebody who has typed nothing that nothing matched.
            generation += 1
            results = .idle
            lastQuery = ""
            return
        }
        inFlight = Task { [weak self] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled else { return }
            await self?.run(trimmed)
        }
    }

    /// Searches immediately — the return key, and the retry button.
    public func submit(_ text: String) async {
        inFlight?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await run(trimmed)
    }

    private func run(_ trimmed: String) async {
        generation += 1
        let mine = generation
        if results.value == nil { results = .loading }
        do {
            let found = try await api.search(query: trimmed)
            // A slower earlier query must not overwrite a faster later one.
            guard mine == generation else { return }
            results = .loaded(found)
            lastQuery = trimmed
        } catch {
            guard mine == generation else { return }
            let mapped = PolarisError.mapped(error)
            results = .failed(mapped)
            lastQuery = trimmed
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }
}

/// One team's issues.
///
/// `PolarisAPI.issues(teamId:)` was implemented on both clients and called by no screen. This
/// is what calls it.
@MainActor
@Observable
public final class TeamIssuesStore {
    public private(set) var issues: Loadable<[Issue]> = .idle
    public let team: Team

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI

    public init(api: any PolarisAPI, team: Team) {
        self.api = api
        self.team = team
    }

    public func load() async {
        if issues.value == nil { issues = .loading }
        do {
            issues = .loaded(IssueOrder.sorted(try await api.issues(teamId: team.id)))
        } catch {
            let mapped = PolarisError.mapped(error)
            if issues.value == nil { issues = .failed(mapped) }
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    /// Optimistic status change, as the list's swipe action calls it.
    public func setState(issueID: String, to state: WorkflowState) async {
        guard let list = issues.value, let index = list.firstIndex(where: { $0.id == issueID })
        else { return }
        let original = list[index]
        var optimistic = list
        optimistic[index].state = state
        issues = .loaded(IssueOrder.sorted(optimistic))
        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, stateId: state.id))
            replace(updated, fallback: nil)
        } catch {
            replace(original, fallback: original)
        }
    }

    public func merge(_ updated: Issue) {
        replace(updated, fallback: nil)
    }

    private func replace(_ issue: Issue, fallback: Issue?) {
        guard var current = issues.value,
              let position = current.firstIndex(where: { $0.id == issue.id })
        else { return }
        current[position] = fallback ?? issue
        issues = .loaded(IssueOrder.sorted(current))
    }
}
