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

/// Which sign-in providers a deployment offers, from `GET /auth/providers`.
///
/// A fact about the server, not about the person: Google is configured with an audience list
/// or it is not, and on a self-hosted install without one `POST /auth/oidc/google` answers
/// 404. Asking first is what stops the app drawing a button that completes a whole sign-in at
/// Google and then fails against a route that does not exist.
///
/// The response also carries `googleClientId` and `appleClientId`. Both are ignored here:
/// they are the *browser* clients the web SDKs need, and this app has its own — a Google iOS
/// client (`GoogleSignIn.clientID`) and the bundle id Apple uses natively.
public struct AuthProviders: Decodable, Sendable, Hashable {
    public let providers: [String]
    /// Whether a stranger may create an account. Not read yet; decoded because the server
    /// sends it and a client that drops it has to ask again the day a screen wants it.
    public let openSignup: Bool

    public init(providers: [String], openSignup: Bool = false) {
        self.providers = providers
        self.openSignup = openSignup
    }

    /// Matched by name rather than by decoding into an enum: a server that grows a third
    /// provider must not break a client that has never heard of it.
    public var offersGoogle: Bool { providers.contains("google") }
    public var offersApple: Bool { providers.contains("apple") }
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
    /// Signs out locally whatever the server says, and reports a server-side logout that did
    /// not land. Non-throwing on purpose: the local half must happen even when the network
    /// does not, and a `throws` here invites a caller to skip it.
    @discardableResult
    func signOut() async -> PolarisError?

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
    /// The inbox. `includeSnoozed` is false by default at every call site: a snoozed row that
    /// still appears is a snooze that did nothing.
    func notifications(includeRead: Bool, includeSnoozed: Bool, first: Int?) async throws -> [PolarisNotification]
    /// Full-text search, server-side. The same `search` query the web client uses, so a phrase
    /// that finds an issue on a laptop finds it on a phone.
    func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults

    // Writes
    func createIssue(_ draft: IssueDraft) async throws -> Issue
    func updateIssue(_ change: IssueChange) async throws -> Issue
    /// `opId` is a parameter rather than something minted inside the transport, for the same
    /// reason `IssueDraft.opId` is: it must stay *stable across retries*, and a value the
    /// transport generates is a new one on every attempt. Minting it inside the call made the
    /// retry-idempotency guarantee the README claims untrue for comments specifically — a
    /// retry after a timeout posted the comment twice.
    func createComment(issueId: String, body: String, opId: String) async throws -> Comment
    func archiveIssue(id: String, archived: Bool, opId: String) async throws
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification
    /// `until` nil un-snoozes, which is what the schema's nullable `Time` means.
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification
    func deleteNotification(id: String) async throws

    /// Which sign-in providers this deployment offers. Anonymous — the whole point is that
    /// the caller has no session yet. Defaulted below, so the doubles the tests hold are not
    /// obliged to answer a question about a server they are standing in for.
    func authProviders() async throws -> AuthProviders
    /// Trades a Google ID token for a session, exactly as `signInWithApple` does.
    ///
    /// The token is what the PKCE exchange in `GoogleSignIn` ends with; the server checks it
    /// against Google's published keys, so nothing secret travels. `nonce` is the value bound
    /// into the authorization request and echoed into the token's claim — sent raw, because
    /// the server compares the two strings.
    func signInWithGoogle(idToken: String, nonce: String, displayName: String?) async throws -> Session

    // MARK: Parity with the Linear iOS app
    //
    // Everything below has a default in the extension that follows, so a narrower double —
    // the refusing clients the tests hold — is not obliged to spell out an operation it will
    // never be asked for. The two real implementations override every one of them.

