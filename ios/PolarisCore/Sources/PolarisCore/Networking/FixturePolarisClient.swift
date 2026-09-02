import Foundation

/// An in-memory Polaris, for tests and SwiftUI previews.
///
/// The second implementation the protocol exists for. It holds the same shapes the live client
/// decodes, so a store driven by it exercises the real code path — sorting, optimistic writes,
/// rollback — without a server, a socket or a simulator.
///
/// `failNextWrite` is why this is an actor with mutable state rather than a struct of
/// constants: the behaviour most worth testing is what happens when a write *fails*, and that
/// is impossible to provoke against a real server without breaking one.
public actor FixturePolarisClient: PolarisAPI {
    public private(set) var storedIssues: [Issue]
    public private(set) var storedComments: [String: [Comment]]
    public private(set) var storedNotifications: [PolarisNotification]
    /// Comments already accepted, keyed by the caller's `opId`. The server is idempotent on
    /// this key and so is the double, because a retry posting twice is the bug the key exists
    /// to prevent.
    private var commentsByOpId: [String: Comment] = [:]
    private let people: [User]
    private let allTeams: [Team]
    private let states: [WorkflowState]

    /// When set, the next mutation throws this instead of applying. Cleared once it fires, so
    /// a test can assert both the failure and the recovery.
    private var failNextWrite: PolarisError?

    /// Whether the boot path finds a session. False makes the auth screens reachable, which
    /// they otherwise are not: `signInWithDevSession` always succeeding meant the app went
    /// straight to the issue list and welcome/sign-in/sign-up could not be driven at all.
    private let signedIn: Bool

    /// Whether that session belongs to a workspace. False is the state every first
    /// registration lands in, and the only route to the create-workspace screen.
    private let hasWorkspace: Bool

    public init(
        signedIn: Bool = true,
        hasWorkspace: Bool = true,
        issues: [Issue] = FixtureData.issues,
        people: [User] = FixtureData.users,
        teams: [Team] = [FixtureData.team],
        states: [WorkflowState] = FixtureData.states,
        comments: [String: [Comment]] = QAFixtureSwitches.seededComments,
        notifications: [PolarisNotification] = FixtureData.notifications
    ) {
        self.signedIn = signedIn
        self.hasWorkspace = hasWorkspace
        self.storedIssues = issues
        self.people = people
        self.allTeams = teams
        self.states = states
        self.storedComments = comments
        self.storedNotifications = notifications
        if let armed = QAFixtureSwitches.armedWriteFailure { self.failNextWrite = armed }
    }

    public func setFailNextWrite(_ error: PolarisError?) {
        failNextWrite = error
    }

    private func consumeFailure() throws {
        if let failNextWrite {
            self.failNextWrite = nil
            throw failNextWrite
        }
    }

    // MARK: - Auth

    public func signInWithDevSession() async throws -> Session {
        guard signedIn else { throw PolarisError.forbidden }
        return session()
    }

    private func session() -> Session {
        Session(
            accessToken: "fixture",
            expiresIn: 900,
            accountId: "account",
            // No workspaces is what puts AppModel into `.needsWorkspace`.
            workspaces: hasWorkspace ? [FixtureData.workspace] : []
        )
    }

    public func signIn(email: String, password: String) async throws -> Session {
        guard password == "correct-horse" else {
            throw PolarisError.unauthorized("incorrect email or password")
        }
        return session()
    }

    public func signInWithApple(
        idToken: String,
        nonce: String,
        displayName: String?
    ) async throws -> Session {
        // The fixture cannot verify anything, so it stands in for the one thing the screen
        // has to handle: an assertion arrives, or it does not. An empty token is what a
        // cancelled or failed authorisation looks like by the time it reaches here.
        guard !idToken.isEmpty else {
            throw PolarisError.unauthorized("that sign-in could not be verified")
        }
        return session()
    }

    public func register(
        email: String,
        password: String,
        inviteToken: String?,
        displayName: String?
    ) async throws -> Session {
        guard password.count >= 8 else {
            throw PolarisError.validation(message: "Password must be at least 8 characters", field: "password")
        }
        return session()
    }

    public func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace {
        try consumeFailure()
        return FixtureData.workspace
    }

    public func restoreSession() async throws -> Session {
        throw PolarisError.unauthorized(nil)
    }

    @discardableResult
    public func signOut() async -> PolarisError? { nil }
    public func useWorkspace(id: String) async {}

    // MARK: - Reads

    public func viewer() async throws -> Viewer {
        Viewer(
            user: people[0],
            workspace: FixtureData.workspace,
            workspaces: [FixtureData.workspace],
            syncVersion: 1
        )
    }

    public func syncVersion() async throws -> Int { 1 }

    public func myIssues(includeCompleted: Bool) async throws -> [Issue] {
        includeCompleted ? storedIssues : storedIssues.filter { $0.state.category.isOpen }
    }

    public func issues(teamId: String) async throws -> [Issue] {
        storedIssues.filter { $0.team.id == teamId }
    }

    public func issue(id: String) async throws -> Issue {
        guard let match = storedIssues.first(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        return match
    }

    public func comments(issueId: String) async throws -> [Comment] {
        storedComments[issueId] ?? []
    }

    public func teams() async throws -> [Team] { allTeams }
    public func workflowStates(teamId: String) async throws -> [WorkflowState] {
        QAFixtureSwitches.noStates ? [] : states
    }
    public func users() async throws -> [User] { people }

    public func unreadNotificationCount() async throws -> Int {
        storedNotifications.filter { !$0.isRead }.count
    }

    public func notifications(
        includeRead: Bool,
        includeSnoozed: Bool,
        first: Int?
    ) async throws -> [PolarisNotification] {
        var list = storedNotifications
        if !includeRead { list = list.filter { !$0.isRead } }
        if !includeSnoozed { list = list.filter { $0.snoozedUntil == nil } }
        list.sort { $0.createdAt > $1.createdAt }
        if let first { list = Array(list.prefix(first)) }
        return list
    }

    /// Substring matching over title, identifier and description.
    ///
    /// Not the server's tokeniser and not pretending to be: what a double owes a search screen
    /// is that a query narrows the list, that an empty result set is reachable, and that
    /// `issueCount` and `issues.count` can disagree — all three of which drive a branch in the
    /// UI.
    public func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return SearchResults(issues: [], issueCount: 0) }
        var hits = storedIssues.filter { issue in
            issue.title.lowercased().contains(needle)
                || issue.identifier.lowercased().contains(needle)
                || issue.description.lowercased().contains(needle)
        }
        if let teamId { hits = hits.filter { $0.team.id == teamId } }
        let total = hits.count
        if let first { hits = Array(hits.prefix(first)) }
        return SearchResults(issues: hits, issueCount: total)
    }

    // MARK: - Writes

    public func createIssue(_ draft: IssueDraft) async throws -> Issue {
        try consumeFailure()
        let created = FixtureData.issue(
            id: draft.id,
            identifier: "ENG-\(storedIssues.count + 1)",
            title: draft.title,
            priority: draft.priority,
            state: states.first(where: { $0.id == draft.stateId }) ?? states[0],
            // Honoured, not dropped. The composer defaults to assigning the issue to the
            // creator precisely because MyIssues filters on assignee — a double that ignores
            // the field cannot show whether that default works, which is the whole point of
            // the test that exercises it.
            assignee: draft.assigneeId.flatMap { id in people.first { $0.id == id } }
        )
        storedIssues.append(created)
        return created
    }

    public func updateIssue(_ change: IssueChange) async throws -> Issue {
        try consumeFailure()
        guard let index = storedIssues.firstIndex(where: { $0.id == change.id }) else {
            throw PolarisError.notFound
        }
        // Mutated, not rebuilt. Rebuilding through FixtureData.issue silently dropped
        // description, labels, estimate, dueDate and timestamps, so any property change made
        // the description vanish — which reads as a product bug and is a defect in the double.
        var updated = storedIssues[index]
        if let stateId = change.stateId, let next = states.first(where: { $0.id == stateId }) {
            updated.state = next
        }
        if let priority = change.priority {
            updated.priority = priority
        }
        if change.clearAssignee {
            updated.assignee = nil
        } else if let assigneeId = change.assigneeId {
            updated.assignee = people.first { $0.id == assigneeId }
        }
        storedIssues[index] = updated
        return updated
    }

    /// Idempotent on `opId`, like the server.
    ///
    /// Without this the double cannot show the difference the fix is about: a retry with the
    /// same `opId` must return the original comment, not append a second one.
    public func createComment(issueId: String, body: String, opId: String) async throws -> Comment {
        if let existing = commentsByOpId[opId] { return existing }
        try consumeFailure()
        let comment = FixtureData.comment(body: body)
        commentsByOpId[opId] = comment
        storedComments[issueId, default: []].append(comment)
        return comment
    }

    public func archiveIssue(id: String, archived: Bool, opId: String) async throws {
        try consumeFailure()
        guard let index = storedIssues.firstIndex(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        if archived { storedIssues.remove(at: index) }
    }

    public func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification {
        try consumeFailure()
        guard let index = storedNotifications.firstIndex(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        var updated = storedNotifications[index]
        updated.readAt = read ? Date() : nil
        storedNotifications[index] = updated
        return updated
    }

    public func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification {
        try consumeFailure()
        guard let index = storedNotifications.firstIndex(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        var updated = storedNotifications[index]
        updated.snoozedUntil = until
        storedNotifications[index] = updated
        return updated
    }

    public func deleteNotification(id: String) async throws {
        try consumeFailure()
        guard storedNotifications.contains(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        storedNotifications.removeAll { $0.id == id }
    }
}

/// Canned entities.
///
/// Built by decoding JSON rather than by memberwise initialisers, deliberately: the wire types
/// decode from JSON in production and several have a custom `init(from:)` with defaulting
/// behaviour. Fixtures built any other way would not exercise that code, and would keep
/// passing after a decoding bug was introduced.
public enum FixtureData {
    public static let workspace: Workspace = decoded(
        "{\"id\":\"w1\",\"name\":\"\(QAFixtureSwitches.workspaceName)\","
            + "\"urlKey\":\"\(QAFixtureSwitches.workspaceKey)\",\"plan\":\"\(QAFixtureSwitches.plan)\"}"
    )

    // Delimited with ##"…"## rather than #"…"#: the colour value starts with `#` directly
    // after a quote, and `"#` would otherwise close the literal in the middle of the JSON.
    public static let team: Team = decoded(
        ##"{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF"}"##
    )

    public static let states: [WorkflowState] = decoded("""
    [{"id":"s1","name":"Backlog","color":"#9AA0A6","category":"BACKLOG","position":"a"},
     {"id":"s2","name":"Todo","color":"#9AA0A6","category":"UNSTARTED","position":"b"},
     {"id":"s3","name":"In Progress","color":"#F5B700","category":"STARTED","position":"c"},
     {"id":"s4","name":"Done","color":"#3FB950","category":"COMPLETED","position":"d"}]
    """)

    public static let users: [User] = decoded("""
    [{"id":"u1","name":"miguel","displayName":"Miguel Peixoto","avatarUrl":null,"email":"dev@polaris.local"},
     {"id":"u2","name":"ana","displayName":"Ana Silva","avatarUrl":null,"email":null}]
    """)

    /// The issue set, selected by launch argument.
    ///
    /// With no `-qa-*` argument this is the original four issues, so ordinary runs are
    /// unaffected. Statics are lazy in Swift, so this reads the arguments after the process
    /// has them.
    public static let issues: [Issue] = {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-qa-empty") { return [] }
        if arguments.contains("-qa-only-completed") { return completedOnlyIssues }
        if arguments.contains("-qa-stress") { return stressIssues }
        return baseIssues
    }()

    public static let baseIssues: [Issue] = [
        issue(id: "i1", identifier: "ENG-1", title: "Sync drops a comment on reconnect",
              priority: .urgent, state: states[2], assignee: users[0]),
        issue(id: "i2", identifier: "ENG-2", title: "Command menu forgets its last action",
              priority: .medium, state: states[1]),
        issue(id: "i3", identifier: "ENG-3", title: "Ship the iOS client",
              priority: .high, state: states[0], assignee: users[1]),
        issue(id: "i4", identifier: "ENG-4", title: "Retire the old exporter",
              priority: Priority.none, state: states[3]),
    ]

    /// Everything assigned is finished, so the default filter renders an empty list.
    public static let completedOnlyIssues: [Issue] = [
        issue(id: "c1", identifier: "ENG-1", title: "Retire the old exporter",
              priority: .high, state: states[3], assignee: users[0]),
        issue(id: "c2", identifier: "ENG-2", title: "Delete the dead feature flag",
              priority: Priority.none, state: states[3], assignee: users[0]),
    ]

    /// Volume plus the layout edge cases: a title far past two lines, five labels where the
    /// row shows two, no assignee, a long identifier, every priority, and a due date.
    public static let stressIssues: [Issue] = {
        let longTitle = "A deliberately enormous issue title that keeps going well past any "
            + "reasonable two-line clamp so the row has to decide what to do about it, and "
            + "then keeps going a good deal further still just to be certain"
        var list: [Issue] = [
            qaIssue(id: "x1", identifier: "PLATFORM-100234", title: longTitle,
                    priority: .urgent, state: states[2], assignee: nil, labelCount: 5,
                    dueDate: "2026-09-30"),
            qaIssue(id: "x2", identifier: "ENG-2", title: "Row with five labels and no assignee",
                    priority: .high, state: states[1], assignee: nil, labelCount: 5),
            qaIssue(id: "x3", identifier: "INFRASTRUCTURE-9912",
                    title: "Unbroken token: Supercalifragilisticexpialidocious_Antidisestablishmentarianism_Pneumonoultramicroscopicsilicovolcanoconiosis",
                    priority: .low, state: states[0], assignee: users[1], labelCount: 1),
            qaIssue(id: "x4", identifier: "ENG-4", title: "No priority, sorts last among open",
                    priority: Priority.none, state: states[1], assignee: users[0], labelCount: 0),
        ]
        // Enough rows to scroll several screens, so the stagger can be watched under a flick.
        let cycle: [Priority] = [.urgent, .high, .medium, .low, Priority.none]
        for index in 0..<40 {
            list.append(
                qaIssue(
                    id: "v\(index)", identifier: "ENG-\(100 + index)",
                    title: "Volume row \(index) — enough text to occupy a full line of the row",
                    priority: cycle[index % cycle.count],
                    state: states[index % 3],
                    assignee: index.isMultiple(of: 2) ? users[0] : nil,
                    labelCount: index % 4
                )
            )
        }
        // One completed issue so "Show completed" has something to reveal at this volume.
        list.append(
            qaIssue(id: "vdone", identifier: "ENG-999", title: "Finished, and hidden by default",
                    priority: .urgent, state: states[3], assignee: users[0], labelCount: 2)
        )
        return list
    }()

    /// Like `issue(...)` but able to attach labels and a due date, which the row renders and
    /// the original builder cannot express.
    public static func qaIssue(
        id: String,
        identifier: String,
        title: String,
        priority: Priority,
        state: WorkflowState,
        assignee: User?,
        labelCount: Int,
        dueDate: String? = nil
    ) -> Issue {
        let names = ["backend", "needs-design", "regression", "customer-reported", "p0-escalation"]
        let colors = ["#5B8DEF", "#F5B700", "#3FB950", "#EF5B5B", "#B65BEF"]
        let labels = (0..<max(0, min(labelCount, names.count))).map { index in
            "{\"id\":\"l\(id)-\(index)\",\"name\":\"\(names[index])\",\"color\":\"\(colors[index])\"}"
        }
        let assigneeJSON = assignee.map {
            "{\"id\":\"\($0.id)\",\"name\":\"\($0.name)\",\"displayName\":\"\($0.displayName)\",\"avatarUrl\":null,\"email\":null}"
        } ?? "null"
        let stateJSON = "{\"id\":\"\(state.id)\",\"name\":\"\(state.name)\",\"color\":\"\(state.color)\",\"category\":\"\(state.category.rawValue)\",\"position\":\"\(state.position)\"}"
        let dueJSON = dueDate.map { "\"\($0)\"" } ?? "null"
        return decoded("""
        {"id":"\(id)","identifier":"\(identifier)","title":"\(title)","description":"",
         "priority":\(priority.rawValue),"estimate":null,"dueDate":\(dueJSON),
         "state":\(stateJSON),
         "team":{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF"},
         "assignee":\(assigneeJSON),"creator":null,"labels":[\(labels.joined(separator: ","))],
         "createdAt":"2026-08-01T09:00:00Z","updatedAt":"2026-08-20T09:00:00Z"}
        """)
    }
    // ===== end QA-ONLY =====

    public static func issue(
        id: String,
        identifier: String,
        title: String,
        priority: Priority,
        state: WorkflowState,
        assignee: User? = nil
    ) -> Issue {
        let assigneeJSON = assignee.map {
            "{\"id\":\"\($0.id)\",\"name\":\"\($0.name)\",\"displayName\":\"\($0.displayName)\",\"avatarUrl\":null,\"email\":null}"
        } ?? "null"
        let stateJSON = "{\"id\":\"\(state.id)\",\"name\":\"\(state.name)\",\"color\":\"\(state.color)\",\"category\":\"\(state.category.rawValue)\",\"position\":\"\(state.position)\"}"
        return decoded("""
        {"id":"\(id)","identifier":"\(identifier)","title":"\(title)","description":"",
         "priority":\(priority.rawValue),"estimate":null,"dueDate":null,
         "state":\(stateJSON),
         "team":{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF"},
         "assignee":\(assigneeJSON),"creator":null,"labels":[],
         "createdAt":"2026-08-01T09:00:00Z","updatedAt":"2026-08-20T09:00:00Z"}
        """)
    }

    /// The inbox, as the fixture serves it: one unread mention, one unread assignment, and
    /// one already-read status change — enough for the list to show both row states and for a
    /// badge to be non-zero.
    ///
    /// `-qa-empty-inbox` empties it, which is the state the inbox's own empty view exists for
    /// and the one a stock fixture can never reach.
    public static let notifications: [PolarisNotification] = {
        if ProcessInfo.processInfo.arguments.contains("-qa-empty-inbox") { return [] }
        let issues = FixtureData.issues
        guard !issues.isEmpty else { return [] }
        return [
            notification(id: "n1", type: "MENTION", issue: issues[0],
                         at: "2026-08-25T09:00:00Z", readAt: nil),
            notification(id: "n2", type: "ISSUE_ASSIGNED", issue: issues.count > 1 ? issues[1] : issues[0],
                         at: "2026-08-24T16:30:00Z", readAt: nil),
            notification(id: "n3", type: "ISSUE_STATUS_CHANGED", issue: issues[0],
                         at: "2026-08-23T11:00:00Z", readAt: "2026-08-23T12:00:00Z"),
        ]
    }()

    public static func notification(
        id: String,
        type: String,
        issue: Issue?,
        at: String,
        readAt: String?
    ) -> PolarisNotification {
        // Re-encoded rather than hand-built, for the reason the whole file gives: the wire
        // type has a custom `init(from:)` and a fixture that skips it would keep passing
        // after a decoding bug was introduced.
        let issueJSON: String
        if let issue, let data = try? PolarisJSON.encoder().encode(issue),
           let text = String(data: data, encoding: .utf8) {
            issueJSON = text
        } else {
            issueJSON = "null"
        }
        let readJSON = readAt.map { "\"\($0)\"" } ?? "null"
        return decoded("""
        {"id":"\(id)","type":"\(type)","issueId":\(issue.map { "\"\($0.id)\"" } ?? "null"),
         "commentId":null,"actor":{"type":"USER","id":"u2"},"count":1,
         "readAt":\(readJSON),"snoozedUntil":null,"createdAt":"\(at)","issue":\(issueJSON)}
        """)
    }

    public static func comment(body: String) -> Comment {
        decoded("""
        {"id":"\(UUIDv7.string())","body":"\(body)",
         "actor":{"type":"USER","id":"u1"},"editedAt":null,"createdAt":"2026-08-20T10:00:00Z"}
        """)
    }

    /// Force-decodes. A malformed fixture is a programming error in this file, not a runtime
    /// condition, and failing loudly here beats every test failing somewhere confusing.
    private static func decoded<T: Decodable>(_ json: String) -> T {
        do {
            return try PolarisJSON.decoder().decode(T.self, from: Data(json.utf8))
        } catch {
            fatalError("fixture JSON does not decode as \(T.self): \(error)")
        }
    }

    public static func issue(
        id: String,
        identifier: String,
        title: String,
        priority: Priority,
        state: WorkflowState,
        assignee: User? = nil,
        description: String = ""
    ) -> Issue {
        let assigneeJSON = assignee.map {
            "{\"id\":\"\($0.id)\",\"name\":\"\($0.name)\",\"displayName\":\"\($0.displayName)\",\"avatarUrl\":null,\"email\":null}"
        } ?? "null"
        let stateJSON = "{\"id\":\"\(state.id)\",\"name\":\"\(state.name)\",\"color\":\"\(state.color)\",\"category\":\"\(state.category.rawValue)\",\"position\":\"\(state.position)\"}"
        return decoded("""
        {"id":"\(id)","identifier":"\(identifier)","title":"\(title)","description":"\(description)",
         "priority":\(priority.rawValue),"estimate":null,"dueDate":null,
         "state":\(stateJSON),
         "team":{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF"},
         "assignee":\(assigneeJSON),"creator":null,"labels":[],
         "createdAt":"2026-08-01T09:00:00Z","updatedAt":"2026-08-20T09:00:00Z"}
        """)
    }

}


/// Launch-argument switches that reshape the fixture for a QA pass.
///
/// The states worth testing on the detail and settings screens are exactly the ones the stock
/// fixture cannot produce: a team with no workflow states, a write the server refuses, a plan
/// string other than `pro`, a title long enough to wrap, comments by an author who is not in
/// the loaded user list. Each is a launch argument rather than a constructor parameter because
/// a UI test drives the app as a process and cannot reach the composition root.
///
/// Read only by `FixturePolarisClient`, which is already the test/preview double — no shipping
/// code path consults these.
public enum QAFixtureSwitches {
    private static var args: [String] { ProcessInfo.processInfo.arguments }

    private static func value(_ flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    public static var plan: String { value("-qa-plan") ?? "pro" }
    public static var noStates: Bool { args.contains("-qa-no-states") }

    public static var armedWriteFailure: PolarisError? {
        args.contains("-qa-fail-writes")
            ? .server(status: 500, message: "Polaris had a problem handling that.")
            : nil
    }

    public static var workspaceName: String {
        args.contains("-qa-long-names")
            ? "The Extremely Long Peixoto Laboratories Research And Development Workspace"
            : "Peixoto Labs"
    }

    public static var workspaceKey: String {
        args.contains("-qa-long-names")
            ? "peixoto-laboratories-research-and-development-workspace-primary"
            : "peixotolabs"
    }

    public static var firstIssueTitle: String {
        args.contains("-qa-long-text")
            ? "Sync drops a comment on reconnect when the websocket is resumed after a long "
                + "background period and the client replays its outbox against a watermark that "
                + "the server has already advanced past, which loses the comment silently"
            : "Sync drops a comment on reconnect"
    }

    public static var firstIssueDescription: String {
        args.contains("-qa-long-text")
            ? "Steps: put the app in the background for ten minutes, post a comment while "
                + "offline, then bring it back. Expected the comment to arrive. Actual: it is "
                + "dropped with no error anywhere. This paragraph is deliberately long so the "
                + "detail screen has to lay out a real description rather than an empty string, "
                + "and so the scroll view is exercised past one screenful of content."
            : ""
    }

    public static var seededComments: [String: [Comment]] {
        guard args.contains("-qa-comments") else { return [:] }
        return ["i1": [
            qaComment(id: "c1", actorType: "USER", actorId: "u2",
                      body: "Reproduced on 2026-08-19.", at: "2026-08-19T10:00:00Z"),
            qaComment(
                id: "c2",
                actorType: "USER", actorId: "u404",
                body: "This comment's author is not in the loaded user list.",
                at: "2026-08-19T11:00:00Z"
            ),
            qaComment(id: "c3", actorType: "INTEGRATION", actorId: "gh",
                      body: "Linked pull request #481.", at: "2026-08-19T12:00:00Z"),
            qaComment(id: "c4", actorType: "SYSTEM", actorId: nil,
                      body: "Moved to In Progress.", at: "2026-08-19T13:00:00Z"),
            qaComment(
                id: "c5", actorType: "USER", actorId: "u1",
                body: "A very long body. " + String(repeating: "The reconnect path replays the outbox and the watermark has already moved. ", count: 12),
                at: "2026-08-19T14:00:00Z"
            ),
        ]]
    }

    private static func qaComment(
        id: String,
        actorType: String = "USER",
        actorId: String? = "u1",
        body: String,
        at: String
    ) -> Comment {
        let actorIdJSON = actorId.map { "\"\($0)\"" } ?? "null"
        let json = """
        {"id":"\(id)","body":"\(body)",
         "actor":{"type":"\(actorType)","id":\(actorIdJSON)},"editedAt":null,"createdAt":"\(at)"}
        """
        return try! PolarisJSON.decoder().decode(Comment.self, from: Data(json.utf8))
    }
}
