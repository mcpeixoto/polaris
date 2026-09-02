import Foundation

/// The real client: GraphQL over HTTP, with the session handling the server actually requires.
///
/// An actor because it owns mutable auth state that every screen touches concurrently. The
/// refresh path in particular *must* be serialised — the refresh token rotates on every use,
/// so two concurrent refreshes invalidate each other and sign the user out. That is the bug
/// this type exists to prevent, and it is why `refreshTask` is a stored single-flight rather
/// than a lock around a request.
public actor LivePolarisClient: PolarisAPI {
    private let environment: PolarisEnvironment
    private let urlSession: URLSession
    private let decoder = PolarisJSON.decoder()
    private let encoder = PolarisJSON.encoder()

    /// Stable for the life of the process. Paired with a per-operation `opId`, it is what lets
    /// the server recognise a retried mutation as the same mutation.
    private let clientId = UUID().uuidString

    private var accessToken: String?
    private var accessTokenExpiry: Date?
    private var workspaceId: String?
    private var refreshTask: Task<Session, any Error>?

    public init(environment: PolarisEnvironment, urlSession: URLSession = .shared) {
        self.environment = environment
        self.urlSession = urlSession
    }

    // MARK: - Auth

    public func signInWithDevSession() async throws -> Session {
        guard environment.allowsDevSession else { throw PolarisError.forbidden }
        return try await authenticate(path: "/auth/dev-session", body: [:])
    }

    public func signIn(email: String, password: String) async throws -> Session {
        try await authenticate(
            path: "/auth/login",
            body: ["email": .string(email), "password": .string(password)]
        )
    }

    public func signInWithApple(
        idToken: String,
        nonce: String,
        displayName: String?
    ) async throws -> Session {
        var body: [String: JSONValue] = [
            "idToken": .string(idToken),
            "nonce": .string(nonce),
        ]
        // Omitted rather than sent empty, for the reason register gives: the handler decodes
        // with DisallowUnknownFields and an empty name is not the same as no name.
        if let displayName, !displayName.isEmpty { body["displayName"] = .string(displayName) }
        return try await authenticate(path: "/auth/oidc/apple", body: body)
    }

    public func register(
        email: String,
        password: String,
        inviteToken: String?,
        displayName: String?
    ) async throws -> Session {
        // Only the keys the handler declares: it decodes with DisallowUnknownFields, so an
        // extra key is a 400 rather than an ignored field. The optional two are omitted
        // entirely when absent rather than sent as null.
        var body: [String: JSONValue] = [
            "email": .string(email),
            "password": .string(password),
        ]
        if let inviteToken, !inviteToken.isEmpty { body["inviteToken"] = .string(inviteToken) }
        if let displayName, !displayName.isEmpty { body["displayName"] = .string(displayName) }
        return try await authenticate(path: "/auth/register", body: body)
    }

    public func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace {
        // CreateWorkspaceResult carries no json tags, so Go marshals its fields under their
        // Go names — capitalised. Decoding this as lowerCamelCase silently yields nothing.
        struct Result: Decodable {
            let workspace: Workspace
            enum CodingKeys: String, CodingKey { case workspace = "Workspace" }
        }

        let data = try await postAuth(
            path: "/auth/workspaces",
            body: [
                "name": .string(draft.name),
                "urlKey": .string(draft.urlKey),
                "userName": .string(draft.userName),
                "userDisplayName": .string(draft.userDisplayName),
                "userTimezone": .string(draft.userTimezone),
                "firstTeamKey": .string(draft.firstTeamKey),
                "firstTeamName": .string(draft.firstTeamName),
            ],
            authorized: true
        )
        let created = try decode(Result.self, from: data).workspace
        // Subsequent calls must be scoped to it, or every resolver refuses for want of a
        // principal.
        workspaceId = created.id
        return created
    }

    public func restoreSession() async throws -> Session {
        try await refresh()
    }

    /// Signs out, and says whether the server agreed.
    ///
    /// The local half happens unconditionally, and the *cookie* is the local half that
    /// matters. Swallowing a failed `/auth/logout` left the refresh cookie in the session's
    /// store, so the next launch restored the session and signed the user straight back in —
    /// on a borrowed device, having been told they had signed out. Offline is exactly when
    /// somebody hands a phone back.
    ///
    /// The returned error is not a failure of *this* call: the account is signed out here
    /// either way. It is the fact that the refresh token is still live server-side, which is
    /// worth telling somebody so they can revoke it from a machine that has a network.
    @discardableResult
    public func signOut() async -> PolarisError? {
        var failure: PolarisError?
        do {
            _ = try await postAuth(path: "/auth/logout", body: [:], authorized: true)
        } catch let error as PolarisError {
            // A 401 means the session was already gone, which is the outcome asked for.
            if case .unauthorized = error {} else { failure = error }
        } catch {
            failure = .badResponse
        }

        clearCookies()
        accessToken = nil
        accessTokenExpiry = nil
        workspaceId = nil
        refreshTask = nil
        return failure
    }

    /// Drops every cookie this build's backend set, whatever the logout call did.
    ///
    /// Scoped to `apiBaseURL` rather than emptying the store: a shared `URLSession` cookie jar
    /// belongs to the process, and deleting unrelated cookies would be a side effect nobody
    /// asked for.
    private func clearCookies() {
        let storage = urlSession.configuration.httpCookieStorage ?? HTTPCookieStorage.shared
        guard let host = environment.apiBaseURL.host else { return }
        for cookie in storage.cookies ?? [] where LivePolarisClient.cookie(cookie.domain, covers: host) {
            storage.deleteCookie(cookie)
        }
    }

    /// Cookie-domain matching, as RFC 6265 defines it: a leading dot means "and every
    /// subdomain". Written out because the obvious `domain.hasSuffix(host)` is backwards for
    /// exactly the case that matters — a cookie set on `.peixotolabs.com` for a request to
    /// `polaris.peixotolabs.com` — and would leave the refresh cookie in place on the hosted
    /// build while passing on localhost.
    static func cookie(_ domain: String, covers host: String) -> Bool {
        let bare = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
        return host == bare || host.hasSuffix("." + bare)
    }

    public func useWorkspace(id: String) {
        workspaceId = id
    }

    private func authenticate(path: String, body: [String: JSONValue]) async throws -> Session {
        let data = try await postAuth(path: path, body: body, authorized: false)
        let session = try decodeSession(from: data)
        store(session)
        return session
    }

    private func store(_ session: Session) {
        accessToken = session.accessToken
        accessTokenExpiry = Date().addingTimeInterval(TimeInterval(session.expiresIn))
        // Default to the first workspace so a caller that never chooses one still works; a
        // caller that does choose overwrites this via useWorkspace(id:).
        if workspaceId == nil { workspaceId = session.workspaces.first?.id }
    }

    private func decodeSession(from data: Data) throws -> Session {
        do {
            return try decoder.decode(Session.self, from: data)
        } catch {
            throw PolarisError.decoding("\(error)")
        }
    }

    /// Refreshes if the token is missing or within a minute of expiring.
    ///
    /// Proactive rather than purely reactive: waiting for a 401 means every screen that loads
    /// on a cold start races the same expiry and each one retries, which is exactly the
    /// concurrent-refresh storm that rotation punishes.
    private func validToken() async throws -> String {
        if let accessToken, let accessTokenExpiry, accessTokenExpiry.timeIntervalSinceNow > 60 {
            return accessToken
        }
        let session = try await refresh()
        return session.accessToken
    }

    private func refresh() async throws -> Session {
        if let refreshTask {
            return try await refreshTask.value
        }
        let task = Task<Session, any Error> { [self] in
            let data = try await postAuth(path: "/auth/refresh", body: [:], authorized: false)
            let session = try decodeSession(from: data)
            store(session)
            return session
        }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    private func postAuth(path: String, body: [String: JSONValue], authorized: Bool) async throws -> Data {
        var request = URLRequest(url: environment.apiBaseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // The handler decodes with DisallowUnknownFields, so an empty object is the correct
        // body for the credential-free endpoints — not an empty request.
        request.httpBody = try encoder.encode(body)
        if authorized, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        return try await send(request)
    }

    // MARK: - GraphQL

    private func graphQL(
        _ document: String,
        variables: [String: JSONValue] = [:],
        field: String
    ) async throws -> Data {
        let token = try await validToken()
        guard let workspaceId else { throw PolarisError.unauthorized(nil) }

        var request = URLRequest(url: environment.apiBaseURL.appending(path: "/graphql"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(workspaceId, forHTTPHeaderField: "X-Polaris-Workspace")
        request.httpBody = try encoder.encode([
            "query": JSONValue.string(document),
            "variables": .object(variables),
        ])

        let data = try await send(request)
        return try unwrap(data, field: field)
    }

    /// A GraphQL 200 can still be a failure: errors live in the body. This pulls out
    /// `data.<field>` and turns anything in `errors` into a typed PolarisError, so callers
    /// never see a success that is really a failure.
    private func unwrap(_ data: Data, field: String) throws -> Data {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PolarisError.badResponse
        }
        if let errors = root["errors"] as? [[String: Any]], let first = errors.first {
            let message = first["message"] as? String ?? "Unknown error"
            let extensions = first["extensions"] as? [String: Any]
            throw mapGraphQLError(code: extensions?["code"] as? String,
                                  field: extensions?["field"] as? String,
                                  message: message)
        }
        guard let payload = root["data"] as? [String: Any] else { throw PolarisError.badResponse }
        // An explicit null for a nullable field — `issue(id:)` on something deleted — is a
        // not-found, not a decoding failure.
        guard let value = payload[field], !(value is NSNull) else { throw PolarisError.notFound }
        // `.fragmentsAllowed`, because not every field is an object or an array.
        // `unreadNotificationCount` returns a bare Int, and without this option
        // `data(withJSONObject:)` raises NSInvalidArgumentException for a top-level fragment —
        // an Objective-C exception, which Swift cannot catch. The caller does not get a
        // PolarisError; the process dies.
        do {
            return try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        } catch {
            throw PolarisError.badResponse
        }
    }

    private func mapGraphQLError(code: String?, field: String?, message: String) -> PolarisError {
        switch code {
        case "UNAUTHORIZED", "UNAUTHENTICATED": .unauthorized(message)
        case "FORBIDDEN": .forbidden
        case "NOT_FOUND": .notFound
        case "VALIDATION": .validation(message: message, field: field)
        case "RATELIMITED": .rateLimited(retryAfter: nil)
        default: .server(status: 200, message: message)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw PolarisError.decoding("\(T.self): \(error)")
        }
    }

    // MARK: - Transport

    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch let error as URLError {
            throw PolarisError.from(urlError: error)
        } catch {
            throw PolarisError.badResponse
        }

        guard let http = response as? HTTPURLResponse else { throw PolarisError.badResponse }
        switch http.statusCode {
        case 200...299:
            return data
        case 401:
            // The server's sentence, when it sent one — see PolarisError.unauthorized.
            throw PolarisError.unauthorized(serverMessage(from: data))
        case 403:
            throw PolarisError.forbidden
        case 404:
            throw PolarisError.notFound
        case 429:
            // Reset is in seconds here, deliberately diverging from the Linear API it is
            // modelled on, so this is a duration and not an epoch.
            let retryAfter = (http.value(forHTTPHeaderField: "Retry-After")).flatMap(TimeInterval.init)
            throw PolarisError.rateLimited(retryAfter: retryAfter)
        default:
            throw PolarisError.server(status: http.statusCode, message: serverMessage(from: data))
        }
    }

    private func serverMessage(from data: Data) -> String? {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = root["error"] as? [String: Any]
        else { return nil }
        return error["message"] as? String
    }

    // MARK: - Reads

    public func viewer() async throws -> Viewer {
        try decode(Viewer.self, from: try await graphQL(GraphQLDocuments.viewer, field: "viewer"))
    }

    public func syncVersion() async throws -> Int {
        struct VersionOnly: Decodable { let syncVersion: Int }
        let data = try await graphQL(GraphQLDocuments.syncVersion, field: "viewer")
        return try decode(VersionOnly.self, from: data).syncVersion
    }

    public func myIssues(includeCompleted: Bool) async throws -> [Issue] {
        let data = try await graphQL(
            GraphQLDocuments.myIssues,
            variables: ["includeCompleted": .bool(includeCompleted)],
            field: "myIssues"
        )
        return try decode([Issue].self, from: data)
    }

    public func issues(teamId: String) async throws -> [Issue] {
        let data = try await graphQL(
            GraphQLDocuments.teamIssues,
            variables: ["teamId": .string(teamId)],
            field: "issues"
        )
        return try decode([Issue].self, from: data)
    }

    public func issue(id: String) async throws -> Issue {
        let data = try await graphQL(
            GraphQLDocuments.issue, variables: ["id": .string(id)], field: "issue"
        )
        return try decode(Issue.self, from: data)
    }

    public func comments(issueId: String) async throws -> [Comment] {
        let data = try await graphQL(
            GraphQLDocuments.comments, variables: ["issueId": .string(issueId)], field: "comments"
        )
        return try decode([Comment].self, from: data)
    }

    public func teams() async throws -> [Team] {
        try decode([Team].self, from: try await graphQL(GraphQLDocuments.teams, field: "teams"))
    }

    public func workflowStates(teamId: String) async throws -> [WorkflowState] {
        let data = try await graphQL(
            GraphQLDocuments.workflowStates,
            variables: ["teamId": .string(teamId)],
            field: "workflowStates"
        )
        return try decode([WorkflowState].self, from: data)
    }

    public func users() async throws -> [User] {
        try decode([User].self, from: try await graphQL(GraphQLDocuments.users, field: "users"))
    }

    public func unreadNotificationCount() async throws -> Int {
        let data = try await graphQL(
            GraphQLDocuments.unreadNotificationCount, field: "unreadNotificationCount"
        )
        return try decode(Int.self, from: data)
    }

    // MARK: - Writes

    public func createIssue(_ draft: IssueDraft) async throws -> Issue {
        let input = JSONValue.object(compacting: [
            "id": .string(draft.id),
            "teamId": .string(draft.teamId),
            "title": .string(draft.title),
            "description": draft.description.isEmpty ? nil : .string(draft.description),
            "priority": .int(draft.priority.rawValue),
            "stateId": draft.stateId.map(JSONValue.string),
            "assigneeId": draft.assigneeId.map(JSONValue.string),
        ])
        let data = try await graphQL(
            GraphQLDocuments.createIssue,
            variables: [
                "input": input,
                "clientId": .string(clientId),
                "opId": .string(draft.opId),
            ],
            field: "createIssue"
        )
        return try decodePayloadIssue(from: data)
    }

    public func updateIssue(_ change: IssueChange) async throws -> Issue {
        let input = JSONValue.object(compacting: [
            "id": .string(change.id),
            "title": change.title.map(JSONValue.string),
            "description": change.description.map(JSONValue.string),
            "stateId": change.stateId.map(JSONValue.string),
            "priority": change.priority.map { JSONValue.int($0.rawValue) },
            "assigneeId": change.assigneeId.map(JSONValue.string),
            "clearAssignee": change.clearAssignee ? .bool(true) : nil,
        ])
        let data = try await graphQL(
            GraphQLDocuments.updateIssue,
            variables: [
                "input": input,
                "clientId": .string(clientId),
                "opId": .string(change.opId),
            ],
            field: "updateIssue"
        )
        return try decodePayloadIssue(from: data)
    }

    public func createComment(issueId: String, body: String, opId: String) async throws -> Comment {
        struct Payload: Decodable { let comment: Comment }
        let data = try await graphQL(
            GraphQLDocuments.createComment,
            variables: [
                "input": .object(["issueId": .string(issueId), "body": .string(body)]),
                "clientId": .string(clientId),
                // The caller's, deliberately. See the protocol comment: minted here it would
                // be a different value on every retry, and the server would take the retry
                // for a second comment.
                "opId": .string(opId),
            ],
            field: "createComment"
        )
        return try decode(Payload.self, from: data).comment
    }

    public func archiveIssue(id: String, archived: Bool, opId: String) async throws {
        _ = try await graphQL(
            GraphQLDocuments.archiveIssue,
            variables: [
                "id": .string(id),
                "archived": .bool(archived),
                "clientId": .string(clientId),
                "opId": .string(opId),
            ],
            field: "archiveIssue"
        )
    }

    // MARK: - Inbox

    public func notifications(
        includeRead: Bool,
        includeSnoozed: Bool,
        first: Int?
    ) async throws -> [PolarisNotification] {
        var variables: [String: JSONValue] = [
            "includeRead": .bool(includeRead),
            "includeSnoozed": .bool(includeSnoozed),
        ]
        if let first { variables["first"] = .int(first) }
        let data = try await graphQL(
            GraphQLDocuments.notifications, variables: variables, field: "notifications"
        )
        return try decode([PolarisNotification].self, from: data)
    }

    public func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification {
        struct Payload: Decodable { let notification: PolarisNotification }
        let data = try await graphQL(
            GraphQLDocuments.markNotificationRead,
            variables: ["id": .string(id), "read": .bool(read)],
            field: "markNotificationRead"
        )
        return try decode(Payload.self, from: data).notification
    }

    public func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification {
        struct Payload: Decodable { let notification: PolarisNotification }
        let data = try await graphQL(
            GraphQLDocuments.snoozeNotification,
            variables: [
                "id": .string(id),
                // Explicit null rather than an absent key: nil here means "un-snooze", which
                // the server can only be told by being sent a null.
                "until": until.map { JSONValue.string(PolarisJSON.rfc3339($0)) } ?? .null,
            ],
            field: "snoozeNotification"
        )
        return try decode(Payload.self, from: data).notification
    }

    public func deleteNotification(id: String) async throws {
        _ = try await graphQL(
            GraphQLDocuments.deleteNotification,
            variables: ["id": .string(id)],
            field: "deleteNotification"
        )
    }

    // MARK: - Search

    public func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults {
        let input = JSONValue.object(compacting: [
            "query": .string(query),
            "teamId": teamId.map(JSONValue.string),
            "first": first.map(JSONValue.int),
        ])
        let data = try await graphQL(
            GraphQLDocuments.search, variables: ["input": input], field: "search"
        )
        return try decode(SearchResults.self, from: data)
    }

    private func decodePayloadIssue(from data: Data) throws -> Issue {
        struct Payload: Decodable { let issue: Issue }
        return try decode(Payload.self, from: data).issue
    }
}
