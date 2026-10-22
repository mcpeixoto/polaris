import Foundation
import Testing
@testable import PolarisCore

/// What a bulk edit must do, asserted host-side.
///
/// The action bar that drives this is a dozen lines of SwiftUI; everything that can actually
/// be wrong about triaging ten rows at once is in the store and the client — does every held
/// row move, does a partial success report itself, does a refusal put the whole batch back,
/// and is a retry one write rather than two. None of that needs a simulator, and all of it
/// needs to be true before the bar is worth tapping.
@MainActor
struct BulkWriteTests {
    /// The four fixture issues are on one team with one set of states, so `s4` — Done — is a
    /// legitimate target for all of them.
    private var done: WorkflowState { FixtureData.states[3] }

    @Test("a bulk state change moves every held row and fans each one out exactly once")
    func bulkStateChangeMovesEveryRow() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        var fannedOut: [String] = []
        store.onWriteConfirmed = { fannedOut.append($0.id) }
        await store.load()

        let ids = ["i1", "i2", "i3"]
        let result = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ids, stateId: done.id), state: done)
        )

        #expect(result?.issues.count == 3)
        #expect(result?.skipped.isEmpty == true)
        let moved = store.issues.value?.filter { ids.contains($0.id) } ?? []
        #expect(moved.count == 3)
        #expect(moved.allSatisfy { $0.state.id == done.id })
        // Exactly once each. A fan-out per row per store is how five lists end up
        // disagreeing; a fan-out twice for the same row is how a counter double-counts.
        #expect(fannedOut.sorted() == ids.sorted())
        #expect(store.pendingIssueIDs.isEmpty)
    }

    @Test("a priority change carries through the batch, and the untouched fields stay")
    func bulkPriorityChangeKeepsEverythingElse() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()

        _ = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ["i1", "i2"], priority: .low))
        )

        let one = store.issues.value?.first { $0.id == "i1" }
        #expect(one?.priority == .low)
        // The same defect `updateIssue` had in the double: a bulk edit that rebuilt the row
        // would silently drop the labels, which reads as a product bug.
        #expect(one?.labels.count == 2)
        #expect(one?.state.id == FixtureData.states[2].id)
    }

    @Test("a partial success reports the skipped ids and rolls back only those")
    func partialSuccessRollsBackOnlyTheSkipped() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        let before = try #require(store.issues.value?.first { $0.id == "i2" })

        // "i9" is not in the workspace, which is the shape of a row deleted out from under a
        // selection. The server skips it and changes the rest rather than failing the batch.
        let result = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ["i1", "i9", "i2"], stateId: done.id), state: done)
        )

        #expect(result?.issues.count == 2)
        #expect(result?.skipped.map(\.id) == ["i9"])
        #expect(result?.skipped.first?.reason.isEmpty == false)
        #expect(store.issues.value?.first { $0.id == "i1" }?.state.id == done.id)
        #expect(store.issues.value?.first { $0.id == "i2" }?.state.id == done.id)
        #expect(before.state.id != done.id, "the fixture row was already Done; this proves nothing")
        // Nothing to roll back here — the skipped id was never in the list — and the two that
        // landed must not have been reverted along with it.
        #expect(store.writeError == nil)
    }

    @Test("a skipped row that IS on screen goes back, and the others do not")
    func skippedHeldRowRollsBackAlone() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        // Removing the issue behind the double's back is what a row deleted elsewhere looks
        // like: the list still holds it, the server no longer does.
        try await api.deleteIssue(id: "i3", opId: "setup")
        let original = try #require(store.issues.value?.first { $0.id == "i3" })

        let result = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ["i1", "i3"], stateId: done.id), state: done)
        )

        #expect(result?.skipped.map(\.id) == ["i3"])
        #expect(store.issues.value?.first { $0.id == "i1" }?.state.id == done.id)
        #expect(store.issues.value?.first { $0.id == "i3" }?.state.id == original.state.id)
    }

    @Test("an armed failure rolls the whole optimistic batch back and says why")
    func armedFailureRollsEverythingBack() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        var fanned = 0
        store.onWriteConfirmed = { _ in fanned += 1 }
        await store.load()
        let before = store.issues.value ?? []
        await api.setFailNextWrite(.forbidden)

        let result = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ["i1", "i2", "i3"], stateId: done.id), state: done)
        )

        #expect(result == nil)
        #expect(store.writeError == .forbidden)
        #expect(fanned == 0, "an optimistic value escaped to the other stores")
        for original in before {
            #expect(store.issues.value?.first { $0.id == original.id }?.state.id == original.state.id)
        }
        #expect(store.pendingIssueIDs.isEmpty)
    }

    @Test("a retry with the same opId is one write at the fixture")
    func retryWithTheSameOpIdIsOneWrite() async throws {
        let api = FixturePolarisClient()
        let change = BulkIssueChange(ids: ["i1", "i2"], opId: "op-bulk-1", stateId: done.id)

        let first = try await api.bulkUpdateIssues(change)
        let replayed = try await api.bulkUpdateIssues(change)

        #expect(await api.bulkWritesApplied == 1)
        #expect(first.issues.map(\.id) == replayed.issues.map(\.id))
        #expect(replayed.issues.allSatisfy { $0.state.id == done.id })
    }

    @Test("a team list's bulk edit moves its own rows and fans them out")
    func teamStoreBulkApply() async throws {
        let api = FixturePolarisClient()
        let store = TeamWorkStore(api: api, team: FixtureData.team)
        var fannedOut: [String] = []
        store.onWriteConfirmed = { fannedOut.append($0.id) }
        await store.load()

        let result = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ["i1", "i2"], stateId: done.id), state: done)
        )

        #expect(result?.issues.count == 2)
        #expect(store.all.filter { $0.state.id == done.id }.count >= 2)
        #expect(fannedOut.sorted() == ["i1", "i2"])
    }

    @Test("a refused team bulk edit restores every row it had moved")
    func teamStoreRollsBack() async throws {
        let api = FixturePolarisClient()
        let store = TeamWorkStore(api: api, team: FixtureData.team)
        await store.load()
        let before = store.all
        await api.setFailNextWrite(.offline)

        let result = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: before.map(\.id), stateId: done.id), state: done)
        )

        #expect(result == nil)
        #expect(store.writeError == .offline)
        for original in before {
            #expect(store.all.first { $0.id == original.id }?.state.id == original.state.id)
        }
    }

    /// The hole this closes is not in the product, it is in the test doubles.
    ///
    /// `ParityStoreTests` and `FailuresThatSpeakTests` both hold wrapper clients that forward
    /// the protocol operation by operation to an `inner` fixture. A protocol method with an
    /// extension default still *compiles* in such a wrapper without being written down — and
    /// then answers `.unsupported`, from the default, rather than reaching `inner` at all. A
    /// store under that wrapper would look broken for a reason that has nothing to do with
    /// the store.
    ///
    /// So this asserts the two halves that matter for a wrapper: the bulk write reaches
    /// through to `inner` and really moves the rows, and a wrapper that refuses the bulk
    /// operation specifically refuses *that* rather than the whole client.
    @Test("a bulk edit reaches through a failure-injecting wrapper to the client behind it")
    func bulkReachesThroughAWrapper() async throws {
        let api = BulkRefusingClient()
        let store = IssuesStore(api: api)
        await store.load()

        await api.refuseBulk(with: .rateLimited(retryAfter: nil))
        let refused = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ["i1", "i2"], stateId: done.id), state: done)
        )
        #expect(refused == nil)
        #expect(store.writeError == .rateLimited(retryAfter: nil))
        #expect(store.writeError != .unsupported("bulk edits"),
                "the wrapper forwarded to the protocol's default instead of to its inner client")

        await api.allowBulk()
        let landed = await store.bulkApply(
            BulkIssueEdit(change: BulkIssueChange(ids: ["i1", "i2"], stateId: done.id), state: done)
        )
        #expect(landed?.issues.count == 2)
        // Observed on `inner`, not on the store: proof the write went all the way down
        // rather than being satisfied somewhere in the middle.
        #expect(try await api.innerState(of: "i1") == done.id)
        #expect(await api.bulkCalls == 2)
    }
}

