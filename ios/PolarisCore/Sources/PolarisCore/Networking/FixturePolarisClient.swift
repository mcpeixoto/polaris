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
    private let people: [User]
    private let allTeams: [Team]
    private let states: [WorkflowState]

    /// When set, the next mutation throws this instead of applying. Cleared once it fires, so
    /// a test can assert both the failure and the recovery.
    private var failNextWrite: PolarisError?

    public init(
        issues: [Issue] = FixtureData.issues,
        people: [User] = FixtureData.users,
        teams: [Team] = [FixtureData.team],
        states: [WorkflowState] = FixtureData.states,
        comments: [String: [Comment]] = [:]
    ) {
        self.storedIssues = issues
        self.people = people
        self.allTeams = teams
        self.states = states
        self.storedComments = comments
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
        Session(
            accessToken: "fixture", expiresIn: 900, accountId: "account",
            workspaces: [FixtureData.workspace]
        )
    }

    public func signIn(email: String, password: String) async throws -> Session {
        guard password == "correct-horse" else { throw PolarisError.unauthorized("incorrect email or password") }
        return try await signInWithDevSession()
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
        return try await signInWithDevSession()
    }

    public func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace {
        try consumeFailure()
        return FixtureData.workspace
    }

    public func restoreSession() async throws -> Session {
        throw PolarisError.unauthorized(nil)
    }

    public func signOut() async {}
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
    public func workflowStates(teamId: String) async throws -> [WorkflowState] { states }
    public func users() async throws -> [User] { people }
    public func unreadNotificationCount() async throws -> Int { 0 }

    // MARK: - Writes

    public func createIssue(_ draft: IssueDraft) async throws -> Issue {
        try consumeFailure()
        let created = FixtureData.issue(
            id: draft.id,
            identifier: "ENG-\(storedIssues.count + 1)",
            title: draft.title,
            priority: draft.priority,
            state: states.first(where: { $0.id == draft.stateId }) ?? states[0]
        )
        storedIssues.append(created)
        return created
    }

    public func updateIssue(_ change: IssueChange) async throws -> Issue {
        try consumeFailure()
        guard let index = storedIssues.firstIndex(where: { $0.id == change.id }) else {
            throw PolarisError.notFound
        }
        let existing = storedIssues[index]
        let updated = FixtureData.issue(
            id: existing.id,
            identifier: existing.identifier,
            title: change.title ?? existing.title,
            priority: change.priority ?? existing.priority,
            state: change.stateId.flatMap { id in states.first { $0.id == id } } ?? existing.state,
            assignee: change.clearAssignee
                ? nil
                : (change.assigneeId.flatMap { id in people.first { $0.id == id } } ?? existing.assignee)
        )
        storedIssues[index] = updated
        return updated
    }

    public func createComment(issueId: String, body: String) async throws -> Comment {
        try consumeFailure()
        let comment = FixtureData.comment(body: body)
        storedComments[issueId, default: []].append(comment)
        return comment
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
        #"{"id":"w1","name":"Peixoto Labs","urlKey":"peixotolabs","plan":"pro"}"#
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

    // ===== QA-ONLY (temporary, added for a QA sweep of the issue list) =====
    // `issues` was a `let` holding the four-issue array inline. It still is a `let`; it just
    // picks an edge-case set when a `-qa-*` launch argument is present. With no such argument
    // the value is byte-for-byte the original four-issue set. Statics are lazy in Swift, so
    // this reads the launch arguments after the process has them.
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
}
