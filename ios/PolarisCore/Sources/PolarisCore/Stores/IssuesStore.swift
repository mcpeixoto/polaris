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
    /// Which relationship the list is about. Assigned by default, as it always was.
    public private(set) var scope: MyIssuesScope = .assigned
    /// Set while a write is in flight so a row can show it is settling without the whole list
    /// dropping back to a spinner.
    public private(set) var pendingIssueIDs: Set<String> = []
    /// True while the list on screen came off disk rather than off the wire, so the header can
    /// say so. Cleared by the first successful load.
    public private(set) var isShowingCachedIssues = false
    /// The last failed background refresh. `refreshIfStale` used to swallow this entirely: a
    /// foregrounded app with a dead session did nothing at all and said nothing about it.
    public private(set) var lastRefreshError: PolarisError?
    /// The last refused write from a list row, and the reason for it.
    ///
    /// A rolled-back row was the only thing a refused status change said, and a row that
    /// snaps back is indistinguishable from a tap that missed — which is exactly what "I
    /// can't change the status and I don't know why" looks like from the outside. The detail
    /// screen has said why since it was written; the list said nothing.
    public private(set) var writeError: PolarisError?
    /// The write behind `writeError`, with the `opId` it was sent under — see `PendingWrite`.
    /// `retryLastWrite()` sends that same id, which is what makes the retry the same operation
    /// to the server rather than a second one.
    public private(set) var pendingWrite: PendingWrite?
    /// Called on a refused read, so a session that expired while the app was open ends at the
    /// sign-in screen instead of on a list with no way back.
    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?
    /// Called with the server's issue once a write from this list lands — see
    /// `AppModel.issueDidChange`.
    public var onWriteConfirmed: (@MainActor (Issue) -> Void)?

    private let api: any PolarisAPI
    private let cache: (any IssueCache)?
    /// The `syncVersion` the last successful load observed. Read by the realtime coordinator
    /// as the point to resume the sync socket from, so a reconnect replays what was missed as
    /// one signal instead of losing it.
    public private(set) var lastSeenVersion: Int?

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
            let fetched = try await api.myIssues(scope: scope, includeCompleted: includeCompleted)
            issues = .loaded(sort(fetched))
            isShowingCachedIssues = false
            lastRefreshError = nil
            // The list the refused write rolled back has just been replaced by the server's
            // own, so the sentence about it no longer describes anything on screen — and
            // neither does the offer to send it again.
            writeError = nil
            pendingWrite = nil
            // Only the unfiltered, assigned list is cached. Persisting a filtered one would
            // restore "everything including completed" — or "everything I created" — as if it
            // were the whole truth on the next cold start, under a filter that is off.
            if includeCompleted == false, scope == .assigned { cache?.write(fetched) }
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

    /// Switches between assigned, created and subscribed. Same rule as the completed toggle:
    /// the list on screen stays until the new one answers.
    public func setScope(_ newValue: MyIssuesScope) async {
        guard newValue != scope else { return }
        scope = newValue
        await load()
    }

    /// Accepts an issue changed elsewhere — the detail screen — so the list and its counts
    /// stop disagreeing with the screen the reader just came back from.
    ///
    /// Without this the row keeps its old status indefinitely: nothing reloads on return, and
    /// `refreshIfStale` short-circuits while `syncVersion` is unchanged, which it is, because
    /// the change came from this client.
    public func merge(_ updated: Issue) {
        resolvePendingWrite(against: updated)
        guard var current = issues.value else { return }
        guard let index = current.firstIndex(where: { $0.id == updated.id }) else { return }
        current[index] = updated
        issues = .loaded(sort(current))
    }

    /// Drops the pending write — and the sentence about it — when the value it was asking for
    /// has arrived by another route: another store's confirmed write fanned in through
    /// `AppModel.issueDidChange`, or the refetch a sync signal triggered. The write landed
    /// after all, so there is nothing left to retry and nothing left to apologise for.
    private func resolvePendingWrite(against updated: Issue) {
        guard let pending = pendingWrite, pending.operation.isSatisfied(by: updated) else { return }
        pendingWrite = nil
        writeError = nil
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
        await send(IssueChange(id: issueID, stateId: state.id), applying: state)
    }

    /// Sends the write again under the `opId` it already used.
    ///
    /// Nothing is re-applied optimistically and nothing is minted: the point of the method is
    /// that the server sees the operation it has already been told about, and answers with the
    /// original result if the first attempt did land after all.
    public func retryLastWrite() async {
        guard let pending = pendingWrite, pending.isRetryable else { return }
        switch pending.operation {
        case .issue(let change):
            await send(change, applying: nil)
        case .bulk(let edit):
            await bulkApply(edit)
        // Nothing else reaches this store.
        case .comment, .addLabel, .removeLabel:
            break
        }
    }

    /// One status write: the first attempt, which applies the new state ahead of the reply,
    /// and the retry, which does not — the row is already showing it.
    private func send(_ change: IssueChange, applying state: WorkflowState?) async {
        let issueID = change.id
        guard let list = issues.value, let index = list.firstIndex(where: { $0.id == issueID })
        else {
            // Asked about an issue this list does not hold — a search result, a row from a
            // team screen. Returning here sent no request, showed no error and moved
            // nothing, which from the outside is a tap that missed. The write goes out
            // regardless; the reader asked for it, and which list they asked from is not the
            // server's business.
            await writeUnheld(change)
            return
        }

        let original = list[index]
        pendingIssueIDs.insert(issueID)
        writeError = nil
        defer { pendingIssueIDs.remove(issueID) }

        // Apply first, ask after. Without this the row does not move until the round trip
        // finishes, which is the thing "optimistic" is supposed to avoid — and it also means
        // there is nothing for the catch below to roll back, so the rollback would be dead
        // code that no test could distinguish from working.
        if let state {
            var optimistic = list
            optimistic[index].state = state
            issues = .loaded(sort(optimistic))
        }

        do {
            let updated = try await api.updateIssue(change)
            pendingWrite = nil
            if var current = issues.value, let position = current.firstIndex(where: { $0.id == issueID }) {
                current[position] = updated
                issues = .loaded(sort(current))
            }
            onWriteConfirmed?(updated)
        } catch {
            // Deliberately not written to `lastRefreshError`, which is about *reads*: a
            // sentence in the header about a stale list would be about something else. It
            // goes to `writeError` instead, which the list surfaces on its own — the row
            // snapping back was never enough on its own to tell a refusal from a missed tap.
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            // Held under the id it was sent with, so Retry is this operation again rather
            // than a second one. A refusal is held too — the screen reads `isRetryable` and
            // offers no button for it.
            pendingWrite = PendingWrite(operation: .issue(change), failure: mapped)
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
            if var current = issues.value, let position = current.firstIndex(where: { $0.id == issueID }) {
                current[position] = original
                // Re-sorted, like the success path. Restoring the row's value without
                // restoring its place leaves an urgent in-progress issue sitting below a
                // medium one, which reads as a second, stranger bug than the failed write.
                issues = .loaded(sort(current))
            }
        }
    }

    /// One change across a selection, optimistically.
    ///
    /// The same shape as `setState` and for the same reasons — apply first, reconcile with
    /// what the server returns, roll back what it refused — with one difference that is the
    /// whole point of the operation: the server may accept part of a batch. So the rollback
    /// is per id rather than wholesale. A thrown error is the batch failing as a unit and
    /// every row goes back; a `skipped` entry is one row the server declined, and only that
    /// row goes back, because the other eight genuinely moved and restoring them would be
    /// this client inventing a failure.
    ///
    /// The result is handed to the caller rather than kept here: `skipped` is about the
    /// selection the reader just acted on, not a property of the list, and a screen that
    /// re-renders later must not still be apologising for a batch from ten minutes ago.
    @discardableResult
    public func bulkApply(_ edit: BulkIssueEdit) async -> BulkIssueResult? {
        let ids = Set(edit.change.ids)
        guard !ids.isEmpty else { return nil }
        writeError = nil
        pendingWrite = nil
        pendingIssueIDs.formUnion(ids)
        defer { pendingIssueIDs.subtract(ids) }

        var originals: [String: Issue] = [:]
        if var current = issues.value {
            for index in current.indices where ids.contains(current[index].id) {
                originals[current[index].id] = current[index]
                edit.apply(to: &current[index])
            }
            issues = .loaded(sort(current))
        }

        do {
            let result = try await api.bulkUpdateIssues(edit.change)
            if var current = issues.value {
                for confirmed in result.issues {
                    if let position = current.firstIndex(where: { $0.id == confirmed.id }) {
                        current[position] = confirmed
                    }
                }
                for skip in result.skipped {
                    if let original = originals[skip.id],
                       let position = current.firstIndex(where: { $0.id == skip.id }) {
                        current[position] = original
                    }
                }
                issues = .loaded(sort(current))
            }
            // One fan-out per confirmed issue, and none for a skipped one: the rule in
            // `AppModel.issueDidChange` is that only server-confirmed values travel, and a
            // skipped id has no confirmed value to send.
            for confirmed in result.issues { onWriteConfirmed?(confirmed) }
            return result
        } catch {
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            // The whole batch under one `opId`, which is what makes the retry safe: the
            // server either replays the original block or applies it once.
            pendingWrite = PendingWrite(operation: .bulk(edit), failure: mapped)
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
            if var current = issues.value {
                for (id, original) in originals {
                    if let position = current.firstIndex(where: { $0.id == id }) {
                        current[position] = original
                    }
                }
                issues = .loaded(sort(current))
            }
            return nil
        }
    }

    /// The same write with nothing here to be optimistic about.
    ///
    /// No row to move ahead of the reply and none to roll back, so the row is only marked as
    /// settling and the outcome is either fanned out to the stores that do hold the issue or
    /// said out loud. Slower to feel than the optimistic path, and the honest cost of asking
    /// a list about a row that is not in it.
    private func writeUnheld(_ change: IssueChange) async {
        let issueID = change.id
        pendingIssueIDs.insert(issueID)
        writeError = nil
        defer { pendingIssueIDs.remove(issueID) }
        do {
            let updated = try await api.updateIssue(change)
            pendingWrite = nil
            onWriteConfirmed?(updated)
        } catch {
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            pendingWrite = PendingWrite(operation: .issue(change), failure: mapped)
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    /// Dismisses the refused-write sentence, once the reader has read it. The offer to send it
    /// again goes with the sentence: a Retry button beside nothing explains nothing.
    public func clearWriteError() {
        writeError = nil
        pendingWrite = nil
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

extension IssuesStore: IssueWriting {}

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
