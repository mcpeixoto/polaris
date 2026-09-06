import Foundation
import Testing
@testable import PolarisCore

// The parity stores, driven against the fixture: every optimistic write applies at once and
// rolls back when the double refuses, the scopes switch without blanking, and the derived
// lists split a team's work the way the screens need it.

@MainActor
@Suite("Issue detail parity")
struct IssueDetailParityTests {
    private func store(viewerId: String? = "u1") async -> (IssueDetailStore, FixturePolarisClient) {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.baseIssues[0], viewerId: viewerId)
        await store.load()
        return (store, api)
    }

    @Test("a load brings the detail, the history and the subscription with it")
    func loadsEverything() async {
        let (store, _) = await store()
        let detail = try! #require(store.detail.value)
        #expect(detail.children.map(\.identifier) == ["ENG-91", "ENG-92"])
        #expect(detail.attachments.count == 1)
        #expect(detail.relations.first?.counterpart(of: "i1").identifier == "ENG-2")
        #expect(store.history.value?.map(\.kind) == ["created", "state", "assignee"])
        #expect(store.isSubscribed)
        #expect(store.issue.value?.project?.name == "Mobile parity")
        #expect(store.issue.value?.cycle?.id == "cy1")
    }

    @Test("a due date change applies at once, is replaced by the server's row, and clears")
    func dueDate() async {
        let (store, api) = await store()
        await store.setDueDate("2026-10-01")
        #expect(store.issue.value?.dueDate == "2026-10-01")
        #expect(store.detail.value?.issue.dueDate == "2026-10-01")
        #expect(await api.storedIssues[0].dueDate == "2026-10-01")

        await store.setDueDate(nil)
        #expect(store.issue.value?.dueDate == nil)
        #expect(await api.storedIssues[0].dueDate == nil)
    }

    @Test("a refused due date change rolls back and is reported")
    func dueDateRollback() async {
        let (store, api) = await store()
        await api.setFailNextWrite(.forbidden)
        await store.setDueDate("2026-10-01")
        #expect(store.issue.value?.dueDate == "2026-09-12")
        #expect(store.detail.value?.issue.dueDate == "2026-09-12")
        #expect(store.propertyError == .forbidden)
    }

    @Test("estimate, project, cycle and parent each apply and each roll back")
    func planningProperties() async {
        let (store, api) = await store()
        await store.setEstimate(5)
        #expect(store.issue.value?.estimate == 5)
        await store.setEstimate(nil)
        #expect(store.issue.value?.estimate == nil)

        let other = FixtureData.projects[1].ref
        await store.setProject(other)
        #expect(store.issue.value?.projectId == other.id && store.issue.value?.project?.name == "Sync v2")
        await store.setProject(nil)
        #expect(store.issue.value?.projectId == nil && store.issue.value?.project == nil)

        await store.setCycle(FixtureData.upcomingCycle.ref)
        #expect(store.issue.value?.cycleId == "cy2")
        await store.setCycle(nil)
        #expect(store.issue.value?.cycle == nil)

        await store.setParent(FixtureData.baseIssues[2].ref)
        #expect(store.issue.value?.parent?.identifier == "ENG-3")
        // An issue cannot be its own parent; the request is dropped before it is sent.
        await store.setParent(store.issue.value!.ref)
        #expect(store.issue.value?.parent?.identifier == "ENG-3")
        await store.setParent(nil)
        #expect(store.issue.value?.parentId == nil)

        func expectRollback(_ name: String, _ write: () async -> Void) async {
            let before = store.issue.value
            await api.setFailNextWrite(.offline)
            await write()
            #expect(store.issue.value == before, "\(name) did not roll back")
            #expect(store.propertyError == .offline, Testing.Comment(rawValue: name))
        }
        await expectRollback("estimate") { await store.setEstimate(8) }
        await expectRollback("project") { await store.setProject(other) }
        await expectRollback("cycle") { await store.setCycle(FixtureData.upcomingCycle.ref) }
        await expectRollback("parent") { await store.setParent(FixtureData.baseIssues[2].ref) }
    }

    @Test("a label is added and removed optimistically, and never twice")
    func labels() async {
        let (store, api) = await store()
        let label = FixtureData.labels[4]
        await store.addLabel(label)
        #expect(store.issue.value?.labels.map(\.id) == ["lab1", "lab3", "lab5"])
        #expect(await api.storedIssues[0].labels.count == 3)

        await store.addLabel(label)
        #expect(store.issue.value?.labels.count == 3)

        await store.removeLabel(label)
        #expect(store.issue.value?.labels.map(\.id) == ["lab1", "lab3"])
        #expect(await api.storedIssues[0].labels.count == 2)
    }

    @Test("a refused label write rolls back")
    func labelRollback() async {
        let (store, api) = await store()
        await api.setFailNextWrite(.forbidden)
        await store.addLabel(FixtureData.labels[1])
        #expect(store.issue.value?.labels.map(\.id) == ["lab1", "lab3"])
        #expect(store.propertyError == .forbidden)

        await api.setFailNextWrite(.forbidden)
        await store.removeLabel(FixtureData.labels[0])
        #expect(store.issue.value?.labels.map(\.id) == ["lab1", "lab3"])
    }

    @Test("unsubscribing flips at once, writes an opt-out row, and rolls back when refused")
    func subscription() async {
        let (store, api) = await store()
        await store.setSubscribed(false)
        #expect(!store.isSubscribed)
        #expect(store.detail.value?.isSubscribed("u1") == false)
        #expect(await api.storedSubscriptions["i1"]?.contains { $0.userId == "u1" && $0.unsubscribed } == true)

        await api.setFailNextWrite(.timedOut)
        await store.setSubscribed(true)
        #expect(!store.isSubscribed)
        #expect(store.detail.value?.isSubscribed("u1") == false)
        #expect(store.propertyError == .timedOut)
    }

    @Test("deleting reports success and failure, like archiving")
    func delete() async {
        let (store, api) = await store()
        await api.setFailNextWrite(.forbidden)
        #expect(await store.delete() == false)
        #expect(!store.isDeleted && store.propertyError == .forbidden)

        #expect(await store.delete() == true)
        #expect(store.isDeleted)
        #expect(await api.storedIssues.contains { $0.id == "i1" } == false)
        // Sub-issues are orphaned, not deleted.
        #expect(await api.storedChildren.allSatisfy { $0.parentId == nil })
    }

    @Test("editing a comment shows the new text, and restores the old one when refused")
    func editComment() async {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.baseIssues[1], viewerId: "u1")
        await store.load()
        let original = try! #require(store.comments.value?.first)

        #expect(await store.editComment(id: original.id, body: "  Fixed in #482.  "))
        #expect(store.comments.value?.first?.body == "Fixed in #482.")
        #expect(store.comments.value?.first?.editedAt != nil)

        await api.setFailNextWrite(.validation(message: "Too long", field: "body"))
        #expect(await store.editComment(id: original.id, body: "again") == false)
        #expect(store.comments.value?.first?.body == "Fixed in #482.")
        #expect(store.commentError?.displayMessage == "Too long")
    }

    @Test("a refused comment delete puts the row back where it was")
    func deleteComment() async {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.baseIssues[1], viewerId: "u1")
        await store.load()
        _ = await store.postComment("first")
        _ = await store.postComment("second")
        let before = try! #require(store.comments.value).map(\.id)
        let victim = before[1]

        await api.setFailNextWrite(.server(status: 500, message: nil))
        #expect(await store.deleteComment(id: victim) == false)
        #expect(store.comments.value?.map(\.id) == before)

        #expect(await store.deleteComment(id: victim) == true)
        #expect(store.comments.value?.map(\.id) == [before[0], before[2]])
    }

    @Test("a reaction toggles on and off, and the placeholder is replaced by the server's")
    func reactions() async {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.baseIssues[1], viewerId: "u1")
        await store.load()
        let comment = try! #require(store.comments.value?.first)
        #expect(comment.hasReaction("👍", by: "u1"))

        await store.toggleReaction(commentId: comment.id, emoji: "🎉", viewerId: "u1")
        let added = try! #require(store.comments.value?.first)
        #expect(added.hasReaction("🎉", by: "u1"))
        #expect(added.reactions.allSatisfy { !$0.id.hasPrefix("pending-") })

        await store.toggleReaction(commentId: comment.id, emoji: "👍", viewerId: "u1")
        #expect(store.comments.value?.first?.hasReaction("👍", by: "u1") == false)

        await api.setFailNextWrite(.offline)
        await store.toggleReaction(commentId: comment.id, emoji: "👍", viewerId: "u1")
        #expect(store.comments.value?.first?.hasReaction("👍", by: "u1") == false)
        #expect(store.commentError == .offline)
    }

    @Test("a link appears at once and is swapped for the server's card, or removed when refused")
    func links() async {
        let (store, api) = await store()
        #expect(await store.addLink(url: "https://example.com/spec", title: "Spec"))
        let cards = try! #require(store.detail.value?.attachments)
        #expect(cards.count == 2)
        #expect(cards.last?.title == "Spec")
        #expect(cards.allSatisfy { !$0.id.hasPrefix("pending-") })

        await api.setFailNextWrite(.forbidden)
        #expect(await store.addLink(url: "https://example.com/other", title: nil) == false)
        #expect(store.detail.value?.attachments.count == 2)
        #expect(store.propertyError == .forbidden)
    }

    @Test("accepting and declining triage replace the issue with the server's, and report a refusal")
    func triage() async {
        let triaged = FixtureData.issue(
            id: "tri", identifier: "ENG-40", title: "From the intake form",
            priority: Priority.none, state: FixtureData.states[4]
        )
        let api = FixturePolarisClient(issues: [triaged])
        let store = IssueDetailStore(api: api, issue: triaged, viewerId: "u1")
        await store.load()
        #expect(store.issue.value?.state.category == .triage)

        await store.acceptTriage()
        #expect(store.issue.value?.state.category == .unstarted)

        await api.setFailNextWrite(.forbidden)
        await store.declineTriage()
        #expect(store.issue.value?.state.category == .unstarted)
        #expect(store.propertyError == .forbidden)

        await store.declineTriage()
        #expect(store.issue.value?.state.category == .canceled)
    }

    @Test("a sub-issue shows with a provisional identifier and takes the server's")
    func subIssue() async {
        let (store, api) = await store()
        #expect(await store.createSubIssue(title: "Write the migration"))
        let children = try! #require(store.detail.value?.children)
        #expect(children.count == 3)
        #expect(children.last?.title == "Write the migration")
        #expect(children.last?.identifier.hasSuffix("…") == false)
        #expect(children.last?.parentId == "i1")
        // In the parent's children, not in the team list.
        #expect(await api.storedIssues.count == 4)

        await api.setFailNextWrite(.offline)
        #expect(await store.createSubIssue(title: "Never lands") == false)
        #expect(store.detail.value?.children.count == 3)
        #expect(store.propertyError == .offline)
    }

    @Test("a client that knows only the issue still opens the screen, with nothing hanging off it")
    func defaultsForANarrowClient() async {
        let store = IssueDetailStore(api: IssueOnlyClient(), issue: FixtureData.baseIssues[0])
        await store.load()
        #expect(store.detail.value?.children.isEmpty == true)
        #expect(store.history.value?.isEmpty == true)
        #expect(store.issue.value?.id == "i1")

        await store.setSubscribed(true)
        #expect(store.propertyError == .server(status: 501, message: "This client cannot handle subscriptions."))
        #expect(!store.isSubscribed)
    }
}

