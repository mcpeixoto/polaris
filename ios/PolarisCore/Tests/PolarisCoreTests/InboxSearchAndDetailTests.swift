import Foundation
import Testing
@testable import PolarisCore

@MainActor
@Suite("Comment idempotency")
struct CommentIdempotencyTests {
    /// The guarantee `ios/README.md` claims — "every mutation carries `clientId` and `opId`,
    /// so a retry after a timeout replays the original result instead of creating a
    /// duplicate" — was not true for comments: the transport minted the id, so every attempt
    /// at the same comment carried a different one.
    ///
    /// The store holds one id for the life of a draft, so the retry after a refusal is the
    /// same operation rather than a second comment.
    @Test("a retry after a refusal reuses the draft's operation id")
    func retryKeepsOpId() async {
        let api = FixturePolarisClient()
        let issue = FixtureData.baseIssues[0]
        let store = IssueDetailStore(api: api, issue: issue)
        await api.setFailNextWrite(.timedOut)

        #expect(await store.postComment("the reconnect drops it") == false)
        #expect(store.commentError == .timedOut)

        // The reader presses send again on the same draft.
        #expect(await store.postComment("the reconnect drops it") == true)

        let stored = await api.storedComments[issue.id] ?? []
        #expect(stored.count == 1, "the retry posted a second comment")
    }

    @Test("a new draft is a new operation")
    func newDraftIsNewOperation() async {
        let api = FixturePolarisClient()
        let issue = FixtureData.baseIssues[0]
        let store = IssueDetailStore(api: api, issue: issue)

        #expect(await store.postComment("first") == true)
        #expect(await store.postComment("second") == true)

        let stored = await api.storedComments[issue.id] ?? []
        #expect(stored.count == 2)
    }
}

@MainActor
@Suite("Detail load errors")
struct DetailLoadErrorTests {
    /// `try?` flattened both branches: an offline load of a deep-linked issue read "That's not
    /// here any more." — the one sentence guaranteed to be wrong — and `.notFound` is not
    /// retryable, so it also removed the button that would have fixed it.
    @Test("an offline load says offline, not not-found")
    func offlineIsNotNotFound() async {
        let store = IssueDetailStore(api: RefusingReads(error: .offline), issueID: "i1")
        await store.load()

        #expect(store.issue.error == .offline)
        #expect(store.comments.error == .offline)
        #expect(store.issue.error?.isRetryable == true)
    }

    @Test("a genuinely missing issue still says so")
    func missingIssueIsNotFound() async {
        let store = IssueDetailStore(api: FixturePolarisClient(), issueID: "does-not-exist")
        await store.load()

        #expect(store.issue.error == .notFound)
    }

    /// The rule the list already had: a failed refresh must not blank what somebody is
    /// reading.
    @Test("a failed refresh keeps the issue that is already on screen")
    func failedRefreshKeepsContent() async {
        let seeded = FixtureData.baseIssues[0]
        let store = IssueDetailStore(api: RefusingReads(error: .offline), issue: seeded)
        await store.load()

        #expect(store.issue.value?.id == seeded.id)
    }
}

@MainActor
@Suite("Inbox")
struct InboxStoreTests {
    @Test("unread count follows the list")
    func unreadCount() async {
        let store = InboxStore(api: FixturePolarisClient())
        await store.load()

        let rows = store.notifications.value ?? []
        #expect(rows.count == 3)
        #expect(store.unreadCount == rows.filter { !$0.isRead }.count)
        #expect(store.unreadCount == 2)
    }

    @Test("marking read is optimistic and lands")
    func markRead() async {
        let store = InboxStore(api: FixturePolarisClient())
        await store.load()
        let unread = try! #require(store.notifications.value?.first { !$0.isRead })

        await store.markRead(unread)

        let updated = store.notifications.value?.first { $0.id == unread.id }
        #expect(updated?.isRead == true)
        #expect(store.unreadCount == 1)
    }

    /// A refused delete must put the row back *where it was*. Appending it would read as a
    /// new notification arriving, which is a stranger bug than the failure it followed.
    @Test("a refused delete restores the row in its old place")
    func refusedDeleteRestoresPosition() async {
        let api = FixturePolarisClient()
        let store = InboxStore(api: api)
        await store.load()
        let before = try! #require(store.notifications.value)
        let victim = before[1]
        await api.setFailNextWrite(.server(status: 500, message: nil))

        await store.delete(victim)

        let after = try! #require(store.notifications.value)
        #expect(after.map(\.id) == before.map(\.id))
        #expect(store.actionError == .server(status: 500, message: nil))
    }

    @Test("marking everything read leaves nothing unread")
    func markAllRead() async {
        let store = InboxStore(api: FixturePolarisClient())
        await store.load()

        await store.markAllRead()

        #expect(store.unreadCount == 0)
        #expect(store.notifications.value?.allSatisfy(\.isRead) == true)
    }
}

@MainActor
@Suite("Search")
struct SearchStoreTests {
    /// Zero debounce, because the wait is the store's own contract and not what these are
    /// about; the debounce itself is exercised by the cancellation test below.
    private let immediate = Duration.milliseconds(0)

    @Test("an empty field is idle, not an empty result set")
    func emptyIsIdle() async {
        let store = SearchStore(api: FixturePolarisClient())
        await store.submit("sync")
        #expect(store.results.value?.issues.isEmpty == false)

        store.query("", debounce: immediate)

        // "No results for ''" is a sentence nobody typed a query to see.
        #expect(store.results.value == nil)
        #expect(store.lastQuery.isEmpty)
    }