    // Reads
    /// "My issues" by relationship, not only by assignment. `.assigned` is the existing
    /// `myIssues` query; the other two have no dedicated query — see `LivePolarisClient`.
    func myIssues(scope: MyIssuesScope, includeCompleted: Bool) async throws -> [Issue]
    /// The issue with everything the detail screen shows hanging off it, in one round trip.
    func issueDetail(id: String) async throws -> IssueDetail
    func issueHistory(issueId: String) async throws -> [IssueHistoryEntry]
    /// `ENG-123` to an issue, for a deep link and for the search box's pinned hit.
    func issueByIdentifier(_ identifier: String) async throws -> Issue
    /// Every label the caller can see: workspace labels plus those of their teams.
    func labels() async throws -> [Label]
    func projects() async throws -> [Project]
    func projectStatuses() async throws -> [ProjectStatus]
    func project(id: String) async throws -> Project
    func cycles(teamId: String) async throws -> [Cycle]
    func cycle(id: String) async throws -> Cycle
    func favorites() async throws -> [Favorite]
    /// `search` with a filter AST beside the words — see `IssueFilter`. Nil is the plain
    /// three-argument search.
    func search(query: String, teamId: String?, first: Int?, filter: JSONValue?) async throws -> SearchResults
    /// The viewer's own delivery preferences.
    func notificationPrefs() async throws -> NotificationPrefs

    // Writes. The `opId` rule above applies to every one that takes one.
    func addFavorite(kind: FavoriteKind, targetId: String) async throws -> Favorite
    func removeFavorite(kind: FavoriteKind, targetId: String) async throws
    /// Moves the issue to the trash. Distinct from `archiveIssue`: an archived issue is
    /// still readable, a deleted one is only in the restore window.
    func deleteIssue(id: String, opId: String) async throws
    func updateComment(id: String, body: String, opId: String) async throws -> Comment
    func deleteComment(id: String, opId: String) async throws
    /// Adding an emoji already there succeeds and returns the existing reaction.
    func addReaction(commentId: String, emoji: String, opId: String) async throws -> Reaction
    func removeReaction(commentId: String, emoji: String, opId: String) async throws
    /// Adds one label; never "sets the labels". Returns the label as the server holds it.
    func addIssueLabel(issueId: String, labelId: String, opId: String) async throws -> Label
    func removeIssueLabel(issueId: String, labelId: String, opId: String) async throws
    func setIssueSubscription(issueId: String, subscribed: Bool) async throws -> IssueSubscription
    func acceptTriageIssue(id: String, opId: String) async throws -> Issue
    func declineTriageIssue(id: String, opId: String) async throws -> Issue
    func createIssueRelation(issueId: String, relatedIssueId: String, type: RelationType, opId: String) async throws -> IssueRelation
    func deleteIssueRelation(id: String, opId: String) async throws
    /// A link card. URL-idempotent server-side: the same URL twice is one card.
    func createAttachment(issueId: String, url: String, title: String?, opId: String) async throws -> Attachment
    func updateProfile(_ change: ProfileChange) async throws -> User
    func updateNotificationPrefs(_ prefs: NotificationPrefs) async throws -> NotificationPrefs

    // Sync socket
    /// A bearer token valid right now, refreshed if the held one is about to expire, so a
    /// socket can authenticate with the same credential the HTTP calls use.
    func accessToken() async throws -> String
    /// Where the sync stream is. Derived from the API origin — see
    /// `PolarisEnvironment.syncSocketURL`.
    func syncSocketURL() -> URL
}

/// Which relationship "My issues" is about.
public enum MyIssuesScope: String, Sendable, Hashable, CaseIterable, Codable {
    case assigned
    case created
    case subscribed

    public var label: String {
        switch self {
        case .assigned: String(localized: "Assigned")
        case .created: String(localized: "Created")
        case .subscribed: String(localized: "Subscribed")
        }
    }
}

public extension PolarisAPI {
    /// The overwhelmingly common inbox call. A default on the protocol rather than on the
    /// method, because a protocol requirement cannot carry default arguments.
    func notifications() async throws -> [PolarisNotification] {
        try await notifications(includeRead: true, includeSnoozed: false, first: 100)
    }

    func search(query: String) async throws -> SearchResults {
        try await search(query: query, teamId: nil, first: 40)
    }

    /// A client that cannot answer offers nothing, which is what the web client concludes
    /// from a failed `/auth/providers` too: no button is a far better outcome than a button
    /// that 404s.
    func authProviders() async throws -> AuthProviders {
        AuthProviders(providers: [])
    }

    /// 404, deliberately — the same answer the server gives for a provider it was not
    /// configured with, so a screen that somehow reached this reads it the same way.
    func signInWithGoogle(idToken: String, nonce: String, displayName: String?) async throws -> Session {
        throw PolarisError.notFound
    }

