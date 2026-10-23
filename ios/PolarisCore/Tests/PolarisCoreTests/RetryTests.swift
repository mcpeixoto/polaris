import Foundation
import Testing
@testable import PolarisCore

/// What has to be true before a Retry button is worth drawing.
///
/// The server keys idempotency on `(clientId, opId)` — `services/internal/domain/
/// idempotency.go`, with a 24-hour TTL — so a second attempt is only a replay when both halves
/// of that pair survive. Neither did. `clientId` was minted per process, and nothing in the
/// client ever retried: `IssueChange`'s `opId` default minted a fresh id on every call, so even
/// a deliberate second tap was a second operation. These assert both halves, and that the
/// failures a retry cannot fix are not offered one.
@MainActor
struct RetryTests {
    /// The four fixture issues are on one team with one set of states, so `s4` — Done — is a
    /// legitimate target for all of them.
    private var done: WorkflowState { FixtureData.states[3] }

    private func started(_ store: IssuesStore) throws -> PolarisCore.Issue {
        try #require(store.issues.value?.first { $0.state.category == .started })
    }

    // MARK: - The same operation, not a second one

    @Test("a retry sends the opId the first attempt used, and the write applies once")
    func retryKeepsOpId() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        let target = try started(store)

        await api.setFailNextWrite(.timedOut)
        await store.setState(issueID: target.id, to: done)
        let first = try #require(store.pendingWrite)
        #expect(first.isRetryable)
        #expect(first.operation.issueIDs == [target.id])
        #expect(await api.issueWritesApplied == 0, "the refused attempt reached the store")

        // A retry that fails too: the point is the id it carried, which must be the first
        // attempt's. A fresh one here is the duplicate-write bug, just deferred.
        await api.setFailNextWrite(.timedOut)
        await store.retryLastWrite()
        #expect(store.pendingWrite?.opId == first.opId)

        await store.retryLastWrite()

