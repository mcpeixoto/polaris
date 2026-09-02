import Foundation
import Observation

/// The issue list, and the writes a list row can perform.
///
/// This client holds no replica and implements no sync socket. Instead it polls
/// `viewer.syncVersion` — the cheapest query in the schema — and refetches only when the
/// number moves. That is most of the freshness benefit of the delta stream for a fraction of
/// the machinery, and it avoids pinning the app to a server-side client-schema constant that
/// bumps between releases.
@MainActor
@Observable
public final class IssuesStore {
    public private(set) var issues: Loadable<[Issue]> = .idle
    public private(set) var includeCompleted = false
    /// Set while a write is in flight so a row can show it is settling without the whole list
    /// dropping back to a spinner.
    public private(set) var pendingIssueIDs: Set<String> = []
    /// True while the list on screen came off disk rather than off the wire, so the header can
    /// say so. Cleared by the first successful load.
    public private(set) var isShowingCachedIssues = false
    /// The last failed background refresh. `refreshIfStale` used to swallow this entirely: a
    /// foregrounded app with a dead session did nothing at all and said nothing about it.
    public private(set) var lastRefreshError: PolarisError?
    /// Called on a refused read, so a session that expired while the app was open ends at the
    /// sign-in screen instead of on a list with no way back.
    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI
    private let cache: (any IssueCache)?
    private var lastSeenVersion: Int?

    public init(api: any PolarisAPI, cache: (any IssueCache)? = nil) {
        self.api = api
        self.cache = cache
    }

    /// Puts the last known list on screen before the first request goes out.
    ///
    /// Called once, from the composition root. The list is marked as cached so the screen can
    /// be honest about it, and the request that follows replaces it — including with an empty
    /// list, which is a legitimate answer.
    public func hydrateFromCache() {
        guard issues.value == nil, let cached = cache?.read(), !cached.isEmpty else { return }
        issues = .loaded(sort(cached))
        isShowingCachedIssues = true
    }

    public func load() async {
        if issues.value == nil { issues = .loading }
        do {
            let fetched = try await api.myIssues(includeCompleted: includeCompleted)
            issues = .loaded(sort(fetched))
            isShowingCachedIssues = false
            lastRefreshError = nil
            // Only the unfiltered list is cached. Persisting a filtered one would restore
            // "everything including completed" as if it were the whole truth on the next cold
            // start, under a filter that is off.
            if includeCompleted == false { cache?.write(fetched) }
            lastSeenVersion = try? await api.syncVersion()
        } catch {
            let mapped = PolarisError.mapped(error)
            lastRefreshError = mapped
            // A refresh that fails must not blank a list the user is reading. Only an empty
            // list surfaces the error; otherwise the stale data stays and the failure is
            // silent, which is the correct trade for a pull-to-refresh.
            if issues.value == nil { issues = .failed(mapped) }
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    public func setIncludeCompleted(_ newValue: Bool) async {
        guard newValue != includeCompleted else { return }
        includeCompleted = newValue
        // Deliberately NOT `issues = .loading`. Blanking to a spinner throws away a list the
        // reader is looking at, and it defeats the protection `load()` implements: with no
        // value held, a refetch that fails turns a populated list into a full-screen error.
        await load()
    }

    /// Accepts an issue changed elsewhere — the detail screen — so the list and its counts
    /// stop disagreeing with the screen the reader just came back from.
    ///
    /// Without this the row keeps its old status indefinitely: nothing reloads on return, and
    /// `refreshIfStale` short-circuits while `syncVersion` is unchanged, which it is, because
    /// the change came from this client.
    public func merge(_ updated: Issue) {
        guard var current = issues.value else { return }
        guard let index = current.firstIndex(where: { $0.id == updated.id }) else { return }
        current[index] = updated
        issues = .loaded(sort(current))
    }

    /// Refetches only if the workspace actually changed.
    ///
    /// Called when the app returns to the foreground, and every thirty seconds while it is
    /// open — see `MainTabView`. One cheap query per tick; nothing is refetched unless the
    /// number moved.
    public func refreshIfStale() async {
        do {
            let version = try await api.syncVersion()
            lastRefreshError = nil
            guard version != lastSeenVersion else { return }
            await load()
        } catch {
            // Reported rather than dropped. A poll that fails silently is how a dead session
            // becomes an app that quietly stops updating and never says why.
            let mapped = PolarisError.mapped(error)
            lastRefreshError = mapped
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    /// Moves an issue to a new state, optimistically.
    ///
    /// The row updates immediately and is rolled back if the server refuses — anything slower
    /// makes a status change feel like a page load. The server's returned issue replaces the
    /// optimistic one rather than being assumed equal to it, so a server-side side effect
    /// (`startedAt`, an automation) is not lost.
    public func setState(issueID: String, to state: WorkflowState) async {
        guard let list = issues.value, let index = list.firstIndex(where: { $0.id == issueID })
        else { return }

        let original = list[index]
        pendingIssueIDs.insert(issueID)
        defer { pendingIssueIDs.remove(issueID) }

        // Apply first, ask after. Without this the row does not move until the round trip
        // finishes, which is the thing "optimistic" is supposed to avoid — and it also means
        // there is nothing for the catch below to roll back, so the rollback would be dead
        // code that no test could distinguish from working.
        var optimistic = list
        optimistic[index].state = state
        issues = .loaded(sort(optimistic))

        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, stateId: state.id))
            if var current = issues.value, let position = current.firstIndex(where: { $0.id == issueID }) {
                current[position] = updated
                issues = .loaded(sort(current))
            }
        } catch {
            // Deliberately not written to `lastRefreshError`, which is about *reads*: the row
            // snapping back is what tells the reader this write was refused, and a second
            // sentence in the header about a stale list would be about something else.
            if var current = issues.value, let position = current.firstIndex(where: { $0.id == issueID }) {
                current[position] = original
                // Re-sorted, like the success path. Restoring the row's value without
                // restoring its place leaves an urgent in-progress issue sitting below a
                // medium one, which reads as a second, stranger bug than the failed write.
                issues = .loaded(sort(current))
            }
        }
    }

    public func create(_ draft: IssueDraft) async throws -> Issue {
        let created = try await api.createIssue(draft)
        var current = issues.value ?? []
        current.append(created)
        issues = .loaded(sort(current))
        return created
    }

    /// Open work first, ordered by priority, then by how recently it moved.
    private func sort(_ list: [Issue]) -> [Issue] { IssueOrder.sorted(list) }
}

/// The one order every issue list in the app is in.
///
/// Shared rather than duplicated per store: a team list and a my-issues list that disagree
/// about where an urgent in-progress issue belongs is the sort of difference nobody can name
/// but everybody notices.
public enum IssueOrder {
    /// Open work first, ordered by priority, then by how recently it moved. Completed and
    /// cancelled issues sink to the bottom when they are shown at all.
    public static func sorted(_ list: [Issue]) -> [Issue] {
        list.sorted { left, right in
            if left.state.category.isOpen != right.state.category.isOpen {
                return left.state.category.isOpen
            }
            if left.priority.sortWeight != right.priority.sortWeight {
                return left.priority.sortWeight < right.priority.sortWeight
            }
            if left.updatedAt != right.updatedAt { return left.updatedAt > right.updatedAt }
            // A final total tiebreak. `sorted(by:)` is not stable, so rows sharing every sort
            // key would otherwise swap places on any re-sort — after a create, after a status
            // change — and look like the list was shuffling itself.
            return left.identifier < right.identifier
        }
    }
}