/// A wrapper around the fixture that forwards the whole surface and can refuse the bulk
/// operation alone — the shape the existing suites' doubles have, written out here so the new
/// operation is one somebody has actually threaded through one.
private actor BulkRefusingClient: PolarisAPI {
    private let inner = FixturePolarisClient()
    private var bulkRefusal: PolarisError?
    private(set) var bulkCalls = 0

    func refuseBulk(with error: PolarisError) { bulkRefusal = error }
    func allowBulk() { bulkRefusal = nil }
    func innerState(of id: String) async throws -> String { try await inner.issue(id: id).state.id }

    func bulkUpdateIssues(_ change: BulkIssueChange) async throws -> BulkIssueResult {
        bulkCalls += 1
        if let bulkRefusal { throw bulkRefusal }
        return try await inner.bulkUpdateIssues(change)
    }

    func signInWithDevSession() async throws -> Session { try await inner.signInWithDevSession() }
    func signIn(email: String, password: String) async throws -> Session {
        try await inner.signIn(email: email, password: password)
    }
    func signInWithApple(idToken: String, nonce: String, displayName: String?) async throws -> Session {
        try await inner.signInWithApple(idToken: idToken, nonce: nonce, displayName: displayName)
    }
    func register(email: String, password: String, inviteToken: String?, displayName: String?) async throws -> Session {
        try await inner.register(email: email, password: password, inviteToken: inviteToken, displayName: displayName)
    }
    func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace { try await inner.createWorkspace(draft) }
    func restoreSession() async throws -> Session { try await inner.restoreSession() }
    @discardableResult func signOut() async -> PolarisError? { nil }
    func useWorkspace(id: String) async {}
    func viewer() async throws -> Viewer { try await inner.viewer() }
    func syncVersion() async throws -> Int { try await inner.syncVersion() }
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] {
        try await inner.myIssues(includeCompleted: includeCompleted)
    }
    func issues(teamId: String) async throws -> [PolarisCore.Issue] { try await inner.issues(teamId: teamId) }
    func issue(id: String) async throws -> PolarisCore.Issue { try await inner.issue(id: id) }
    func comments(issueId: String) async throws -> [PolarisCore.Comment] { try await inner.comments(issueId: issueId) }
    func teams() async throws -> [Team] { try await inner.teams() }
    func workflowStates(teamId: String) async throws -> [WorkflowState] { try await inner.workflowStates(teamId: teamId) }
    func users() async throws -> [User] { try await inner.users() }
    func unreadNotificationCount() async throws -> Int { try await inner.unreadNotificationCount() }
    func notifications(includeRead: Bool, includeSnoozed: Bool, first: Int?) async throws -> [PolarisNotification] {
        try await inner.notifications(includeRead: includeRead, includeSnoozed: includeSnoozed, first: first)
    }
    func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults {
        try await inner.search(query: query, teamId: teamId, first: first)
    }
    func createIssue(_ draft: IssueDraft) async throws -> PolarisCore.Issue { try await inner.createIssue(draft) }
    func updateIssue(_ change: IssueChange) async throws -> PolarisCore.Issue { try await inner.updateIssue(change) }
    func createComment(issueId: String, body: String, opId: String) async throws -> PolarisCore.Comment {
        try await inner.createComment(issueId: issueId, body: body, opId: opId)
    }
    func archiveIssue(id: String, archived: Bool, opId: String) async throws {
        try await inner.archiveIssue(id: id, archived: archived, opId: opId)
    }
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification {
        try await inner.markNotificationRead(id: id, read: read)
    }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification {
        try await inner.snoozeNotification(id: id, until: until)
    }
    func deleteNotification(id: String) async throws { try await inner.deleteNotification(id: id) }
}