@MainActor
@Suite("My issues scopes")
struct MyIssuesScopeTests {
    @Test("switching scope changes the list without blanking it, and only the assigned list is cached")
    func scopes() async {
        let cache = InMemoryIssueCache()
        let store = IssuesStore(api: FixturePolarisClient(), cache: cache)
        await store.load()
        // The fixture's assigned list is every open row — the "3 OPEN" the UI tests count.
        #expect(store.issues.value?.map(\.identifier) == ["ENG-1", "ENG-3", "ENG-2"])
        #expect(cache.read()?.count == 3)

        await store.setScope(.created)
        #expect(store.scope == .created)
        #expect(store.issues.value?.map(\.identifier) == ["ENG-3", "ENG-2"])
        #expect(store.issues.isLoading == false)
        #expect(cache.read()?.count == 3, "a scoped list was written to the cache")

        await store.setScope(.subscribed)
        #expect(store.issues.value?.map(\.identifier) == ["ENG-1", "ENG-2"])

        await store.setIncludeCompleted(true)
        #expect(store.issues.value?.map(\.identifier) == ["ENG-1", "ENG-2"])
        // ENG-4 is finished but was filed by somebody else, so it stays out of "created".
        await store.setScope(.created)
        #expect(store.issues.value?.map(\.identifier) == ["ENG-3", "ENG-2"])
        await store.setScope(.assigned)
        #expect(store.issues.value?.map(\.identifier) == ["ENG-1", "ENG-3", "ENG-2", "ENG-4"])
    }