    // MARK: Defaults for the parity surface
    //
    // Reads answer with what a client that only knows the original eleven operations can
    // honestly say: the issue on its own, an empty list, or not-found. Writes refuse with a
    // 501, which is the truth — not implemented — rather than a forbidden or a validation
    // error that would send a screen looking for a cause that is not there.

    func myIssues(scope: MyIssuesScope, includeCompleted: Bool) async throws -> [Issue] {
        switch scope {
        case .assigned:
            return try await myIssues(includeCompleted: includeCompleted)
        case .created:
            // Gathered, the same way the live client does it; a client with no creator on
            // its rows returns nothing here, which is honest for a list it cannot compute.
            let me = try await viewer().user.id
            let all = try await gatherTeamIssues()
            return all.filter { $0.creator?.id == me && (includeCompleted || $0.state.category.isOpen) }
        case .subscribed:
            throw PolarisError.unsupported("subscribed issues")
        }
    }

    func issueDetail(id: String) async throws -> IssueDetail {
        IssueDetail(issue: try await issue(id: id))
    }

    func issueHistory(issueId: String) async throws -> [IssueHistoryEntry] { [] }
    func issueByIdentifier(_ identifier: String) async throws -> Issue { throw PolarisError.notFound }
    func labels() async throws -> [Label] { [] }
    func projects() async throws -> [Project] { [] }
    func projectStatuses() async throws -> [ProjectStatus] { [] }
    func project(id: String) async throws -> Project { throw PolarisError.notFound }
    func cycles(teamId: String) async throws -> [Cycle] { [] }
    func cycle(id: String) async throws -> Cycle { throw PolarisError.notFound }
    func favorites() async throws -> [Favorite] { [] }

    func search(query: String, teamId: String?, first: Int?, filter: JSONValue?) async throws -> SearchResults {
        try await search(query: query, teamId: teamId, first: first)
    }

    func notificationPrefs() async throws -> NotificationPrefs {
        try await viewer().user.notificationPrefs ?? NotificationPrefs()
    }

    func addFavorite(kind: FavoriteKind, targetId: String) async throws -> Favorite {
        throw PolarisError.unsupported("favourites")
    }
    func removeFavorite(kind: FavoriteKind, targetId: String) async throws {
        throw PolarisError.unsupported("favourites")
    }
    func deleteIssue(id: String, opId: String) async throws {
        throw PolarisError.unsupported("deleting an issue")
    }
    func updateComment(id: String, body: String, opId: String) async throws -> Comment {
        throw PolarisError.unsupported("editing a comment")
    }
    func deleteComment(id: String, opId: String) async throws {
        throw PolarisError.unsupported("deleting a comment")
    }
    func addReaction(commentId: String, emoji: String, opId: String) async throws -> Reaction {
        throw PolarisError.unsupported("reactions")
    }
    func removeReaction(commentId: String, emoji: String, opId: String) async throws {
        throw PolarisError.unsupported("reactions")
    }
    func addIssueLabel(issueId: String, labelId: String, opId: String) async throws -> Label {
        throw PolarisError.unsupported("labels")
    }
    func removeIssueLabel(issueId: String, labelId: String, opId: String) async throws {
        throw PolarisError.unsupported("labels")
    }
    func setIssueSubscription(issueId: String, subscribed: Bool) async throws -> IssueSubscription {
        throw PolarisError.unsupported("subscriptions")
    }
    func acceptTriageIssue(id: String, opId: String) async throws -> Issue {
        throw PolarisError.unsupported("triage")
    }
    func declineTriageIssue(id: String, opId: String) async throws -> Issue {
        throw PolarisError.unsupported("triage")
    }
    func createIssueRelation(issueId: String, relatedIssueId: String, type: RelationType, opId: String) async throws -> IssueRelation {
        throw PolarisError.unsupported("relations")
    }
    func deleteIssueRelation(id: String, opId: String) async throws {
        throw PolarisError.unsupported("relations")
    }
    func createAttachment(issueId: String, url: String, title: String?, opId: String) async throws -> Attachment {
        throw PolarisError.unsupported("links")
    }
    func updateProfile(_ change: ProfileChange) async throws -> User {
        throw PolarisError.unsupported("profile edits")
    }
    func updateNotificationPrefs(_ prefs: NotificationPrefs) async throws -> NotificationPrefs {
        throw PolarisError.unsupported("notification preferences")
    }

