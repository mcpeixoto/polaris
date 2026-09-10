import Foundation
import Testing

@testable import PolarisCore

/// A write the reader asked for either happens or says why. It never quietly does nothing.
///
/// Every case here was a tap that looked exactly like a tap that missed: the row did not
/// move, no request went out, and nothing appeared to explain it. The three families are the
/// one bug wearing three coats — an early `return` in a mutating method with no observable
/// difference from success.
@MainActor
@Suite("Writes that land")
struct WritesReachTheServerTests {
    /// The original: `SearchView` routed a result row's status change to `IssuesStore`, whose
    /// list is the reader's own issues and almost never a thing they have just searched for,
    /// so the guard at the top of `setState` swallowed it.
    @Test("a status change on a search result is written")
    func searchResultWriteIsSent() async {
        let api = ScriptedClient()
        let store = SearchStore(api: api)
        await store.submit("Sync")
        let target = try! #require(store.results.value?.issues.first)

        await store.setState(issueID: target.id, to: FixtureData.states[3])

        #expect(await api.updates.map(\.id) == [target.id])
        #expect(store.results.value?.issues.first { $0.id == target.id }?.state.category == .completed)
        #expect(store.writeError == nil)
        #expect(store.pendingIssueIDs.isEmpty)
    }

    @Test("a refused search write rolls the row back and says why")
    func searchResultWriteRefused() async {
        let api = ScriptedClient()
        await api.refuseWrites(.forbidden)
        let store = SearchStore(api: api)
        await store.submit("Sync")
        let target = try! #require(store.results.value?.issues.first)

        await store.setState(issueID: target.id, to: FixtureData.states[3])

        #expect(store.results.value?.issues.first { $0.id == target.id }?.state.id == target.state.id)
        #expect(store.writeError == .forbidden)
    }

    /// The guard is still wrong even with the routing fixed: a caller that reaches the wrong
    /// store must not have its write eaten. Performed rather than refused, because the reader
    /// asked for a status change and which list they asked from is not the server's business.
    @Test("a list asked about a row it does not hold sends the write anyway")
    func unheldWriteIsSent() async {
        let api = ScriptedClient()
        let store = IssuesStore(api: api)
        await store.load()
        // A sub-issue: reachable from the detail screen, never in the issue list.
        let stranger = FixtureData.children[0]
        #expect(store.issues.value?.contains { $0.id == stranger.id } == false)

        await store.setState(issueID: stranger.id, to: FixtureData.states[3])

        #expect(await api.updates.map(\.id) == [stranger.id])
        #expect(store.writeError == nil)
        #expect(store.pendingIssueIDs.isEmpty)
    }

    @Test("and reports it when the server refuses, instead of dropping it")
    func unheldWriteRefused() async {
        let api = ScriptedClient()
        await api.refuseWrites(.offline)
        let store = IssuesStore(api: api)
        await store.load()

        await store.setState(issueID: FixtureData.children[0].id, to: FixtureData.states[3])

        #expect(store.writeError == .offline)
    }

    @Test("a team list does the same with a row that is not in it")
    func unheldTeamWriteIsSent() async {
        let api = ScriptedClient()
        let store = TeamWorkStore(api: api, team: FixtureData.team)
        await store.load()

        await store.setState(issueID: FixtureData.children[0].id, to: FixtureData.states[3])

        #expect(await api.updates.map(\.id) == [FixtureData.children[0].id])
        #expect(store.writeError == nil)
    }
}

/// One write, every store that holds the issue.
///
/// There is no local replica, so the same row lives in several stores at once and none of
/// them knows the others exist. Before `AppModel.issueDidChange` each screen told the two or
/// three it happened to remember — the detail screen told My Issues and nobody else — so a
/// status set from a team, project, cycle or search row was stale the moment the reader went
/// back, and stayed stale: `refreshIfStale` short-circuits on a version this client moved.
@MainActor
@Suite("A confirmed write reaches every store holding the issue")
struct WriteFanOutTests {
    @Test("a detail write reaches the lists behind it")
    func detailWriteReachesTheLists() async {
        let api = ScriptedClient()
        let model = AppModel(environment: .localDevelopment, api: api, socketConnector: nil)
        await model.issues.load()

        let team = TeamWorkStore(api: api, team: FixtureData.team)
        await team.load()
        model.adoptIssueWrites(team)

        let search = SearchStore(api: api)
        await search.submit("Sync")
        model.adoptIssueWrites(search)

        let target = try! #require(model.issues.value(for: "i1"))
        let detail = IssueDetailStore(api: api, issue: target) { updated in
            model.issueDidChange(updated)
        }

        await detail.setState(FixtureData.states[3])

        #expect(model.issues.value(for: "i1")?.state.category == .completed)
        #expect(team.all.first { $0.id == "i1" }?.state.category == .completed)
        #expect(search.results.value?.issues.first { $0.id == "i1" }?.state.category == .completed)
    }