    @Test("a client that knows only the assigned query still answers that scope")
    func assignedDefault() async throws {
        let api = IssueOnlyClient()
        #expect(try await api.myIssues(scope: .assigned, includeCompleted: false).count == 3)
        await #expect(throws: PolarisError.self) {
            try await api.myIssues(scope: .subscribed, includeCompleted: false)
        }
    }
}

@MainActor
@Suite("Workspace reference data parity")
struct WorkspaceParityTests {
    @Test("labels, projects, statuses and favourites load beside teams and users")
    func loadsAll() async {
        let store = WorkspaceDataStore(api: FixturePolarisClient())
        await store.load()
        #expect(store.labels.value?.count == 5)
        #expect(store.labels(forTeam: "t1").map(\.name) == ["backend", "customer-reported", "needs-design", "p0-escalation", "regression"])
        #expect(store.projects.value?.count == 2)
        #expect(store.projects(forTeam: "t1").map(\.name) == ["Mobile parity", "Sync v2"])
        #expect(store.project(id: "p1")?.lead?.id == "u1")
        #expect(store.projectStatus(id: "ps3")?.category == .started)
        #expect(store.isFavorite(kind: .issue, targetId: "i3"))
        #expect(!store.isFavorite(kind: .team, targetId: "t1"))
    }

