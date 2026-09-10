import Foundation
import Testing

@testable import PolarisCore

/// What a status control is allowed to believe, and what it says when a write is refused.
///
/// Both of these were bugs a reader felt as "I can't change the status": the picker rendered
/// "no statuses in this team" for a team nobody had asked about yet, and a refused change was
/// a row that silently snapped back.
@MainActor
@Suite("Status controls")
struct StatusAvailabilityTests {
    @Test("a team nobody has asked about is unknown, not empty")
    func unknownIsNotEmpty() async {
        let store = WorkspaceDataStore(api: FixturePolarisClient())

        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .unknown)
        #expect(store.states(forTeam: FixtureData.team.id).isEmpty)
    }

    /// The cold-start case. `load()` runs once, at sign-in; a screen opened before it lands —
    /// or on a launch where it failed — used to show a dead picker for the rest of the
    /// session, because nothing ever asked again.
    @Test("a status control can fetch the states it needs without a full load")
    func ensureFetchesOnDemand() async {
        let store = WorkspaceDataStore(api: FixturePolarisClient())

        await store.ensureStates(forTeam: FixtureData.team.id)

        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .loaded)
        #expect(store.states(forTeam: FixtureData.team.id).isEmpty == false)
    }

    @Test("states already held are not fetched twice")
    func ensureIsIdempotent() async {
        let api = CountingStatesClient()
        let store = WorkspaceDataStore(api: api)

        await store.ensureStates(forTeam: FixtureData.team.id)
        await store.ensureStates(forTeam: FixtureData.team.id)

        #expect(await api.stateRequests == 1)
    }

    @Test("a refused fetch reads as failed, and retrying recovers")
    func failureIsRetryable() async {
        let api = CountingStatesClient()
        await api.setRefusing(true)
        let store = WorkspaceDataStore(api: api)

        await store.ensureStates(forTeam: FixtureData.team.id)
        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .failed)
        #expect(store.statesFailedForTeam.contains(FixtureData.team.id))

        await api.setRefusing(false)
        await store.reloadStates(forTeam: FixtureData.team.id)

        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .loaded)
        #expect(store.statesFailedForTeam.isEmpty)
        #expect(store.states(forTeam: FixtureData.team.id).isEmpty == false)
    }

    /// The one case where "no statuses in this team" is the truth. It is only sayable once the
    /// server has answered.
    @Test("a team that really has none reads as loaded and empty")
    func genuinelyEmpty() async {
        let store = WorkspaceDataStore(api: NoStatesClient())

        await store.ensureStates(forTeam: FixtureData.team.id)

        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .loaded)
        #expect(store.states(forTeam: FixtureData.team.id).isEmpty)
        #expect(store.statesFailedForTeam.isEmpty)
    }

    @Test("a bulk load records what it learned about every team")
    func loadRecordsAvailability() async {
        let store = WorkspaceDataStore(api: FixturePolarisClient())

        await store.load()

        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .loaded)
    }

    /// The bootstrap fetch runs once, after sign-in. When it failed, nothing ever ran it
    /// again and the session had no teams, no people and no statuses until the app was killed.
    @Test("reference data that never arrived is fetched again on a poll tick")
    func missingReferenceDataIsRefetched() async {
        let model = AppModel(environment: .localDevelopment, api: FixturePolarisClient())
        #expect(model.workspaceData.teams.value == nil)

        await model.loadWorkspaceDataIfMissing()

        #expect(model.workspaceData.teams.value?.isEmpty == false)
    }
}

@MainActor
@Suite("Refused status writes")
struct StatusWriteErrorTests {
    /// The row rolling back was the only thing a refusal said, which is indistinguishable
    /// from a tap that missed.
    @Test("a refused status change from a list row is reported, not only rolled back")
    func listWriteSaysWhy() async {
        let store = IssuesStore(api: WritesRefusingClient())
        await store.load()
        guard let target = store.issues.value?.first else {
            Issue.record("the fixture list is empty")
            return
        }
        let before = target.state

        await store.setState(issueID: target.id, to: FixtureData.states[3])

        #expect(store.writeError != nil)
        #expect(store.issues.value?.first { $0.id == target.id }?.state.id == before.id)
    }

    @Test("the sentence goes away when the reader dismisses it")
    func clearing() async {
        let store = IssuesStore(api: WritesRefusingClient())
        await store.load()
        guard let target = store.issues.value?.first else {
            Issue.record("the fixture list is empty")
            return
        }

        await store.setState(issueID: target.id, to: FixtureData.states[3])
        store.clearWriteError()

        #expect(store.writeError == nil)
    }

    @Test("a team list reports its own refused writes")
    func teamWriteSaysWhy() async {
        let store = TeamWorkStore(api: WritesRefusingClient(), team: FixtureData.team)
        await store.load()
        guard let target = store.issues.value?.first else {
            Issue.record("the fixture team list is empty")
            return
        }

        await store.setState(issueID: target.id, to: FixtureData.states[3])

        #expect(store.writeError != nil)
    }
}

// MARK: - Doubles

/// Counts state requests and can be made to refuse them, so "asked once" and "asked again
/// after a failure" are both observable.
private actor CountingStatesClient: PolarisAPI {
    private(set) var stateRequests = 0
    private var refusing = false
    private let inner = FixturePolarisClient()

    func setRefusing(_ value: Bool) { refusing = value }

    func workflowStates(teamId: String) async throws -> [WorkflowState] {
        stateRequests += 1
        if refusing { throw PolarisError.offline }
        return try await inner.workflowStates(teamId: teamId)
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

/// A workspace whose team genuinely defines no statuses — the one case where the picker's
/// "no statuses in this team" is true.
private actor NoStatesClient: PolarisAPI {
    private let inner = FixturePolarisClient()

    func workflowStates(teamId: String) async throws -> [WorkflowState] { [] }

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

/// Answers every read and refuses `updateIssue`, which is the shape of a status change the
/// server rejects — a permission, a validation, a dead session.
private actor WritesRefusingClient: PolarisAPI {
    private let inner = FixturePolarisClient()

    func updateIssue(_ change: IssueChange) async throws -> PolarisCore.Issue { throw PolarisError.offline }

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