        #expect(store.pendingWrite == nil)
        #expect(store.writeError == nil)
        #expect(store.issues.value?.first { $0.id == target.id }?.state.id == done.id)
        // One result, not two. The double is idempotent on `opId` like the server, and this
        // counter is how "replayed" is told from "applied a second time".
        #expect(await api.issueWritesApplied == 1)
    }

    @Test("a retried bulk edit applies once, under the opId it started with")
    func bulkRetryAppliesOnce() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        let edit = BulkIssueEdit(
            change: BulkIssueChange(ids: ["i1", "i2"], stateId: done.id), state: done
        )

        await api.setFailNextWrite(.offline)
        #expect(await store.bulkApply(edit) == nil)
        #expect(store.pendingWrite?.opId == edit.change.opId)
        #expect(await api.bulkWritesApplied == 0)

        await store.retryLastWrite()

        #expect(store.pendingWrite == nil)
        #expect(await api.bulkWritesApplied == 1)
        // And the same operation a third time is a replay the server answers from its own
        // record, rather than a batch that moves the selection twice.
        _ = await store.bulkApply(edit)
        #expect(await api.bulkWritesApplied == 1)
    }

    @Test("a search result row and a team list retry their own write")
    func searchAndTeamRetry() async throws {
        let searchApi = FixturePolarisClient()
        let search = SearchStore(api: searchApi)
        await search.submit("sync")
        let hit = try #require(search.results.value?.issues.first)
        await searchApi.setFailNextWrite(.serverUnreachable)
        await search.setState(issueID: hit.id, to: done)
        let searchPending = try #require(search.pendingWrite)

        await search.retryLastWrite()

        #expect(search.pendingWrite == nil)
        #expect(search.results.value?.issues.first { $0.id == hit.id }?.state.id == done.id)
        #expect(await searchApi.issueWritesApplied == 1)
        #expect(searchPending.opId == searchPending.operation.opId)

        let teamApi = FixturePolarisClient()
        let team = TeamWorkStore(api: teamApi, team: FixtureData.team)
        await team.load()
        let row = try #require(team.all.first)
        await teamApi.setFailNextWrite(.rateLimited(retryAfter: nil))
        await team.setState(issueID: row.id, to: done)
        let teamPending = try #require(team.pendingWrite)

        await team.retryLastWrite()

        #expect(team.pendingWrite == nil)
        #expect(team.writeError == nil)
        #expect(team.all.first { $0.id == row.id }?.state.id == done.id)
        #expect(await teamApi.issueWritesApplied == 1)
        #expect(teamPending.isRetryable)
    }

    @Test("the detail screen retries a property write and a comment under their own ids")
    func detailRetry() async throws {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.baseIssues[0], viewerId: "u1")
        await store.load()

        await api.setFailNextWrite(.timedOut)
        await store.setPriority(.urgent)
        let property = try #require(store.pendingWrite)
        #expect(property.isRetryable)

        await store.retryLastWrite()

        #expect(store.pendingWrite == nil)
        #expect(store.propertyError == nil)
        #expect(store.issue.value?.priority == .urgent)
        #expect(await api.issueWritesApplied == 1)

        await api.setFailNextWrite(.offline)
        #expect(await store.postComment("the reconnect drops it") == false)
        let comment = try #require(store.pendingWrite)
        #expect(comment.operation == .comment(
            issueId: FixtureData.baseIssues[0].id,
            body: "the reconnect drops it",
            opId: comment.opId
        ))

        await store.retryLastWrite()

        #expect(store.pendingWrite == nil)
        #expect(store.commentError == nil)
        let stored = await api.storedComments[FixtureData.baseIssues[0].id] ?? []
        #expect(stored.filter { $0.body == "the reconnect drops it" }.count == 1)
    }

    // MARK: - A refusal is not offered a button

    @Test("a refused write rolls back and offers no retry")
    func refusalOffersNoRetry() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        let target = try started(store)
        let before = target.state

        await api.setFailNextWrite(.forbidden)
        await store.setState(issueID: target.id, to: done)

        #expect(store.issues.value?.first { $0.id == target.id }?.state.id == before.id)
        let pending = try #require(store.pendingWrite)
        #expect(pending.failure == .forbidden)
        #expect(!pending.isRetryable, "a button for a refusal is a button that lies")

        // No screen draws it, and the method refuses anyway rather than relying on that.
        await store.retryLastWrite()
        #expect(await api.issueWritesApplied == 0)
        #expect(store.issues.value?.first { $0.id == target.id }?.state.id == before.id)
    }

    @Test("a validation error on a comment offers no retry either")
    func validationOffersNoRetry() async throws {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.baseIssues[1], viewerId: "u1")
        await store.load()
        await api.setFailNextWrite(.validation(message: "Comment is too long", field: "body"))

        #expect(await store.postComment("far too much") == false)

        let pending = try #require(store.pendingWrite)
        #expect(!pending.isRetryable)
        await store.retryLastWrite()
        let stored = await api.storedComments[FixtureData.baseIssues[1].id] ?? []
        #expect(stored.contains { $0.body == "far too much" } == false)
    }

    // MARK: - Already landed, by another route

    @Test("a retry after the confirmed value arrived by another route is a no-op")
    func confirmedElsewhereIsANoOp() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        let target = try started(store)

        await api.setFailNextWrite(.timedOut)
        await store.setState(issueID: target.id, to: done)
        #expect(store.pendingWrite?.isRetryable == true)

        // The same row, confirmed, from a store that holds it too — what
        // `AppModel.issueDidChange` fans out, or what a refetch on a sync signal brings back.
        var confirmed = target
        confirmed.state = done
        store.merge(confirmed)

        #expect(store.pendingWrite == nil, "the write it was holding had already landed")
        #expect(store.writeError == nil)

        await store.retryLastWrite()

        #expect(await api.issueWritesApplied == 0, "a retry went out for a value already in place")
    }

    @Test("a confirmed value that is not what was asked for leaves the retry standing")
    func anUnrelatedConfirmationKeepsThePendingWrite() async throws {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        let target = try started(store)

        await api.setFailNextWrite(.timedOut)
        await store.setState(issueID: target.id, to: done)

        // The row moved, but not to the state this write asked for: somebody else changed it
        // to something else entirely. The reader's own write still has not landed.
        var confirmed = target
        confirmed.state = FixtureData.states[1]
        store.merge(confirmed)

        #expect(store.pendingWrite?.isRetryable == true)
    }
}