    @Test("a failed projects request leaves the rest of the reference data alone")
    func isolatedFailure() async {
        let store = WorkspaceDataStore(api: ProjectsRefusingClient())
        await store.load()
        #expect(store.projects.error == .offline)
        #expect(store.labels.value?.isEmpty == false)
        #expect(store.teams.value?.isEmpty == false)
        #expect(store.favorites.value != nil)
    }

    @Test("a favourite toggles on and off optimistically, and comes back when refused")
    func toggleFavorite() async {
        let api = FixturePolarisClient()
        let store = WorkspaceDataStore(api: api)
        await store.load()

        await store.toggleFavorite(kind: .team, targetId: "t1")
        #expect(store.isFavorite(kind: .team, targetId: "t1"))
        #expect(store.favorites.value?.allSatisfy { !$0.id.hasPrefix("pending-") } == true)
        #expect(await api.storedFavorites.count == 2)

        await store.toggleFavorite(kind: .team, targetId: "t1")
        #expect(!store.isFavorite(kind: .team, targetId: "t1"))

        await api.setFailNextWrite(.forbidden)
        await store.toggleFavorite(kind: .issue, targetId: "i3")
        #expect(store.isFavorite(kind: .issue, targetId: "i3"), "a refused un-star stayed removed")
        #expect(store.favoriteError == .forbidden)

        await api.setFailNextWrite(.forbidden)
        await store.toggleFavorite(kind: .label, targetId: "lab1")
        #expect(!store.isFavorite(kind: .label, targetId: "lab1"))
    }
}

@MainActor
@Suite("Team, project and cycle stores")
struct TeamWorkStoreTests {
    private func teamStore(issues: [PolarisCore.Issue] = FixtureData.baseIssues) async -> (TeamWorkStore, FixturePolarisClient) {
        let api = FixturePolarisClient(issues: issues)
        let store = TeamWorkStore(api: api, team: FixtureData.team)
        await store.load()
        return (store, api)
    }