    /// And the other way: the detail screen is open over the list that wrote.
    @Test("a list write reaches the detail screen above it")
    func listWriteReachesTheDetailScreen() async {
        let api = ScriptedClient()
        let model = AppModel(environment: .localDevelopment, api: api, socketConnector: nil)
        await model.issues.load()
        let target = try! #require(model.issues.value(for: "i1"))
        let detail = IssueDetailStore(api: api, issue: target)
        model.observeIssueWrites(detail)

        await model.issues.setState(issueID: "i1", to: FixtureData.states[3])

        #expect(detail.issue.value?.state.category == .completed)
    }

    /// Only the server's answer is fanned out. Pushing the optimistic value would leave every
    /// other store showing a status the server rejected, and none of them has the original to
    /// roll back to.
    @Test("a refused write poisons nobody")
    func refusedWriteIsNotFannedOut() async {
        let api = ScriptedClient()
        await api.refuseWrites(.forbidden)
        let model = AppModel(environment: .localDevelopment, api: api, socketConnector: nil)
        await model.issues.load()
        let target = try! #require(model.issues.value(for: "i1"))
        let before = target.state.id

        let team = TeamWorkStore(api: api, team: FixtureData.team)
        await team.load()
        model.adoptIssueWrites(team)

        let detail = IssueDetailStore(api: api, issue: target) { updated in
            model.issueDidChange(updated)
        }
        await detail.setState(FixtureData.states[3])

        #expect(detail.propertyError == .forbidden)
        #expect(model.issues.value(for: "i1")?.state.id == before)
        #expect(team.all.first { $0.id == "i1" }?.state.id == before)
    }

    /// Registration must not be what keeps a popped screen's store alive.
    @Test("a store that went away is not held on to")
    func observersAreWeak() async {
        let model = AppModel(environment: .localDevelopment, api: ScriptedClient(), socketConnector: nil)
        weak var observer: TeamWorkStore?
        do {
            let store = TeamWorkStore(api: ScriptedClient(), team: FixtureData.team)
            model.observeIssueWrites(store)
            observer = store
            #expect(observer != nil)
        }
        #expect(observer == nil)
    }

    @Test("registering the same store twice registers it once")
    func registrationIsIdempotent() async {
        let api = ScriptedClient()
        let model = AppModel(environment: .localDevelopment, api: api, socketConnector: nil)
        await model.issues.load()
        let team = TeamWorkStore(api: api, team: FixtureData.team)
        await team.load()
        model.observeIssueWrites(team)
        model.observeIssueWrites(team)

        let target = try! #require(model.issues.value(for: "i1"))
        var seen = 0
        // Counted through the store's own merge, which is the only observable side of the
        // fan-out: a second registration would run it twice.
        let counting = CountingMerger { seen += 1 }
        model.observeIssueWrites(counting)
        model.observeIssueWrites(counting)
        model.issueDidChange(target)

        #expect(seen == 1)
    }
}

/// The Inbox's "mark all read".
@MainActor
@Suite("Marking a whole inbox read")
struct MarkAllReadTests {
    /// The toolbar button is enabled off `unreadCount`, which the poll sets from the server
    /// without the list ever having loaded. So on a cold Inbox tab the button was live, the
    /// tap played its success haptic, and the guard at the top of `markAllRead` returned
    /// before anything happened.
    @Test("an inbox that never loaded is fetched and then marked")
    func coldInboxIsLoadedFirst() async {
        let store = InboxStore(api: ScriptedClient())
        await store.refreshBadge()
        #expect(store.unreadCount > 0)
        #expect(store.notifications.value == nil)

        let marked = await store.markAllRead()

        #expect(marked)
        #expect(store.unreadCount == 0)
        #expect(store.notifications.value?.allSatisfy(\.isRead) == true)
    }

    @Test("an inbox that cannot be fetched says so instead of claiming success")
    func unfetchableInboxReportsTheFailure() async {
        let api = ScriptedClient()
        await api.refuseNotificationList(.offline)
        let store = InboxStore(api: api)
        await store.refreshBadge()

        let marked = await store.markAllRead()

        #expect(marked == false)
        #expect(store.actionError == .offline)
        #expect(store.unreadCount > 0)
    }

    @Test("a refused row leaves the inbox showing what the server holds")
    func refusedRowReloads() async {
        let api = ScriptedClient()
        let store = InboxStore(api: api)
        await store.load()
        await api.refuseWrites(.server(status: 500, message: nil))

        let marked = await store.markAllRead()

        #expect(marked == false)
        #expect(store.actionError == .server(status: 500, message: nil))
        // Reloaded rather than left optimistic: this client cannot say which of the rows it
        // sent one at a time landed before the failure.
        #expect(store.notifications.value?.contains { !$0.isRead } == true)
    }
}

