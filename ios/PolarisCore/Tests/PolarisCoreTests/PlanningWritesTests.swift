import Foundation
import Testing
@testable import PolarisCore

/// What a project create, a project edit and a cycle edit must do, asserted host-side.
///
/// The forms behind these are SwiftUI; everything that can actually be wrong about them is in
/// the change structs, the client and the stores — does "remove the lead" travel as something
/// other than "leave the lead alone", is a retried create one project, does a created project
/// appear in a list that is fetched once a session, and does a server refusal arrive with the
/// server's own sentence attached. None of that needs a simulator.
@MainActor
struct PlanningWritesTests {
    private var statuses: [ProjectStatus] { FixtureData.projectStatuses }
    private var started: ProjectStatus { statuses[2] }
    private var completed: ProjectStatus { statuses[3] }

    /// A project with everything a `clear…` flag can remove already set on it, so each flag
    /// has something to take away. Not added to `FixtureData.projects`: `FixtureParityTests`
    /// pins that list by name, and a seed project would change what it is asserting.
    private func fullyPopulated() -> Project {
        FixtureData.project(
            id: "pw1",
            name: "Planning writes",
            summary: "Has a lead and both dates.",
            priority: .high,
            lead: FixtureData.users[0],
            startDate: "2026-08-01",
            targetDate: "2026-12-01",
            status: started,
            teams: [FixtureData.team]
        )
    }

    // MARK: - The clear flags

    @Test("clearLead removes the lead, where a nil leadId leaves it alone")
    func clearLeadRoundTrips() async throws {
        let api = FixturePolarisClient(projects: [fullyPopulated()])

        // The distinction the flag exists for: this change names no lead at all, and must not
        // be read as "remove it".
        let renamed = try await api.updateProject(ProjectChange(id: "pw1", name: "Renamed"))
        #expect(renamed.name == "Renamed")
        #expect(renamed.leadId == FixtureData.users[0].id)
        #expect(renamed.lead?.id == FixtureData.users[0].id)

        let cleared = try await api.updateProject(ProjectChange(id: "pw1", clearLead: true))
        #expect(cleared.leadId == nil)
        #expect(cleared.lead == nil)
        // And it stuck, rather than being computed for one response.
        #expect(try await api.project(id: "pw1").lead == nil)
    }

    @Test("clearStart and clearTarget each remove only their own date")
    func clearDatesRoundTrip() async throws {
        let api = FixturePolarisClient(projects: [fullyPopulated()])

        let startGone = try await api.updateProject(ProjectChange(id: "pw1", clearStart: true))
        #expect(startGone.startDate == nil)
        #expect(startGone.targetDate == "2026-12-01", "clearStart took the target with it")

        let targetGone = try await api.updateProject(ProjectChange(id: "pw1", clearTarget: true))
        #expect(targetGone.startDate == nil)
        #expect(targetGone.targetDate == nil)
    }

    @Test("a date set alongside its granularity replaces a cleared one")
    func datesCanComeBack() async throws {
        let api = FixturePolarisClient(projects: [fullyPopulated()])
        _ = try await api.updateProject(ProjectChange(id: "pw1", clearTarget: true))

        let restored = try await api.updateProject(
            ProjectChange(
                id: "pw1",
                targetDate: "2027-01-15",
                targetDateGranularity: .day
            )
        )
        #expect(restored.targetDate == "2027-01-15")
    }

    @Test("clearDescription removes a cycle's description, where a nil description does not")
    func clearCycleDescriptionRoundTrips() async throws {
        let api = FixturePolarisClient()
        // cy1 is the running cycle and carries a description; its name is editable whatever
        // its dates are.
        let renamed = try await api.updateCycle(CycleChange(id: "cy1", name: "Detail screen"))
        #expect(renamed.name == "Detail screen")
        #expect(renamed.description == "Ship the detail screen.")

        let cleared = try await api.updateCycle(CycleChange(id: "cy1", clearDescription: true))
        #expect(cleared.description == nil)
        #expect(cleared.name == "Detail screen", "clearDescription reset the name too")
    }