    @Test("a query narrows the list and remembers what it searched for")
    func narrows() async {
        let store = SearchStore(api: FixturePolarisClient())
        await store.submit("exporter")

        let found = try! #require(store.results.value)
        #expect(found.issues.count == 1)
        #expect(found.issues.first?.title.contains("exporter") == true)
        #expect(store.lastQuery == "exporter")
    }

    @Test("a query that matches nothing is a loaded empty result, not a failure")
    func noMatches() async {
        let store = SearchStore(api: FixturePolarisClient())
        await store.submit("zzzzz")

        #expect(store.results.value?.issues.isEmpty == true)
        #expect(store.results.error == nil)
    }

    /// A keystroke cancels the pending request. Without it a `.searchable` field fires one
    /// query per character, and the answer to "sync" can arrive after the answer to "syncing"
    /// and overwrite it.
    @Test("a second keystroke cancels the first request")
    func debounceCancels() async {
        let store = SearchStore(api: FixturePolarisClient())
        store.query("sync", debounce: .milliseconds(200))
        store.query("exporter", debounce: .milliseconds(10))
        try? await Task.sleep(for: .milliseconds(400))

        #expect(store.lastQuery == "exporter")
        #expect(store.results.value?.issues.first?.title.contains("exporter") == true)
    }
}

@MainActor
@Suite("Team issues")
struct TeamIssuesStoreTests {
    @Test("a team's list is ordered exactly like every other issue list")
    func ordering() async {
        let store = TeamIssuesStore(api: FixturePolarisClient(), team: FixtureData.team)
        await store.load()

        let list = try! #require(store.issues.value)
        #expect(list == IssueOrder.sorted(list))
        #expect(list.first?.priority == Priority.urgent)
    }

    @Test("a refused status change rolls the row back")
    func rollback() async {
        let api = FixturePolarisClient()
        let store = TeamIssuesStore(api: api, team: FixtureData.team)
        await store.load()
        let target = try! #require(store.issues.value?.first)
        let original = target.state
        await api.setFailNextWrite(.forbidden)

        await store.setState(issueID: target.id, to: FixtureData.states[3])

        let after = store.issues.value?.first { $0.id == target.id }
        #expect(after?.state.id == original.id)
    }
}

@MainActor
@Suite("Reference data")
struct WorkspaceDataStoreTests {
    /// `statesFailedForTeam` drives a user-visible branch on the detail screen — the
    /// difference between "this team has no statuses" and "that request failed, try again" —
    /// and nothing asserted it.
    @Test("a team whose states could not be fetched is distinguished from one that has none")
    func perTeamFailure() async {
        let store = WorkspaceDataStore(api: StatesRefusingClient())
        await store.load()

        #expect(store.teams.value?.isEmpty == false)
        #expect(store.statesFailedForTeam.contains(FixtureData.team.id))
        #expect(store.states(forTeam: FixtureData.team.id).isEmpty)
    }

    @Test("a healthy load records no failures")
    func healthyLoad() async {
        let store = WorkspaceDataStore(api: FixturePolarisClient())
        await store.load()

        #expect(store.statesFailedForTeam.isEmpty)
        #expect(store.states(forTeam: FixtureData.team.id).isEmpty == false)
        #expect(store.user(id: "u1")?.displayName == "Miguel Peixoto")
    }
}

// MARK: - Doubles

/// Fails every read with one error, and forwards everything else. Narrower than the general
/// refusing client: these tests are about what a *screen* says when a read fails.
private actor RefusingReads: PolarisAPI {
    private let error: PolarisError
    private let inner = FixturePolarisClient()

    init(error: PolarisError) { self.error = error }

    func signInWithDevSession() async throws -> Session { throw error }
    func signIn(email: String, password: String) async throws -> Session { throw error }
    func signInWithApple(idToken: String, nonce: String, displayName: String?) async throws -> Session { throw error }
    func register(email: String, password: String, inviteToken: String?, displayName: String?) async throws -> Session { throw error }
    func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace { throw error }
    func restoreSession() async throws -> Session { throw error }
    @discardableResult func signOut() async -> PolarisError? { nil }
    func useWorkspace(id: String) async {}

    func viewer() async throws -> Viewer { throw error }
    func syncVersion() async throws -> Int { throw error }
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] { throw error }
    func issues(teamId: String) async throws -> [PolarisCore.Issue] { throw error }
    func issue(id: String) async throws -> PolarisCore.Issue { throw error }
    func comments(issueId: String) async throws -> [PolarisCore.Comment] { throw error }
    func teams() async throws -> [Team] { throw error }
    func workflowStates(teamId: String) async throws -> [WorkflowState] { throw error }
    func users() async throws -> [User] { throw error }
    func unreadNotificationCount() async throws -> Int { throw error }
    func notifications(includeRead: Bool, includeSnoozed: Bool, first: Int?) async throws -> [PolarisNotification] { throw error }
    func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults { throw error }

    func createIssue(_ draft: IssueDraft) async throws -> PolarisCore.Issue { throw error }
    func updateIssue(_ change: IssueChange) async throws -> PolarisCore.Issue { throw error }
    func createComment(issueId: String, body: String, opId: String) async throws -> PolarisCore.Comment { throw error }
    func archiveIssue(id: String, archived: Bool, opId: String) async throws { throw error }
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification { throw error }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification { throw error }
    func deleteNotification(id: String) async throws { throw error }
}

/// Answers everything except `workflowStates`, which is the one per-team call that can fail
/// on its own.
private actor StatesRefusingClient: PolarisAPI {
    private let inner = FixturePolarisClient()

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
    func workflowStates(teamId: String) async throws -> [WorkflowState] { throw PolarisError.offline }
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