    @Test("a team's work splits into active, backlog and triage, and by cycle and project")
    func derivedLists() async {
        let triaged = FixtureData.issue(
            id: "tri", identifier: "ENG-40", title: "Intake", priority: Priority.none, state: FixtureData.states[4]
        )
        let (store, _) = await teamStore(issues: FixtureData.baseIssues + [triaged])
        #expect(store.all.count == 5)
        #expect(store.active.map(\.identifier) == ["ENG-1", "ENG-2"])
        #expect(store.backlog.map(\.identifier) == ["ENG-3"])
        #expect(store.triage.map(\.identifier) == ["ENG-40"])
        #expect(store.issues(inCycle: "cy1").map(\.identifier) == ["ENG-1"])
        #expect(store.issues(inProject: "p1").map(\.identifier) == ["ENG-1", "ENG-3"])
        #expect(store.activeCycle()?.id == "cy1")
        #expect(store.upcomingCycles().map(\.id) == ["cy2"])
        #expect(store.all == IssueOrder.sorted(store.all))
    }

    @Test("a refused cycles request does not take the issue list with it")
    func cyclesFailureIsolated() async {
        let store = TeamWorkStore(api: CyclesRefusingClient(), team: FixtureData.team)
        await store.load()
        #expect(store.issues.value?.count == 4)
        #expect(store.cycles.error == .offline)
    }

    @Test("a refused status change rolls the row back")
    func rollback() async {
        let (store, api) = await teamStore()
        let before = store.all.map(\.id)
        await api.setFailNextWrite(.forbidden)
        await store.setState(issueID: "i1", to: FixtureData.states[3])
        #expect(store.all.first { $0.id == "i1" }?.state.category == .started)
        #expect(store.all.map(\.id) == before)
    }

    @Test("a project gathers its issues from its teams and rolls up progress")
    func projectStore() async {
        let store = ProjectStore(api: FixturePolarisClient(), project: FixtureData.projects[0])
        await store.load()
        #expect(store.issues.value?.map(\.identifier) == ["ENG-1", "ENG-3"])
        #expect(store.progress.total == 2 && store.progress.completed == 0 && store.progress.started == 1)
        #expect(store.progress.percent == 0)

        let done = FixtureData.issue(id: "i3", identifier: "ENG-3", title: "Ship the iOS client",
                                     priority: .high, state: FixtureData.states[3], project: FixtureData.projects[0].ref)
        store.merge(done)
        #expect(store.progress.completed == 1 && store.progress.percent == 50)

        var moved = done
        moved.projectId = "p2"
        store.merge(moved)
        #expect(store.issues.value?.map(\.identifier) == ["ENG-1"])
    }

    @Test("a project the reader cannot open fails as a whole, and an unknown one is not-found")
    func projectFailures() async {
        let missing = ProjectStore(api: FixturePolarisClient(), projectID: "nope")
        await missing.load()
        #expect(missing.project.error == .notFound)
        #expect(missing.issues.error == .notFound)
    }

    @Test("a cycle holds its team's issues in it, with counts and days left")
    func cycleStore() async {
        let store = CycleStore(api: FixturePolarisClient(), cycleID: "cy1")
        await store.load()
        #expect(store.cycle.value?.number == 7)
        #expect(store.issues.value?.map(\.identifier) == ["ENG-1"])
        #expect(store.progress.total == 1 && store.progress.remaining == 1)
        let end = try! #require(store.cycle.value?.endsAt)
        #expect(store.daysRemaining(at: end.addingTimeInterval(-86_400 * 3)) == 3)
        #expect(store.daysRemaining(at: end.addingTimeInterval(86_400)) == 0)
    }

    @Test("progress counts cancelled work out of the denominator")
    func workProgress() {
        let states = FixtureData.states
        let issues = [
            FixtureData.issue(id: "a", identifier: "A-1", title: "a", priority: .low, state: states[3]),
            FixtureData.issue(id: "b", identifier: "A-2", title: "b", priority: .low, state: states[5]),
            FixtureData.issue(id: "c", identifier: "A-3", title: "c", priority: .low, state: states[2]),
        ]
        let progress = WorkProgress(issues: issues)
        #expect(progress.total == 3 && progress.completed == 1 && progress.canceled == 1 && progress.started == 1)
        #expect(progress.percent == 50)
        #expect(progress.remaining == 1)
        #expect(WorkProgress(issues: []).percent == 0)
    }
}

