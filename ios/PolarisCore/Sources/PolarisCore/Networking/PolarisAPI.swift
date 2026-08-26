import Foundation

/// What the server hands back from `/auth/login`, `/auth/refresh` and `/auth/dev-session` —
/// all three share one response shape.
public struct Session: Codable, Sendable, Hashable {
    public let accessToken: String
    /// Seconds. Default server TTL is 15 minutes.
    public let expiresIn: Int
    public let accountId: String
    public let workspaces: [Workspace]

    enum CodingKeys: String, CodingKey { case accessToken, expiresIn, accountId, workspaces }
}

/// Everything the app is allowed to ask the backend for.
///
/// One protocol with two implementations — live HTTP and bundled fixtures — so that screens,
/// stores and tests are written against the contract rather than against URLSession. The
/// swap happens once, at the composition root.
public protocol PolarisAPI: Sendable {
    // Auth
    func signInWithDevSession() async throws -> Session
    func signIn(email: String, password: String) async throws -> Session
    func signOut() async

    /// Which workspace subsequent calls are scoped to. Every GraphQL request carries it as
    /// `X-Polaris-Workspace`; without it the server resolves an account but no principal and
    /// every resolver refuses.
    func useWorkspace(id: String) async

    // Reads
    func viewer() async throws -> Viewer
    func syncVersion() async throws -> Int
    func myIssues(includeCompleted: Bool) async throws -> [Issue]
    func issues(teamId: String) async throws -> [Issue]
    func issue(id: String) async throws -> Issue
    func comments(issueId: String) async throws -> [Comment]
    func teams() async throws -> [Team]
    func workflowStates(teamId: String) async throws -> [WorkflowState]
    func users() async throws -> [User]
    func unreadNotificationCount() async throws -> Int

    // Writes
    func createIssue(_ draft: IssueDraft) async throws -> Issue
    func updateIssue(_ change: IssueChange) async throws -> Issue
    func createComment(issueId: String, body: String) async throws -> Comment
}

/// A new issue, as the composer collects it.
///
/// `id` is minted on the client — the schema accepts a client-supplied v7 UUID on
/// `createIssue` precisely so a create can be optimistic and still be honest about identity.
/// Paired with `opId`, a retry after a timeout replays the original result instead of
/// creating a second issue.
public struct IssueDraft: Sendable, Hashable {
    public let id: String
    public let opId: String
    public var teamId: String
    public var title: String
    public var description: String
    public var priority: Priority
    public var stateId: String?
    public var assigneeId: String?

    public init(
        id: String = UUIDv7.string(),
        opId: String = UUIDv7.string(),
        teamId: String,
        title: String,
        description: String = "",
        priority: Priority = .none,
        stateId: String? = nil,
        assigneeId: String? = nil
    ) {
        self.id = id
        self.opId = opId
        self.teamId = teamId
        self.title = title
        self.description = description
        self.priority = priority
        self.stateId = stateId
        self.assigneeId = assigneeId
    }
}

/// A partial update.
///
/// `clearAssignee` exists because nil in a partial update means "leave alone", so there is no
/// way to express "remove the assignee" with an optional alone. The server models it as a
/// separate boolean and so does this.
public struct IssueChange: Sendable, Hashable {
    public let id: String
    public let opId: String
    public var title: String?
    public var description: String?
    public var stateId: String?
    public var priority: Priority?
    public var assigneeId: String?
    public var clearAssignee: Bool

    public init(
        id: String,
        opId: String = UUIDv7.string(),
        title: String? = nil,
        description: String? = nil,
        stateId: String? = nil,
        priority: Priority? = nil,
        assigneeId: String? = nil,
        clearAssignee: Bool = false
    ) {
        self.id = id
        self.opId = opId
        self.title = title
        self.description = description
        self.stateId = stateId
        self.priority = priority
        self.assigneeId = assigneeId
        self.clearAssignee = clearAssignee
    }
}

/// The server requires a v7 UUID for client-minted issue ids, and Foundation has no v7
/// generator. Layout per RFC 9562: 48-bit big-endian milliseconds, version nibble 7, variant
/// bits 10, remainder random.
public enum UUIDv7 {
    public static func string(now: Date = Date(), randomness: @Sendable () -> UInt8 = { UInt8.random(in: 0...255) }) -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        let millis = UInt64(max(0, now.timeIntervalSince1970 * 1000))
        for index in 0..<6 {
            bytes[index] = UInt8truncating(millis >> (8 * (5 - index)))
        }
        for index in 6..<16 {
            bytes[index] = randomness()
        }
        bytes[6] = (bytes[6] & 0x0F) | 0x70   // version 7
        bytes[8] = (bytes[8] & 0x3F) | 0x80   // variant 10

        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        let ranges = [0..<8, 8..<12, 12..<16, 16..<20, 20..<32]
        return ranges
            .map { String(Array(hex)[$0]) }
            .joined(separator: "-")
    }

    private static func UInt8truncating(_ value: UInt64) -> UInt8 {
        UInt8(value & 0xFF)
    }
}
