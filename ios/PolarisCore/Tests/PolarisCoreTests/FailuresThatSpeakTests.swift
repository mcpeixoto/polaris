import Foundation
import Testing

@testable import PolarisCore

/// Failures a reader can read, and get out of.
///
/// Both halves of this file are the same bug seen twice: a transport code nobody mapped and a
/// reference collection nobody could refetch both end as a screen that says nothing useful
/// and offers no way forward.
@Suite("Transport failures a reader can act on")
struct URLErrorMappingTests {
    /// The one that started this. A stopped API container, or a self-hosted address that is
    /// not listening, is `.cannotConnectToHost` — and it used to arrive as "Polaris sent an
    /// unexpected response", with `isRetryable` false, so no screen offered a Retry.
    @Test("a server that is not listening is retryable and says the server is not answering")
    func cannotConnectToHost() {
        let mapped = PolarisError.from(urlError: URLError(.cannotConnectToHost))

        #expect(mapped == .serverUnreachable)
        #expect(mapped.isRetryable)
        #expect(mapped.displayMessage.lowercased().contains("server"))
        #expect(mapped.displayMessage != PolarisError.offline.displayMessage)
    }

    @Test("a host that does not resolve is the same answer as one that does not listen")
    func hostResolution() {
        #expect(PolarisError.from(urlError: URLError(.cannotFindHost)) == .serverUnreachable)
        #expect(PolarisError.from(urlError: URLError(.dnsLookupFailed)) == .serverUnreachable)
    }

    @Test("every code that means the device has no network reads as offline")
    func offlineCodes() {
        let codes: [URLError.Code] = [
            .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed,
            .internationalRoamingOff, .callIsActive, .cannotLoadFromNetwork,
        ]
        for code in codes {
            #expect(PolarisError.from(urlError: URLError(code)) == .offline, "\(code)")
        }
    }

    /// A certificate the device will not trust is not "you're offline": the network works,
    /// and sending somebody to check their Wi-Fi hides the only fact that would help them.
    @Test("a TLS failure blames the certificate, not the connection")
    func tlsIsNotOffline() {
        let codes: [URLError.Code] = [
            .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
            .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
            .clientCertificateRejected, .clientCertificateRequired,
            .appTransportSecurityRequiresSecureConnection,
        ]
        for code in codes {
            #expect(PolarisError.from(urlError: URLError(code)) == .insecureConnection, "\(code)")
        }
        #expect(PolarisError.insecureConnection.displayMessage.contains("certificate"))
        // Nothing about the request changes on a second attempt, so no screen should offer one.
        #expect(PolarisError.insecureConnection.isRetryable == false)
    }

    @Test("a cancelled request is not a failure the reader caused")
    func cancellation() {
        #expect(PolarisError.from(urlError: URLError(.cancelled)) == .cancelled)
        #expect(PolarisError.from(urlError: URLError(.userCancelledAuthentication)) == .cancelled)
    }

    /// The default still exists and still means "we do not know" — including for the URLs a
    /// build assembles wrongly, which are a bug report and not a sentence for a phone.
    @Test("an unrecognised code is still a bad response")
    func unknownCodes() {
        #expect(PolarisError.from(urlError: URLError(.unsupportedURL)) == .badResponse)
        #expect(PolarisError.from(urlError: URLError(.badURL)) == .badResponse)
        #expect(PolarisError.from(urlError: URLError(.badServerResponse)) == .badResponse)
    }

    @Test("the new cases carry copy somebody can read")
    func newCasesHaveCopy() {
        for error: PolarisError in [.serverUnreachable, .insecureConnection, .cancelled] {
            #expect(error.displayMessage.isEmpty == false)
            #expect(error.displayMessage.hasSuffix("."))
        }
    }
}

/// Reference data that failed once and stayed broken for the session. The status picker got
/// this treatment already; the other five collections had no way to ask again at all.
@MainActor
@Suite("Reference data that can be asked again")
struct ReferenceDataRetryTests {
    @Test("a collection nobody has asked for is idle, not empty and not failed")
    func idleIsNotEmpty() {
        let store = WorkspaceDataStore(api: FixturePolarisClient())

        for collection in ReferenceCollection.allCases {
            #expect(store.failure(of: collection) == nil, "\(collection)")
        }
        #expect(store.teams.value == nil)
        #expect(store.users.value == nil)
    }

    @Test("a screen can fetch one collection without running the whole bootstrap")
    func ensureFetchesOne() async {
        let api = RefusingReferenceClient()
        let store = WorkspaceDataStore(api: api)

        await store.ensure(.teams)

        #expect(store.teams.value?.isEmpty == false)
        #expect(await api.calls(for: .users) == 0)
    }

    @Test("a collection already here is not fetched twice")
    func ensureIsIdempotent() async {
        let api = RefusingReferenceClient()
        let store = WorkspaceDataStore(api: api)

        await store.ensure(.labels)
        await store.ensure(.labels)

        #expect(await api.calls(for: .labels) == 1)
    }

    /// The defect, for every collection: a refused fetch was indistinguishable from an empty
    /// answer, and nothing could ask again.
    @Test("every collection reports its own failure and recovers on a retry")
    func failureIsRetryable() async {
        for collection in ReferenceCollection.allCases {
            let api = RefusingReferenceClient()
            await api.refuse(collection)
            let store = WorkspaceDataStore(api: api)

            await store.ensure(collection)
            let failure = store.failure(of: collection)
            #expect(failure == .offline, "\(collection)")
            #expect(failure?.isRetryable == true, "\(collection)")

            await api.allow(collection)
            await store.reload(collection)

            #expect(store.failure(of: collection) == nil, "\(collection)")
        }
    }

