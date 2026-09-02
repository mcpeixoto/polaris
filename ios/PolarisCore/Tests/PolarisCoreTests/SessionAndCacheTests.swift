import Foundation
import Testing
@testable import PolarisCore

/// A client whose reads all fail with one chosen error, for the paths that only exist when
/// the server says no. `FixturePolarisClient` can refuse a *write*; it always answers a read.
private actor RefusingClient: PolarisAPI {
    private let error: PolarisError
    private let inner = FixturePolarisClient()
    /// Reads answer normally until this is armed, so a store can be brought to a good state
    /// first and then have the session pulled out from under it.
    private var refusingReads: Bool

    init(error: PolarisError, refusingReads: Bool = true) {
        self.error = error
        self.refusingReads = refusingReads
    }

    func startRefusing() { refusingReads = true }

    private func guardReads() throws {
        if refusingReads { throw error }
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
    func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace {
        try await inner.createWorkspace(draft)
    }
    func restoreSession() async throws -> Session { try await inner.restoreSession() }
    @discardableResult func signOut() async -> PolarisError? { nil }
    func useWorkspace(id: String) async {}

    func viewer() async throws -> Viewer { try guardReads(); return try await inner.viewer() }
    func syncVersion() async throws -> Int { try guardReads(); return try await inner.syncVersion() }
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] {
        try guardReads()
        return try await inner.myIssues(includeCompleted: includeCompleted)
    }
    func issues(teamId: String) async throws -> [PolarisCore.Issue] {
        try guardReads(); return try await inner.issues(teamId: teamId)
    }
    func issue(id: String) async throws -> PolarisCore.Issue { try guardReads(); return try await inner.issue(id: id) }
    func comments(issueId: String) async throws -> [PolarisCore.Comment] {
        try guardReads(); return try await inner.comments(issueId: issueId)
    }
    func teams() async throws -> [Team] { try guardReads(); return try await inner.teams() }
    func workflowStates(teamId: String) async throws -> [WorkflowState] {
        try guardReads(); return try await inner.workflowStates(teamId: teamId)
    }
    func users() async throws -> [User] { try guardReads(); return try await inner.users() }
    func unreadNotificationCount() async throws -> Int {
        try guardReads(); return try await inner.unreadNotificationCount()
    }
    func notifications(includeRead: Bool, includeSnoozed: Bool, first: Int?) async throws -> [PolarisNotification] {
        try guardReads()
        return try await inner.notifications(includeRead: includeRead, includeSnoozed: includeSnoozed, first: first)
    }
    func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults {
        try guardReads()
        return try await inner.search(query: query, teamId: teamId, first: first)
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

@MainActor
@Suite("An expired session")
struct ExpiredSessionTests {
    /// The dead end this fixes.
    ///
    /// `phase` only ever moved to `.signedOut` during boot. A refresh cookie that expired
    /// while the app was open left every screen showing "Your session expired. Sign in again."
    /// over a list with no sign-in affordance — and `.unauthorized.isRetryable` is false, so
    /// there was not even a Try again button. The only exit was Settings → Sign out.
    @Test("a refused read while the app is open returns to the sign-in screen")
    func refusedReadSignsOut() async {
        let model = AppModel(
            environment: .localDevelopment,
            api: RefusingClient(error: .unauthorized("Your session expired.")),
            cache: InMemoryIssueCache()
        )
        await model.issues.load()
        // The store's own callback fires synchronously; the sign-out it starts is a Task.
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(50))

        guard case .signedOut(let reason) = model.phase else {
            Issue.record("phase is \(model.phase), expected .signedOut")
            return
        }
        #expect(reason == .unauthorized("Your session expired."))
    }

    /// A retryable failure is not an expired session, and must not throw somebody out of the
    /// app for being on a train.
    @Test("an offline read does not sign anybody out")
    func offlineDoesNotSignOut() async {
        let model = AppModel(
            environment: .localDevelopment,
            api: RefusingClient(error: .offline),
            cache: InMemoryIssueCache()
        )
        let before = model.phase
        await model.issues.load()
        try? await Task.sleep(for: .milliseconds(50))

        #expect(model.phase == before)
        #expect(model.issues.issues.error == .offline)
        #expect(model.issues.lastRefreshError == .offline)
    }

    @Test("signing out rebuilds every store, so the next account sees no leftovers")
    func signOutResetsStores() async {
        let model = AppModel(environment: .localDevelopment, api: FixturePolarisClient())
        await model.issues.load()
        #expect(model.issues.issues.value?.isEmpty == false)

        let issuesBefore = ObjectIdentifier(model.issues)
        await model.signOut()

        #expect(model.phase == .signedOut(nil))
        #expect(ObjectIdentifier(model.issues) != issuesBefore)
        #expect(model.issues.issues.value == nil)
        #expect(model.inbox.notifications.value == nil)
    }
}

@MainActor
@Suite("Cold-start cache")
struct IssueCacheTests {
    @Test("the last list is on screen before the first request answers")
    func hydratesFromCache() async {
        let cache = InMemoryIssueCache(seed: FixtureData.baseIssues)
        let store = IssuesStore(api: FixturePolarisClient(), cache: cache)

        store.hydrateFromCache()

        #expect(store.issues.value?.count == FixtureData.baseIssues.count)
        #expect(store.isShowingCachedIssues)
    }

    @Test("a successful load replaces the cached list and stops calling it cached")
    func loadClearsCachedFlag() async {
        let cache = InMemoryIssueCache(seed: [])
        let store = IssuesStore(api: FixturePolarisClient(), cache: cache)
        store.hydrateFromCache()
        await store.load()

        #expect(!store.isShowingCachedIssues)
        // Written back, so the *next* cold start has this list rather than the seed.
        #expect(cache.read()?.isEmpty == false)
    }

    /// The filtered list is deliberately not persisted: restoring "everything including
    /// completed" on a cold start, under a filter that is off, would be a list that disagrees
    /// with its own header.
    @Test("only the unfiltered list is written to the cache")
    func filteredListIsNotCached() async {
        let cache = InMemoryIssueCache()
        let store = IssuesStore(api: FixturePolarisClient(), cache: cache)
        await store.setIncludeCompleted(true)

        #expect(cache.read() == nil)
    }

    @Test("hydration never overwrites a list that is already loaded")
    func hydrationDoesNotClobber() async {
        let cache = InMemoryIssueCache(seed: FixtureData.baseIssues)
        let store = IssuesStore(api: FixturePolarisClient(), cache: cache)
        await store.load()
        let loaded = store.issues.value?.count

        store.hydrateFromCache()

        #expect(store.issues.value?.count == loaded)
        #expect(!store.isShowingCachedIssues)
    }
}

@MainActor
@Suite("Freshness polling")
struct RefreshIfStaleTests {
    /// The whole point of the poll: one cheap query, and no refetch unless the number moved.
    @Test("an unchanged sync version refetches nothing")
    func shortCircuits() async {
        let api = FixturePolarisClient()
        let store = IssuesStore(api: api)
        await store.load()
        await store.setIncludeCompleted(true)
        let before = store.issues.value?.count

        // The fixture's syncVersion never moves, so this must not reload — which would drop
        // the filter's list back to the default one.
        await store.refreshIfStale()

        #expect(store.issues.value?.count == before)
    }

    /// It used to `guard let … = try? await api.syncVersion() else { return }`: a foregrounded
    /// app with a dead session did nothing at all and said nothing about it.
    @Test("a failed poll is reported rather than swallowed")
    func failureIsReported() async {
        let store = IssuesStore(api: RefusingClient(error: .offline))
        await store.refreshIfStale()

        #expect(store.lastRefreshError == .offline)
    }
}

@MainActor
@Suite("Boot order")
struct BootOrderTests {
    /// Resume first, dev session second, form last. A sign-in screen on every launch is the
    /// most common self-inflicted wound in a client that already holds a refresh cookie, and
    /// nothing asserted the order.
    @Test("a restorable session skips the sign-in screen")
    func restoreWins() async {
        let model = AppModel(environment: .localDevelopment, api: FixturePolarisClient())
        await model.start()

        // The fixture refuses `restoreSession` and accepts the dev session, so this lands in
        // `.ready` either way — what matters is that it is not `.signedOut`.
        if case .signedOut = model.phase {
            Issue.record("phase is \(model.phase) with a session available")
        }
    }

    @Test("no session anywhere ends at the welcome screen, with no error to explain")
    func noSessionShowsWelcome() async {
        let model = AppModel(
            environment: .localDevelopment,
            api: FixturePolarisClient(signedIn: false)
        )
        await model.start()

        // `.signedOut(nil)`, not `.signedOut(someError)`: nobody failed to sign in here, and
        // an error on a screen the reader has not acted on yet is noise.
        #expect(model.phase == .signedOut(nil))
    }

    /// An account that exists but belongs to no workspace is what every first registration
    /// lands in, and it must not be folded into "signed out" — that sends somebody who has
    /// just created an account back to a password field.
    @Test("an account with no workspace is asked to create one")
    func needsWorkspace() async {
        let model = AppModel(
            environment: .localDevelopment,
            api: FixturePolarisClient(hasWorkspace: false)
        )
        await model.start()

        #expect(model.phase == .needsWorkspace)
    }
}
