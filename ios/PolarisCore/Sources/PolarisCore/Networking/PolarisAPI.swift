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
    /// Trades an Apple ID token for a session.
    ///
    /// The token is what `ASAuthorizationAppleIDCredential` hands back; the server checks its
    /// signature against Apple's published keys, so nothing secret travels and nothing here
    /// has to be trusted.
    ///
    /// `displayName` is Apple's one-time gift. The name comes back on the very first
    /// authorisation for this app and never again, so a client that drops it there has lost
    /// it for good — which is why it is a parameter rather than something read later.
    func signInWithApple(idToken: String, nonce: String, displayName: String?) async throws -> Session
    /// Creates an account.
    ///
    /// `inviteToken` is what admits the caller on a default install: registration mode is
    /// `invite`, under which exactly two people may register — somebody holding an invitation,
    /// and the very first account on an empty server. The token rides along with the
    /// credentials rather than being redeemed separately so the account and the workspace
    /// membership are one transaction.
    func register(email: String, password: String, inviteToken: String?, displayName: String?) async throws -> Session
    /// Creates a workspace and its first team, for an account that belongs to none.
    func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace
    /// Trades the stored refresh cookie for a new session, or throws if there is none.
    ///
    /// URLSession persists the cookie across launches, so this is what stops the app asking
    /// for a password every time it is opened.
    func restoreSession() async throws -> Session
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


/// A new workspace, as the create screen collects it.
///
/// The server derives nothing: it wants the workspace name and URL key, the creator's own
/// name and timezone, and the first team's key and name, all in one call. `decodeJSON` is
/// configured with `DisallowUnknownFields`, so this must carry exactly the keys the handler
/// declares and no others.
public struct WorkspaceDraft: Sendable, Hashable {
    public var name: String
    public var urlKey: String
    public var userName: String
    public var userDisplayName: String
    public var userTimezone: String
    public var firstTeamKey: String
    public var firstTeamName: String

    public init(
        name: String,
        urlKey: String,
        userName: String,
        userDisplayName: String,
        userTimezone: String = TimeZone.current.identifier,
        firstTeamKey: String,
        firstTeamName: String
    ) {
        self.name = name
        self.urlKey = urlKey
        self.userName = userName
        self.userDisplayName = userDisplayName
        self.userTimezone = userTimezone
        self.firstTeamKey = firstTeamKey
        self.firstTeamName = firstTeamName
    }
}

/// Turns a workspace name into a URL key, and a team name into a team key.
///
/// Both are derived as the user types and stop following once they edit the derived field by
/// hand — the same rule the web client's CreateWorkspace screen uses. Deriving forever would
/// overwrite a deliberate choice on the next keystroke of the name.
///
/// **These mirror server regexes and must keep mirroring them**, because a key this produces
/// that the server refuses is a dead end on the very first screen of a fresh install:
///
///   urlKey   ^[a-z0-9][a-z0-9-]{1,47}$     (workspace.go:19)  — ASCII only, at least 2 chars
///   teamKey  ^[A-Z][A-Z0-9]{0,7}$          (team.go:20)       — ASCII only, must start alpha
///
/// `Character.isLetter`/`isNumber` accept the whole Unicode letter and number classes, so an
/// earlier version derived `café-ltd` from "Café Ltd" and `МИР` from "Мир" — both refused by
/// the server — and `3MD` from "3M Design", refused for starting with a digit.
public enum KeyDerivation {
    /// Lowercase ASCII alphanumerics and single hyphens. `"Peixoto Labs"` -> `"peixoto-labs"`.
    ///
    /// Returns "" when nothing usable survives, which the caller must treat as "not ready"
    /// rather than sending it.
    public static func urlKey(from name: String) -> String {
        var out = ""
        var lastWasHyphen = true          // leading hyphens are dropped
        // Fold accents first, so "Café" contributes "cafe" instead of losing the é entirely.
        let folded = name.folding(options: [.diacriticInsensitive], locale: .init(identifier: "en_US"))
        for character in folded.lowercased() {
            if character.isASCII && (character.isLetter || character.isNumber) {
                out.append(character)
                lastWasHyphen = false
            } else if !lastWasHyphen {
                out.append("-")
                lastWasHyphen = true
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        out = String(out.prefix(48))
        // The pattern demands a second character. A one-character name is legitimate, so pad
        // rather than refuse — "X" becomes "x-1", which is ugly and accepted, where "x" is
        // tidy and rejected.
        if out.count == 1 { out += "-1" }
        return out
    }

    /// Up to three uppercase ASCII characters, always starting with a letter.
    /// `"Engineering"` -> `"ENG"`, `"3M Design"` -> `"MD"`.
    public static func teamKey(from name: String) -> String {
        let folded = name.folding(options: [.diacriticInsensitive], locale: .init(identifier: "en_US"))
        var characters = Array(folded.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
        // Digits are legal *inside* a key but not as the first character, so lead with the
        // first letter and keep whatever follows.
        while let first = characters.first, !first.isLetter {
            characters.removeFirst()
        }
        return String(characters.prefix(3))
    }
}