    // MARK: - Create

    @Test("a retried create with the same opId is one project")
    func createIsIdempotent() async throws {
        let api = FixturePolarisClient()
        let draft = ProjectDraft(
            opId: "op-project-1",
            name: "Once",
            summary: "Only once",
            statusId: started.id,
            priority: .medium,
            leadId: FixtureData.users[1].id,
            teamIds: [FixtureData.team.id],
            startDate: "2026-10-01",
            startDateGranularity: .day
        )

        let first = try await api.createProject(draft)
        let replayed = try await api.createProject(draft)

        #expect(first == replayed)
        #expect(first.id == replayed.id, "the retry minted a second project under a new id")
        // The two seeded ones plus exactly one new.
        #expect(try await api.projects().count == 3)
        #expect(first.status.id == started.id)
        #expect(first.lead?.id == FixtureData.users[1].id)
        #expect(first.priority == .medium)
        #expect(first.startDate == "2026-10-01")
        #expect(first.teams.map(\.id) == [FixtureData.team.id])
    }

    /// `CreateProjectInput.teamIds` is `[UUID!]!` and its comment says a project with no team
    /// is invisible to everyone. The form requires one; this is the backstop that proves a
    /// form which stopped requiring it would fail rather than silently create a ghost.
    @Test("a create with no team is refused rather than made invisible")
    func createRequiresATeam() async throws {
        let api = FixturePolarisClient()
        await #expect(throws: PolarisError.validation(
            message: "A project needs at least one team.", field: "teamIds"
        )) {
            try await api.createProject(ProjectDraft(name: "Nowhere", teamIds: []))
        }
        #expect(try await api.projects().count == 2)
    }

    @Test("a refused create leaves the list alone and the next attempt lands")
    func refusedCreateRecovers() async throws {
        let api = FixturePolarisClient()
        await api.setFailNextWrite(.forbidden)

        await #expect(throws: PolarisError.forbidden) {
            try await api.createProject(ProjectDraft(name: "Blocked", teamIds: ["t1"]))
        }
        #expect(try await api.projects().count == 2)

        // A fresh opId, because the refusal was not a landed write to replay.
        let created = try await api.createProject(ProjectDraft(name: "Second try", teamIds: ["t1"]))
        #expect(created.name == "Second try")
        #expect(try await api.projects().count == 3)
    }

    // MARK: - WorkspaceDataStore.apply

    @Test("apply inserts, then replaces in place, and keeps the open-first order")
    func applyInsertsThenReplaces() async throws {
        // One closed and one open project on the same team, so "open first, then by name" has
        // something to say.
        let closed = FixtureData.project(
            id: "pa1", name: "Alpha", status: completed, teams: [FixtureData.team]
        )
        let open = FixtureData.project(
            id: "pa2", name: "Zebra", status: started, teams: [FixtureData.team]
        )
        let api = FixturePolarisClient(projects: [closed, open])
        let store = WorkspaceDataStore(api: api)
        await store.load()
        #expect(store.projects(forTeam: "t1").map(\.name) == ["Zebra", "Alpha"])

        let inserted = FixtureData.project(
            id: "pa3", name: "Beta", status: started, teams: [FixtureData.team]
        )
        store.apply(inserted)
        #expect(store.projects.value?.count == 3)
        // Open work first, alphabetical within each half — the order `projects(forTeam:)`
        // promises, recomputed rather than "wherever the new row was appended".
        #expect(store.projects(forTeam: "t1").map(\.name) == ["Beta", "Zebra", "Alpha"])

        var edited = inserted
        edited.name = "Beta renamed"
        edited.status = completed
        store.apply(edited)
        #expect(store.projects.value?.count == 3, "apply added a second copy instead of replacing")
        #expect(store.projects(forTeam: "t1").map(\.name) == ["Zebra", "Alpha", "Beta renamed"])
        #expect(store.project(id: "pa3")?.name == "Beta renamed")
    }

    @Test("a created project is in the list before anything refetches the collection")
    func createThroughTheStoreIsVisibleImmediately() async throws {
        let api = FixturePolarisClient()
        let store = WorkspaceDataStore(api: api)
        await store.load()
        let before = store.projects.value?.count ?? 0

        let created = try await store.create(
            ProjectDraft(name: "Visible at once", statusId: started.id, teamIds: ["t1"])
        )

        #expect(store.projects.value?.count == before + 1)
        #expect(store.project(id: created.id)?.name == "Visible at once")
        #expect(store.projects(forTeam: "t1").contains { $0.id == created.id })
    }

    // MARK: - Project edits through the detail store

    @Test("an edit replaces the detail header with the server's project")
    func projectStoreUpdateMovesTheHeader() async throws {
        let api = FixturePolarisClient(projects: [fullyPopulated()])
        let store = ProjectStore(api: api, project: fullyPopulated())
        await store.load()

        let updated = await store.update(
            ProjectChange(id: "pw1", name: "Edited", statusId: completed.id, clearLead: true)
        )

        #expect(updated?.name == "Edited")
        #expect(store.project.value?.name == "Edited")
        #expect(store.project.value?.status.id == completed.id)
        #expect(store.project.value?.lead == nil)
        #expect(store.writeError == nil)
    }

    @Test("a refused edit keeps the header and says why")
    func projectStoreUpdateRollsBack() async throws {
        let api = FixturePolarisClient(projects: [fullyPopulated()])
        let store = ProjectStore(api: api, project: fullyPopulated())
        await store.load()
        await api.setFailNextWrite(.rateLimited(retryAfter: 30))

        let updated = await store.update(ProjectChange(id: "pw1", name: "Never"))

        #expect(updated == nil)
        #expect(store.writeError == .rateLimited(retryAfter: 30))
        #expect(store.project.value?.name == "Planning writes")
        store.clearWriteError()
        #expect(store.writeError == nil)
    }

    @Test("apply ignores a project that is not the one on screen")
    func projectStoreApplyIsScoped() async throws {
        let api = FixturePolarisClient(projects: [fullyPopulated()])
        let store = ProjectStore(api: api, project: fullyPopulated())
        await store.load()

        store.apply(FixtureData.project(id: "somebody-else", name: "Not this one", status: started))

        #expect(store.project.value?.name == "Planning writes")
    }

    // MARK: - Cycle edits, and the dates the server will not move

    @Test("updateCycle naming an immutable start is refused, and the sentence reaches writeError")
    func immutableStartIsRefused() async throws {
        let api = FixturePolarisClient()
        // cy1 is running: "Past and current starts are immutable."
        let running = try await api.cycle(id: "cy1")
        #expect(running.isActive())
        #expect(running.allowsStartEdit() == false)
        #expect(running.allowsEndEdit(), "a running cycle's end is editable; this proves nothing")

        let store = CycleStore(api: api, cycle: running)
        await store.load()

        let moved = await store.update(
            CycleChange(id: "cy1", startsAt: Date().addingTimeInterval(86_400))
        )

        #expect(moved == nil)
        // The server's own sentence, not "something went wrong": it is the whole explanation.
        #expect(store.writeError?.displayMessage
            == "A cycle that has already started cannot have its start moved.")
        #expect(store.writeError != .unsupported("editing a cycle"))
        #expect(store.cycle.value?.startsAt == running.startsAt)
    }

    @Test("a past cycle's end is immutable too, and an upcoming one's is not")
    func immutableEndIsRefused() async throws {
        let day: TimeInterval = 86_400
        let past = FixtureData.cycle(
            id: "cyp", number: 1, name: "Done and dusted",
            startsAt: Date().addingTimeInterval(-30 * day),
            endsAt: Date().addingTimeInterval(-16 * day)
        )
        let api = FixturePolarisClient(cycles: [past, FixtureData.upcomingCycle])
        #expect(past.allowsEndEdit() == false)
        #expect(FixtureData.upcomingCycle.allowsEndEdit())

        await #expect(throws: PolarisError.validation(
            message: "A cycle that has already ended cannot have its end moved.", field: "endsAt"
        )) {
            try await api.updateCycle(CycleChange(id: "cyp", endsAt: Date()))
        }

        // The upcoming one takes both ends, which is what makes the refusal above a rule
        // rather than a client that cannot move a date at all.
        let moved = try await api.updateCycle(
            CycleChange(
                id: FixtureData.upcomingCycle.id,
                startsAt: Date().addingTimeInterval(10 * day),
                endsAt: Date().addingTimeInterval(24 * day)
            )
        )
        #expect(moved.startsAt > Date())
        #expect(moved.endsAt > moved.startsAt)
    }

    @Test("a rename lands on a cycle whose dates are frozen")
    func renameWorksOnARunningCycle() async throws {
        let api = FixturePolarisClient()
        let store = CycleStore(api: api, cycle: try await api.cycle(id: "cy1"))
        await store.load()

        let updated = await store.update(CycleChange(id: "cy1", name: "Hardening week"))

        #expect(updated?.name == "Hardening week")
        #expect(store.cycle.value?.displayName == "Hardening week")
        #expect(store.writeError == nil)
    }

    @Test("starting an upcoming cycle today moves both ends and keeps its length")
    func startCycleTodayPullsTheCycleForward() async throws {
        let api = FixturePolarisClient()
        let upcoming = try await api.cycle(id: "cy2")
        let length = upcoming.endsAt.timeIntervalSince(upcoming.startsAt)
        let store = CycleStore(api: api, cycle: upcoming)
        await store.load()

        let started = await store.startToday()

        let today = Calendar.current.startOfDay(for: Date())
        #expect(started?.startsAt == today)
        // Length preserved: a cycle dragged backwards with a fixed end is a shorter cycle
        // than the team's cadence says.
        #expect(abs((started?.endsAt.timeIntervalSince(today) ?? 0) - length) < 1)
        #expect(store.cycle.value?.isActive() == true)
        #expect(store.writeError == nil)
    }

    @Test("starting a cycle that is already running is refused")
    func startCycleTodayRefusesARunningCycle() async throws {
        let api = FixturePolarisClient()
        let store = CycleStore(api: api, cycle: try await api.cycle(id: "cy1"))
        await store.load()

        #expect(await store.startToday() == nil)
        #expect(store.writeError?.displayMessage == "Only an upcoming cycle can be started today.")
    }

    @Test("a cycle edited on its detail screen lands back in the team's list")
    func teamStoreTakesTheEditedCycle() async throws {
        let api = FixturePolarisClient()
        let team = TeamWorkStore(api: api, team: FixtureData.team)
        await team.load()
        #expect(team.cycles.value?.map(\.number) == [7, 8])

        let renamed = try await api.updateCycle(CycleChange(id: "cy1", name: "Renamed from detail"))
        team.apply(renamed)

        #expect(team.cycles.value?.first { $0.id == "cy1" }?.name == "Renamed from detail")
        // Still in number order, and still two of them.
        #expect(team.cycles.value?.map(\.number) == [7, 8])
    }

    // MARK: - The wrapper hole

    /// The hole this closes is in the test doubles, not in the product — the same one
    /// `BulkWriteTests.bulkReachesThroughAWrapper` closed for the bulk edit.
    ///
    /// `ParityStoreTests` and `FailuresThatSpeakTests` hold wrapper clients that forward the
    /// protocol operation by operation to an `inner` fixture. A protocol method with an
    /// extension default compiles in such a wrapper without being written down — and then
    /// answers `.unsupported`, from the default, rather than reaching `inner` at all. A store
    /// under that wrapper looks broken for a reason that has nothing to do with the store.
    ///
    /// So all four new operations are threaded through one here: each refuses on its own when
    /// the wrapper says so, and each reaches the client behind it when it does not.
    @Test("the four planning writes reach through a wrapper to the client behind it")
    func planningWritesReachThroughAWrapper() async throws {
        let api = PlanningRefusingClient()
        let workspace = WorkspaceDataStore(api: api)
        await workspace.load()

        await api.refuse(.rateLimited(retryAfter: nil))
        await #expect(throws: PolarisError.rateLimited(retryAfter: nil)) {
            try await workspace.create(ProjectDraft(name: "Through the wrapper", teamIds: ["t1"]))
        }

        await api.allow()
        let created = try await workspace.create(
            ProjectDraft(name: "Through the wrapper", statusId: "ps3", teamIds: ["t1"])
        )
        // Observed on `inner`, not on the store: proof the write went all the way down
        // rather than being satisfied somewhere in the middle.
        #expect(try await api.innerProjectName(created.id) == "Through the wrapper")

        let projectStore = ProjectStore(api: api, project: created)
        await api.refuse(.forbidden)
        #expect(await projectStore.update(ProjectChange(id: created.id, name: "No")) == nil)
        #expect(projectStore.writeError == .forbidden)
        #expect(projectStore.writeError != .unsupported("editing a project"),
                "the wrapper forwarded to the protocol's default instead of to its inner client")

        await api.allow()
        #expect(await projectStore.update(
            ProjectChange(id: created.id, name: "Edited through the wrapper")
        )?.name == "Edited through the wrapper")
        #expect(try await api.innerProjectName(created.id) == "Edited through the wrapper")

        let cycleStore = CycleStore(api: api, cycle: FixtureData.upcomingCycle)
        await api.refuse(.offline)
        #expect(await cycleStore.update(CycleChange(id: "cy2", name: "No")) == nil)
        #expect(cycleStore.writeError == .offline)
        #expect(cycleStore.writeError != .unsupported("editing a cycle"))
        #expect(await cycleStore.startToday() == nil)
        #expect(cycleStore.writeError != .unsupported("starting a cycle"))

        await api.allow()
        #expect(await cycleStore.update(CycleChange(id: "cy2", name: "Named"))?.name == "Named")
        #expect(await cycleStore.startToday()?.isActive() == true)
        #expect(await api.calls == ["createProject", "createProject", "updateProject",
                                    "updateProject", "updateCycle", "startCycleToday",
                                    "updateCycle", "startCycleToday"])
    }
}