/// The same defect on the detail screen: a write refused by a guard on data it did not need.
@MainActor
@Suite("Writes that do not need the detail to have arrived")
struct DetailWritesWithoutDetailTests {
    /// The link sheet took the URL, dismissed, and posted nothing. `detail` had not arrived —
    /// which is only where the card would have been *shown*, not what the write needs.
    @Test("a link is sent before the detail it would appear in has loaded")
    func linkWithoutDetail() async {
        let store = IssueDetailStore(api: ScriptedClient(), issue: FixtureData.baseIssues[0])
        #expect(store.detail.value == nil)

        let landed = await store.addLink(url: "https://example.com/incident-41", title: nil)

        #expect(landed)
        #expect(store.propertyError == nil)
    }

    @Test("a refused link is still reported")
    func refusedLinkSaysWhy() async {
        let api = ScriptedClient()
        await api.refuseWrites(.forbidden)
        let store = IssueDetailStore(api: api, issue: FixtureData.baseIssues[0])

        let landed = await store.addLink(url: "https://example.com/incident-41", title: nil)

        #expect(landed == false)
        #expect(store.propertyError == .forbidden)
    }

    @Test("and a sub-issue is filed the same way")
    func subIssueWithoutDetail() async {
        let store = IssueDetailStore(api: ScriptedClient(), issue: FixtureData.baseIssues[0])

        let landed = await store.createSubIssue(title: "Replay the outbox")

        #expect(landed)
        #expect(store.propertyError == nil)
    }
}

// MARK: - Doubles

/// A merge target that only counts, for asserting how many times the fan-out ran.
@MainActor
private final class CountingMerger: IssueMerging {
    private let onMerge: () -> Void
    init(_ onMerge: @escaping () -> Void) { self.onMerge = onMerge }
    func merge(_ updated: PolarisCore.Issue) { onMerge() }
}

private extension IssuesStore {
    func value(for id: String) -> PolarisCore.Issue? { issues.value?.first { $0.id == id } }
}

/// The fixture client with two knobs: refuse every write, and refuse the inbox list.
///
/// `FixturePolarisClient.setFailNextWrite` arms exactly one failure, which is the wrong shape
/// for a loop that sends one mutation per unread row. Recording the changes is the other half:
/// "the row did not move" and "no request went out" are different bugs, and only the second
/// one is what these tests are about.
private actor ScriptedClient: PolarisAPI {
    private(set) var updates: [IssueChange] = []
    private var writeRefusal: PolarisError?
    private var listRefusal: PolarisError?
    private let inner = FixturePolarisClient()

    func refuseWrites(_ error: PolarisError?) { writeRefusal = error }
    func refuseNotificationList(_ error: PolarisError?) { listRefusal = error }

    func updateIssue(_ change: IssueChange) async throws -> PolarisCore.Issue {
        updates.append(change)
        if let writeRefusal { throw writeRefusal }
        return try await inner.updateIssue(change)
    }

    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification {
        if let writeRefusal { throw writeRefusal }
        return try await inner.markNotificationRead(id: id, read: read)
    }

    func notifications(includeRead: Bool, includeSnoozed: Bool, first: Int?) async throws -> [PolarisNotification] {
        if let listRefusal { throw listRefusal }
        return try await inner.notifications(
            includeRead: includeRead, includeSnoozed: includeSnoozed, first: first
        )
    }

    // The rest is forwarded untouched.
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
    func issueDetail(id: String) async throws -> IssueDetail { try await inner.issueDetail(id: id) }
    func comments(issueId: String) async throws -> [PolarisCore.Comment] { try await inner.comments(issueId: issueId) }
    func teams() async throws -> [Team] { try await inner.teams() }
    func workflowStates(teamId: String) async throws -> [WorkflowState] {
        try await inner.workflowStates(teamId: teamId)
    }
    func users() async throws -> [User] { try await inner.users() }
    func cycles(teamId: String) async throws -> [Cycle] { try await inner.cycles(teamId: teamId) }
    func unreadNotificationCount() async throws -> Int { try await inner.unreadNotificationCount() }
    func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults {
        try await inner.search(query: query, teamId: teamId, first: first)
    }
    func createIssue(_ draft: IssueDraft) async throws -> PolarisCore.Issue {
        if let writeRefusal { throw writeRefusal }
        return try await inner.createIssue(draft)
    }
    func createAttachment(issueId: String, url: String, title: String?, opId: String) async throws -> PolarisCore.Attachment {
        if let writeRefusal { throw writeRefusal }
        return try await inner.createAttachment(issueId: issueId, url: url, title: title, opId: opId)
    }
    func createComment(issueId: String, body: String, opId: String) async throws -> PolarisCore.Comment {
        try await inner.createComment(issueId: issueId, body: body, opId: opId)
    }
    func archiveIssue(id: String, archived: Bool, opId: String) async throws {
        try await inner.archiveIssue(id: id, archived: archived, opId: opId)
    }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification {
        try await inner.snoozeNotification(id: id, until: until)
    }
    func deleteNotification(id: String) async throws { try await inner.deleteNotification(id: id) }
}