/// The install's `clientId`, which is the other half of the pair the server keys on.
@Suite("The install's client id", .serialized)
struct ClientIdentityTests {
    private static let environment = PolarisEnvironment(
        apiBaseURL: URL(string: "https://polaris.test")!,
        allowsDevSession: false
    )

    private func emptyDefaults() -> UserDefaults {
        let name = "polaris.clientid.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test("it is minted once and then read back, not minted again")
    func mintedOnce() {
        let defaults = emptyDefaults()

        let first = ClientIdentity.current(defaults: defaults)

        #expect(!first.isEmpty)
        #expect(ClientIdentity.current(defaults: defaults) == first)
        #expect(defaults.string(forKey: ClientIdentity.storageKey) == first)
    }

    /// The bug this closes. A relaunch used to mint a new `clientId`, so a retry carrying the
    /// original `opId` presented a pair the server had never seen — and applied the write a
    /// second time.
    @Test("a client rebuilt over the same defaults sends the clientId the first one did")
    func survivesARebuild() async throws {
        let defaults = emptyDefaults()
        ClientIdStubURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ClientIdStubURLProtocol.self]

        func client() -> LivePolarisClient {
            LivePolarisClient(
                environment: Self.environment,
                urlSession: URLSession(configuration: configuration),
                clientId: ClientIdentity.current(defaults: defaults)
            )
        }

        // Two clients over one stored id: the second stands for the process after a relaunch,
        // retrying the operation the first one started.
        try await client().deleteIssue(id: "i1", opId: "op-1")
        try await client().deleteIssue(id: "i1", opId: "op-1")

        let sent = ClientIdStubURLProtocol.clientIds
        #expect(sent.count == 2)
        #expect(sent.first == sent.last, "the retry presented a different clientId")
        #expect(sent.first == defaults.string(forKey: ClientIdentity.storageKey))
        #expect(sent.first?.isEmpty == false)
    }
}

/// Records the `clientId` on every mutation, and answers the smallest one in the schema —
/// `deleteIssue`, whose payload is `{version id}`. The operation is immaterial here; every
/// mutation carries the same `clientId`, and this is the one that needs no issue JSON.
final class ClientIdStubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) private static var seen: [String] = []
    private static let lock = NSLock()

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        seen = []
    }

    static var clientIds: [String] {
        lock.lock(); defer { lock.unlock() }
        return seen
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    /// URLSession turns `httpBody` into a stream by the time a protocol sees it, so both
    /// shapes have to be read.
    private static func body(of request: URLRequest) -> Data? {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var collected = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            collected.append(contentsOf: buffer[0..<read])
        }
        return collected
    }

    override func startLoading() {
        let path = request.url?.path ?? ""
        if let data = Self.body(of: request),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let variables = json["variables"] as? [String: Any],
           let clientId = variables["clientId"] as? String {
            Self.lock.lock()
            Self.seen.append(clientId)
            Self.lock.unlock()
        }

        let payload = path.hasSuffix("/auth/refresh")
            ? """
              {"accessToken":"tok","expiresIn":900,"accountId":"a1",
               "workspaces":[{"id":"w1","name":"Test","urlKey":"test","plan":"free"}]}
              """
            : #"{"data":{"deleteIssue":{"version":1,"id":"i1"}}}"#

        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://polaris.test")!,
            statusCode: 200,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(payload.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
