import Foundation
import Observation

/// Search, against the server's `search` query — the same one the web client uses, so a
/// phrase that finds an issue on a laptop finds it on a phone.
///
/// Debounced here rather than in the view. A `.searchable` field fires on every keystroke, and
/// a query per keystroke is both a load the server did not agree to and a race: the answer to
/// "pol" can arrive after the answer to "polaris" and overwrite it. The generation counter is
/// what stops the second half of that.
///
/// It also owns the writes a result row can make. It has to: the results are held here and
/// nowhere else, so a status change routed to any other store is a change to a list that does
/// not contain the row.
@MainActor
@Observable
public final class SearchStore {
    public private(set) var results: Loadable<SearchResults> = .idle
    /// What the last completed search was for, so a screen can say "no results for …" using
    /// the query that was actually run rather than whatever is in the field now.
    public private(set) var lastQuery = ""
    /// Set while a write is in flight, so a result row can show it is settling.
    public private(set) var pendingIssueIDs: Set<String> = []
    /// The last refused write from a result row, for the reason `IssuesStore` keeps one: a
    /// row that snaps back reads as a tap that missed.
    public private(set) var writeError: PolarisError?

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?
    /// Called with the server's issue once a write from a result row lands — see
    /// `AppModel.issueDidChange`.
    public var onWriteConfirmed: (@MainActor (Issue) -> Void)?

    /// How long the field must be quiet before a request goes out.
    public static let debounce = Duration.milliseconds(250)

    private let api: any PolarisAPI
    private var generation = 0
    private var inFlight: Task<Void, Never>?

    public init(api: any PolarisAPI) {
        self.api = api
    }

    /// Called on every keystroke. Cancels the pending request, waits, then searches.
    ///
    /// `teamId` and `filter` narrow the search server-side, so the count a screen reports is
    /// the count of what matched rather than of what the phone kept.
    public func query(
        _ text: String,
        teamId: String? = nil,
        filter: JSONValue? = nil,
        debounce: Duration = SearchStore.debounce
    ) {
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
            await self?.run(trimmed, teamId: teamId, filter: filter)
        }
    }

    /// Searches immediately — the return key, a recent row, a changed chip, the retry button.
    public func submit(_ text: String, teamId: String? = nil, filter: JSONValue? = nil) async {
        inFlight?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await run(trimmed, teamId: teamId, filter: filter)
    }

    private func run(_ trimmed: String, teamId: String?, filter: JSONValue?) async {
        generation += 1
        let mine = generation
        if results.value == nil { results = .loading }
        do {
            let found = try await api.search(
                query: trimmed, teamId: teamId, first: PageSize.search, filter: filter
            )
            // A slower earlier query must not overwrite a faster later one.
            guard mine == generation else { return }
            results = .loaded(found)
            lastQuery = trimmed
            // The list the refused write rolled back has just been replaced, so the sentence
            // about it no longer describes anything on screen.
            writeError = nil
        } catch {
            guard mine == generation else { return }
            let mapped = PolarisError.mapped(error)
            results = .failed(mapped)
            lastQuery = trimmed
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    // MARK: Writes

    /// Optimistic status change on a result row.
    ///
    /// The screen used to route this to `IssuesStore`, which holds the reader's own issues
    /// and almost never the thing they have just searched for — so the row did not move, no
    /// request went out, and nothing said why.
    public func setState(issueID: String, to state: WorkflowState) async {
        guard let current = results.value,
              let index = current.issues.firstIndex(where: { $0.id == issueID })
        else { return }
        let original = current.issues[index]
        pendingIssueIDs.insert(issueID)
        writeError = nil
        defer { pendingIssueIDs.remove(issueID) }

        var optimistic = current.issues
        optimistic[index].state = state
        results = .loaded(SearchResults(issues: optimistic, issueCount: current.issueCount))

        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, stateId: state.id))
            replace(updated)
            onWriteConfirmed?(updated)
        } catch {
            replace(original)
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    /// Dismisses the refused-write sentence, once the reader has read it.
    public func clearWriteError() {
        writeError = nil
    }

    public func merge(_ updated: Issue) {
        replace(updated)
    }

    /// Replaced in place, never re-sorted: these rows are in the server's relevance order,
    /// and a result that jumped position because its status changed would read as the search
    /// having quietly re-run itself.
    private func replace(_ issue: Issue) {
        guard let current = results.value,
              let position = current.issues.firstIndex(where: { $0.id == issue.id })
        else { return }
        var list = current.issues
        list[position] = issue
        results = .loaded(SearchResults(issues: list, issueCount: current.issueCount))
    }
}

extension SearchStore: IssueWriting {}

/// One team's issues.
///
/// `PolarisAPI.issues(teamId:)` was implemented on both clients and called by no screen. This
/// is what calls it.
@MainActor
@Observable
public final class TeamIssuesStore {
    public private(set) var issues: Loadable<[Issue]> = .idle
    public let team: Team
    /// The last refused status change, for the same reason `IssuesStore` keeps one: a row
    /// that snaps back says something went wrong and nothing about what.
    public private(set) var writeError: PolarisError?

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?
    /// Called with the server's issue once a write from this list lands — see
    /// `AppModel.issueDidChange`.
    public var onWriteConfirmed: (@MainActor (Issue) -> Void)?

    private let api: any PolarisAPI

    public init(api: any PolarisAPI, team: Team) {
        self.api = api
        self.team = team
    }

    public func load() async {
        if issues.value == nil { issues = .loading }
        do {
            issues = .loaded(IssueOrder.sorted(try await api.issues(teamId: team.id)))
            // The list the refused write rolled back has just been replaced by the server's
            // own, so the sentence about it no longer describes anything on screen.
            writeError = nil
        } catch {
            let mapped = PolarisError.mapped(error)
            if issues.value == nil { issues = .failed(mapped) }
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    /// Optimistic status change, as the list's swipe action calls it.
    public func setState(issueID: String, to state: WorkflowState) async {
        guard let list = issues.value, let index = list.firstIndex(where: { $0.id == issueID })
        else {
            // Not in this team's list. Sent anyway rather than dropped — see
            // `IssuesStore.setState`.
            await writeUnheld(issueID: issueID, to: state)
            return
        }
        let original = list[index]
        writeError = nil
        var optimistic = list
        optimistic[index].state = state
        issues = .loaded(IssueOrder.sorted(optimistic))
        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, stateId: state.id))
            replace(updated, fallback: nil)
            onWriteConfirmed?(updated)
        } catch {
            replace(original, fallback: original)
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    private func writeUnheld(issueID: String, to state: WorkflowState) async {
        writeError = nil
        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, stateId: state.id))
            onWriteConfirmed?(updated)
        } catch {
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    /// Dismisses the refused-write sentence, once the reader has read it.
    public func clearWriteError() {
        writeError = nil
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

extension TeamIssuesStore: IssueWriting {}