/// A wrapper around the fixture that forwards the whole surface and can refuse the four
/// planning writes — the shape the existing suites' doubles have, written out here so the new
/// operations are ones somebody has actually threaded through one.
private actor PlanningRefusingClient: PolarisAPI {
    private let inner = FixturePolarisClient()
    private var refusal: PolarisError?
    /// Which of the four were asked for, in order. A method answered by the protocol's
    /// default never gets here, so an empty or short list is itself the failure.
    private(set) var calls: [String] = []

    func refuse(_ error: PolarisError) { refusal = error }
    func allow() { refusal = nil }
    func innerProjectName(_ id: String) async throws -> String { try await inner.project(id: id).name }

    func createProject(_ draft: ProjectDraft) async throws -> Project {
        calls.append("createProject")
        if let refusal { throw refusal }
        return try await inner.createProject(draft)
    }

    func updateProject(_ change: ProjectChange) async throws -> Project {
        calls.append("updateProject")
        if let refusal { throw refusal }
        return try await inner.updateProject(change)
    }

    func updateCycle(_ change: CycleChange) async throws -> Cycle {
        calls.append("updateCycle")
        if let refusal { throw refusal }
        return try await inner.updateCycle(change)
    }

    func startCycleToday(id: String, opId: String) async throws -> Cycle {
        calls.append("startCycleToday")
        if let refusal { throw refusal }
        return try await inner.startCycleToday(id: id, opId: opId)
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
    func labels() async throws -> [PolarisCore.Label] { try await inner.labels() }
    func projects() async throws -> [Project] { try await inner.projects() }
    func projectStatuses() async throws -> [ProjectStatus] { try await inner.projectStatuses() }
    func project(id: String) async throws -> Project { try await inner.project(id: id) }
    func cycles(teamId: String) async throws -> [Cycle] { try await inner.cycles(teamId: teamId) }
    func cycle(id: String) async throws -> Cycle { try await inner.cycle(id: id) }
    func favorites() async throws -> [Favorite] { try await inner.favorites() }
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