    func accessToken() async throws -> String { throw PolarisError.unauthorized(nil) }
    func syncSocketURL() -> URL { PolarisEnvironment.localDevelopment.syncSocketURL }

    /// Every team's issues, fetched concurrently and flattened.
    ///
    /// The building block for the lists the server has no query for: created-by,
    /// subscribed-to, a project's issues, a cycle's issues. `issues(teamId:)` is unpaginated
    /// and whole-collection, so this moves the same bytes a replica bootstrap would — which
    /// is the trade ios/README.md already made.
    func gatherTeamIssues() async throws -> [Issue] {
        let teams = try await teams()
        return try await withThrowingTaskGroup(of: [Issue].self) { group in
            for team in teams {
                group.addTask { try await self.issues(teamId: team.id) }
            }
            var all: [Issue] = []
            for try await batch in group { all.append(contentsOf: batch) }
            return all
        }
    }
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
    public var labelIds: [String]
    /// A calendar day, `2006-01-02`.
    public var dueDate: String?
    public var estimate: Int?
    public var projectId: String?
    public var cycleId: String?
    /// Set to file the draft as a sub-issue.
    public var parentId: String?

    public init(
        id: String = UUIDv7.string(),
        opId: String = UUIDv7.string(),
        teamId: String,
        title: String,
        description: String = "",
        priority: Priority = .none,
        stateId: String? = nil,
        assigneeId: String? = nil,
        labelIds: [String] = [],
        dueDate: String? = nil,
        estimate: Int? = nil,
        projectId: String? = nil,
        cycleId: String? = nil,
        parentId: String? = nil
    ) {
        self.id = id
        self.opId = opId
        self.teamId = teamId
        self.title = title
        self.description = description
        self.priority = priority
        self.stateId = stateId
        self.assigneeId = assigneeId
        self.labelIds = labelIds
        self.dueDate = dueDate
        self.estimate = estimate
        self.projectId = projectId
        self.cycleId = cycleId
        self.parentId = parentId
    }
}

/// A partial update.
///
/// `clearAssignee` exists because nil in a partial update means "leave alone", so there is no
/// way to express "remove the assignee" with an optional alone. The server models it as a
/// separate boolean and so does this — and so do estimate, due date, parent, project and
/// cycle, each with its own `clear…` flag for the same reason.
public struct IssueChange: Sendable, Hashable {
    public let id: String
    public let opId: String
    public var title: String?
    public var description: String?
    public var stateId: String?
    public var priority: Priority?
    public var assigneeId: String?
    public var clearAssignee: Bool
    public var estimate: Int?
    public var clearEstimate: Bool
    public var dueDate: String?
    public var clearDueDate: Bool
    public var parentId: String?
    public var clearParent: Bool
    public var projectId: String?
    public var clearProject: Bool
    public var cycleId: String?
    public var clearCycle: Bool

    public init(
        id: String,
        opId: String = UUIDv7.string(),
        title: String? = nil,
        description: String? = nil,
        stateId: String? = nil,
        priority: Priority? = nil,
        assigneeId: String? = nil,
        clearAssignee: Bool = false,
        estimate: Int? = nil,
        clearEstimate: Bool = false,
        dueDate: String? = nil,
        clearDueDate: Bool = false,
        parentId: String? = nil,
        clearParent: Bool = false,
        projectId: String? = nil,
        clearProject: Bool = false,
        cycleId: String? = nil,
        clearCycle: Bool = false
    ) {
        self.id = id
        self.opId = opId
        self.title = title
        self.description = description
        self.stateId = stateId
        self.priority = priority
        self.assigneeId = assigneeId
        self.clearAssignee = clearAssignee
        self.estimate = estimate
        self.clearEstimate = clearEstimate
        self.dueDate = dueDate
        self.clearDueDate = clearDueDate
        self.parentId = parentId
        self.clearParent = clearParent
        self.projectId = projectId
        self.clearProject = clearProject
        self.cycleId = cycleId
        self.clearCycle = clearCycle
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