@Suite("Issue order")
struct IssueOrderTests {
    @Test("open first, then priority, then recency, then identifier — and stable across re-sorts")
    func order() {
        let states = FixtureData.states
        let rows = [
            FixtureData.issue(id: "a", identifier: "ENG-9", title: "done urgent", priority: .urgent, state: states[3]),
            FixtureData.issue(id: "b", identifier: "ENG-2", title: "open none", priority: Priority.none, state: states[1]),
            FixtureData.issue(id: "c", identifier: "ENG-3", title: "open high", priority: .high, state: states[0]),
            FixtureData.issue(id: "d", identifier: "ENG-1", title: "open high too", priority: .high, state: states[2]),
        ]
        let sorted = IssueOrder.sorted(rows)
        #expect(sorted.map(\.identifier) == ["ENG-1", "ENG-3", "ENG-2", "ENG-9"])
        #expect(IssueOrder.sorted(sorted.reversed()) == sorted)
    }
}

// MARK: - Doubles

/// Implements only what the protocol demanded before the parity surface existed, so the
/// defaults are what answer everything else.
private actor IssueOnlyClient: PolarisAPI {
    private let inner = FixturePolarisClient()

    func signInWithDevSession() async throws -> Session { try await inner.signInWithDevSession() }
    func signIn(email: String, password: String) async throws -> Session { try await inner.signIn(email: email, password: password) }
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
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] { try await inner.myIssues(includeCompleted: includeCompleted) }
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
    func archiveIssue(id: String, archived: Bool, opId: String) async throws { try await inner.archiveIssue(id: id, archived: archived, opId: opId) }
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification { try await inner.markNotificationRead(id: id, read: read) }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification { try await inner.snoozeNotification(id: id, until: until) }
    func deleteNotification(id: String) async throws { try await inner.deleteNotification(id: id) }
}

/// The fixture, with one collection refused — for the isolation tests.
private actor ProjectsRefusingClient: PolarisAPI {
    private let inner = FixturePolarisClient()
    func signInWithDevSession() async throws -> Session { try await inner.signInWithDevSession() }
    func signIn(email: String, password: String) async throws -> Session { try await inner.signIn(email: email, password: password) }
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
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] { try await inner.myIssues(includeCompleted: includeCompleted) }
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
    func archiveIssue(id: String, archived: Bool, opId: String) async throws { try await inner.archiveIssue(id: id, archived: archived, opId: opId) }
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification { try await inner.markNotificationRead(id: id, read: read) }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification { try await inner.snoozeNotification(id: id, until: until) }
    func deleteNotification(id: String) async throws { try await inner.deleteNotification(id: id) }

    func labels() async throws -> [Label] { try await inner.labels() }
    func projects() async throws -> [Project] { throw PolarisError.offline }
    func projectStatuses() async throws -> [ProjectStatus] { try await inner.projectStatuses() }
    func favorites() async throws -> [Favorite] { try await inner.favorites() }
}

private actor CyclesRefusingClient: PolarisAPI {
    private let inner = FixturePolarisClient()
    func signInWithDevSession() async throws -> Session { try await inner.signInWithDevSession() }
    func signIn(email: String, password: String) async throws -> Session { try await inner.signIn(email: email, password: password) }
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
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] { try await inner.myIssues(includeCompleted: includeCompleted) }
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
    func archiveIssue(id: String, archived: Bool, opId: String) async throws { try await inner.archiveIssue(id: id, archived: archived, opId: opId) }
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification { try await inner.markNotificationRead(id: id, read: read) }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification { try await inner.snoozeNotification(id: id, until: until) }
    func deleteNotification(id: String) async throws { try await inner.deleteNotification(id: id) }

    func cycles(teamId: String) async throws -> [Cycle] { throw PolarisError.offline }
}