    /// The consequence the composer felt: with no teams there is nothing to file an issue
    /// against, Create is disabled, and the strip into the team screens is not drawn.
    @Test("a failed teams fetch is a stated reason, and the retry brings the teams back")
    func composerCanSayWhyAndRecover() async {
        let api = RefusingReferenceClient()
        await api.refuse(.teams)
        let store = WorkspaceDataStore(api: api)

        await store.ensure(.teams)
        #expect(store.teams.value == nil)
        let failure = store.failure(of: .teams)
        #expect(failure != nil)
        #expect(failure?.displayMessage.isEmpty == false)

        await api.allow(.teams)
        await store.reload(.teams)

        #expect(store.teams.value?.isEmpty == false)
    }

    /// Teams without their states is a composer that can pick a team and no status, which is
    /// the same dead picker one layer down.
    @Test("retrying teams fetches their workflow states too")
    func teamsRetryCarriesStates() async {
        let api = RefusingReferenceClient()
        await api.refuse(.teams)
        let store = WorkspaceDataStore(api: api)

        await store.ensure(.teams)
        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .unknown)

        await api.allow(.teams)
        await store.reload(.teams)

        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .loaded)
        #expect(store.states(forTeam: FixtureData.team.id).isEmpty == false)
    }

    @Test("several collections can be asked for at once")
    func ensureMany() async {
        let api = RefusingReferenceClient()
        let store = WorkspaceDataStore(api: api)

        await store.ensureReferenceData([.teams, .users, .labels, .projects])

        #expect(store.teams.value != nil)
        #expect(store.users.value != nil)
        #expect(store.labels.value != nil)
        #expect(store.projects.value != nil)
        #expect(store.projectStatuses.value == nil)
    }

    /// The list-freshness rule, now that a retry exists to test it with: a retry that fails
    /// must not replace what the reader is looking at with an error.
    @Test("a failed retry leaves the list already on screen alone")
    func failedRetryKeepsTheList() async {
        let api = RefusingReferenceClient()
        let store = WorkspaceDataStore(api: api)

        await store.ensure(.projects)
        let held = store.projects.value
        #expect(held?.isEmpty == false)

        await api.refuse(.projects)
        await store.reload(.projects)

        #expect(store.projects.value?.count == held?.count)
    }

    /// A screen dismissed mid-fetch cancels its own request. Recording that as a failure puts
    /// a retry chip in front of somebody for a request they walked away from — and, worse,
    /// leaves the collection stuck as failed until something asks again.
    @Test("a cancelled fetch goes back to idle rather than failing")
    func cancellationIsNotAFailure() async {
        let api = RefusingReferenceClient()
        await api.refuse(.users, with: .cancelled)
        let store = WorkspaceDataStore(api: api)

        await store.ensure(.users)

        #expect(store.failure(of: .users) == nil)
        #expect(store.users.value == nil)

        await api.allow(.users)
        await store.ensure(.users)

        #expect(store.users.value?.isEmpty == false)
    }

    @Test("a cancelled states fetch leaves the team unknown, not failed")
    func cancelledStatesStayUnknown() async {
        let api = CancellingStatesClient()
        let store = WorkspaceDataStore(api: api)

        await store.ensureStates(forTeam: FixtureData.team.id)

        #expect(store.statesAvailability(forTeam: FixtureData.team.id) == .unknown)
        #expect(store.statesFailedForTeam.isEmpty)
    }
}

// MARK: - Doubles

/// Answers every reference read from the fixtures, counts them, and can be told to refuse any
/// one of them — so "asked once", "failed", and "asked again and recovered" are all
/// observable per collection.
private actor RefusingReferenceClient: PolarisAPI {
    private let inner = FixturePolarisClient()
    private var refusals: [ReferenceCollection: PolarisError] = [:]
    private var counts: [ReferenceCollection: Int] = [:]

    func refuse(_ collection: ReferenceCollection, with error: PolarisError = .offline) {
        refusals[collection] = error
    }
    func allow(_ collection: ReferenceCollection) { refusals[collection] = nil }
    func calls(for collection: ReferenceCollection) -> Int { counts[collection] ?? 0 }

    private func check(_ collection: ReferenceCollection) throws {
        counts[collection, default: 0] += 1
        if let error = refusals[collection] { throw error }
    }

    func teams() async throws -> [Team] {
        try check(.teams)
        return try await inner.teams()
    }
    func users() async throws -> [User] {
        try check(.users)
        return try await inner.users()
    }
    func labels() async throws -> [PolarisCore.Label] {
        try check(.labels)
        return try await inner.labels()
    }
    func projects() async throws -> [Project] {
        try check(.projects)
        return try await inner.projects()
    }
    func projectStatuses() async throws -> [ProjectStatus] {
        try check(.projectStatuses)
        return try await inner.projectStatuses()
    }
    func favorites() async throws -> [Favorite] {
        try check(.favorites)
        return try await inner.favorites()
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
    func workflowStates(teamId: String) async throws -> [WorkflowState] { try await inner.workflowStates(teamId: teamId) }
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

/// A states fetch that is cancelled rather than refused — the shape of a detail screen
/// dismissed while its status picker was still asking.
private actor CancellingStatesClient: PolarisAPI {
    private let inner = FixturePolarisClient()

    func workflowStates(teamId: String) async throws -> [WorkflowState] { throw PolarisError.cancelled }

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
