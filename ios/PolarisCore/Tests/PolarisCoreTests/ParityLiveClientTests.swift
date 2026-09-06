import Foundation
import Testing
@testable import PolarisCore

/// The parity operations on `LivePolarisClient`: what goes on the wire and how the payload
/// is unwrapped.
///
/// The same `URLProtocol` pattern as `LiveClientTests`, with two differences that matter
/// here. It has its own static script rather than sharing `StubURLProtocol`'s, because the
/// two suites run concurrently and would otherwise overwrite each other's routes. And it
/// answers by GraphQL *operation name* rather than by path, because every operation posts to
/// `/graphql` and a scope like "issues I created" is three operations in one call.
final class OperationStubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) private static var answers: [String: (status: Int, body: String)] = [:]
    nonisolated(unsafe) private static var sent: [String: [[String: Any]]] = [:]
    private static let lock = NSLock()

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        answers = [:]
        sent = [:]
    }

    /// `key` is an operation name — `IssueDetail`, `AddFavorite` — or a path suffix such as
    /// `/auth/refresh` for the non-GraphQL endpoints.
    static func answer(_ key: String, status: Int = 200, body: String) {
        lock.lock(); defer { lock.unlock() }
        answers[key] = (status, body)
    }

    /// Every request body sent for that operation, in order.
    static func bodies(for key: String) -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return sent[key] ?? []
    }

    static func variables(for key: String) -> [String: Any]? {
        bodies(for: key).last?["variables"] as? [String: Any]
    }

    private static func body(of request: URLRequest) -> Data? {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var collected = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            collected.append(contentsOf: buffer[0..<read])
        }
        return collected
    }

    /// `query IssueDetail($id: UUID!) {` -> `IssueDetail`.
    private static func operationName(in body: [String: Any]) -> String? {
        guard let query = body["query"] as? String else { return nil }
        let scanner = Scanner(string: query)
        _ = scanner.scanCharacters(from: .whitespacesAndNewlines)
        guard let keyword = scanner.scanCharacters(from: .letters), keyword == "query" || keyword == "mutation" else {
            return nil
        }
        _ = scanner.scanCharacters(from: .whitespacesAndNewlines)
        return scanner.scanCharacters(from: .alphanumerics)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let parsed = OperationStubURLProtocol.body(of: request)
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let key = parsed.flatMap(OperationStubURLProtocol.operationName) ?? path
        OperationStubURLProtocol.lock.lock()
        if let parsed { OperationStubURLProtocol.sent[key, default: []].append(parsed) }
        let answer = OperationStubURLProtocol.answers[key]
            ?? OperationStubURLProtocol.answers.first { path.hasSuffix($0.key) }?.value
        OperationStubURLProtocol.lock.unlock()
        guard let answer else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://example.invalid")!,
            statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: [:]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(answer.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private let issueJSON = """
{"id":"i1","identifier":"ENG-1","title":"t","description":"","priority":1,"estimate":null,"dueDate":null,
 "parentId":null,"projectId":"p1","cycleId":null,
 "state":{"id":"s","name":"Todo","color":"#fff","category":"UNSTARTED","position":"a"},
 "team":{"id":"t1","key":"ENG","name":"Eng","icon":null,"color":null,"triageEnabled":true,"cyclesEnabled":true},
 "assignee":null,"creator":{"id":"u1","name":"m","displayName":"M","avatarUrl":null,"email":null},
 "labels":[],"parent":null,"project":{"id":"p1","name":"Mobile","color":"#5B8DEF","icon":null},"cycle":null,
 "progress":null,"createdAt":"2026-08-25T10:00:00Z","updatedAt":"2026-08-25T10:00:00Z"}
"""

private let otherIssueJSON = issueJSON
    .replacingOccurrences(of: "\"id\":\"i1\"", with: "\"id\":\"i2\"")
    .replacingOccurrences(of: "\"identifier\":\"ENG-1\"", with: "\"identifier\":\"ENG-2\"")
    .replacingOccurrences(of: "\"creator\":{\"id\":\"u1\"", with: "\"creator\":{\"id\":\"u2\"")

@Suite("Live client parity operations", .serialized)
struct ParityLiveClientTests {
    private static let environment = PolarisEnvironment(
        apiBaseURL: URL(string: "https://polaris.test")!,
        allowsDevSession: false
    )

    private static let sessionJSON = """
    {"accessToken":"tok","expiresIn":900,"accountId":"a1",
     "workspaces":[{"id":"w1","name":"Test","urlKey":"test","plan":"free"}]}
    """

    private func client() -> LivePolarisClient {
        OperationStubURLProtocol.reset()
        OperationStubURLProtocol.answer("/auth/refresh", body: Self.sessionJSON)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OperationStubURLProtocol.self]
        return LivePolarisClient(environment: Self.environment, urlSession: URLSession(configuration: configuration))
    }

    private func data(_ field: String, _ payload: String) -> String {
        #"{"data":{"\#(field)":\#(payload)}}"#
    }

    @Test("issueDetail unwraps the issue and every list beside it")
    func issueDetail() async throws {
        let api = client()
        OperationStubURLProtocol.answer("IssueDetail", body: data("issue", String(issueJSON.dropLast(1)) + """
        ,"children":[\(otherIssueJSON)],
         "attachments":[{"id":"a1","url":"https://x","title":"X","subtitle":null,"iconUrl":null,"createdAt":"2026-08-25T10:00:00Z"}],
         "relations":[],
         "blockedBy":[{"id":"r2","type":"BLOCKS","issue":{"id":"i9","identifier":"ENG-9","title":"b"},
                       "relatedIssue":{"id":"i1","identifier":"ENG-1","title":"t"}}],
         "subscribers":[{"userId":"u1","unsubscribed":false,"reason":"ASSIGNED"}]}
        """))
        let detail = try await api.issueDetail(id: "i1")
        #expect(detail.issue.identifier == "ENG-1")
        #expect(detail.children.map(\.identifier) == ["ENG-2"])
        #expect(detail.attachments.count == 1)
        #expect(detail.blockedBy.first?.counterpart(of: "i1").identifier == "ENG-9")
        #expect(detail.isSubscribed("u1"))
        #expect(OperationStubURLProtocol.variables(for: "IssueDetail")?["id"] as? String == "i1")
    }

    @Test("a deleted issue's detail is not-found, not a decoding failure")
    func missingDetail() async throws {
        let api = client()
        OperationStubURLProtocol.answer("IssueDetail", body: #"{"data":{"issue":null}}"#)
        await #expect(throws: PolarisError.notFound) { try await api.issueDetail(id: "gone") }
    }

    @Test("history, labels, projects, cycles and favourites decode from their fields")
    func referenceReads() async throws {
        let api = client()
        OperationStubURLProtocol.answer("IssueHistory", body: data("issueHistory", """
        [{"id":"h1","kind":"state","actor":{"type":"USER","id":"u1"},"fromValue":null,"toValue":"x","createdAt":"2026-08-19T13:00:00Z"}]
        """))
        OperationStubURLProtocol.answer("Labels", body: data("labels", """
        [{"id":"l1","name":"backend","color":"#5B8DEF","teamId":null,"parentId":null,"isGroup":false}]
        """))
        OperationStubURLProtocol.answer("Projects", body: data("projects", """
        [{"id":"p1","name":"Mobile","summary":null,"description":"","icon":null,"color":"#5B8DEF","priority":2,"leadId":null,
          "startDate":null,"targetDate":null,"status":{"id":"ps","name":"S","color":"#000","category":"STARTED"},
          "lead":null,"teams":[{"team":{"id":"t1","key":"ENG","name":"Eng","icon":null,"color":null,"triageEnabled":false,"cyclesEnabled":false}}],
          "milestones":[]}]
        """))
        OperationStubURLProtocol.answer("ProjectStatuses", body: data("projectStatuses", """
        [{"id":"ps","name":"S","color":"#000","category":"STARTED"}]
        """))
        OperationStubURLProtocol.answer("Cycles", body: data("cycles", """
        [{"id":"cy1","teamId":"t1","number":7,"name":"","description":null,
          "startsAt":"2026-09-01T00:00:00Z","endsAt":"2026-09-15T00:00:00Z","completedAt":null}]
        """))
        OperationStubURLProtocol.answer("Favorites", body: data("favorites", """
        [{"id":"f1","kind":"ISSUE","targetId":"i3","name":null}]
        """))

        #expect(try await api.issueHistory(issueId: "i1").first?.kind == "state")
        #expect(OperationStubURLProtocol.variables(for: "IssueHistory")?["issueId"] as? String == "i1")
        #expect(try await api.labels().first?.name == "backend")
        #expect(try await api.projects().first?.teams.first?.key == "ENG")
        #expect(try await api.projectStatuses().first?.category == .started)
        #expect(try await api.cycles(teamId: "t1").first?.number == 7)
        #expect(OperationStubURLProtocol.variables(for: "Cycles")?["teamId"] as? String == "t1")
        #expect(try await api.favorites().first?.kind == .issue)
    }

    @Test("single-row reads carry their id and unwrap the row")
    func singleReads() async throws {
        let api = client()
        OperationStubURLProtocol.answer("IssueByIdentifier", body: data("issueByIdentifier", issueJSON))
        OperationStubURLProtocol.answer("ProjectById", body: data("project", """
        {"id":"p1","name":"Mobile","summary":null,"description":"","icon":null,"color":"#5B8DEF","priority":0,"leadId":null,
         "startDate":null,"targetDate":null,"status":{"id":"ps","name":"S","color":"#000","category":"PLANNED"},
         "lead":null,"teams":[],"milestones":[]}
        """))
        OperationStubURLProtocol.answer("CycleById", body: data("cycle", """
        {"id":"cy1","teamId":"t1","number":7,"name":"Hardening","description":null,
         "startsAt":"2026-09-01T00:00:00Z","endsAt":"2026-09-15T00:00:00Z","completedAt":null}
        """))
        #expect(try await api.issueByIdentifier("ENG-1").id == "i1")
        #expect(OperationStubURLProtocol.variables(for: "IssueByIdentifier")?["identifier"] as? String == "ENG-1")
        #expect(try await api.project(id: "p1").status.category == .planned)
        #expect(OperationStubURLProtocol.variables(for: "ProjectById")?["id"] as? String == "p1")
        #expect(try await api.cycle(id: "cy1").displayName == "Hardening")
    }

    /// The scope with no query of its own: viewer, then teams, then one issues call per
    /// team, then the creator filter — and completed work left out unless asked for.
    @Test("issues I created are gathered per team and filtered by creator")
    func createdScope() async throws {
        let api = client()
        OperationStubURLProtocol.answer("Viewer", body: data("viewer", """
        {"user":{"id":"u1","name":"m","displayName":"M","avatarUrl":null,"email":null},
         "workspace":{"id":"w1","name":"W","urlKey":"w","plan":"free"},"workspaces":[],"syncVersion":3}
        """))
        OperationStubURLProtocol.answer("Teams", body: data("teams", """
        [{"id":"t1","key":"ENG","name":"Eng","icon":null,"color":null,"triageEnabled":false,"cyclesEnabled":false},
         {"id":"t2","key":"OPS","name":"Ops","icon":null,"color":null,"triageEnabled":false,"cyclesEnabled":false}]
        """))
        OperationStubURLProtocol.answer("TeamIssues", body: data("issues", "[\(issueJSON),\(otherIssueJSON)]"))

        let mine = try await api.myIssues(scope: .created, includeCompleted: false)
        // Two teams, the same two rows each; only the one u1 created survives, twice.
        #expect(mine.map(\.id) == ["i1", "i1"])
        #expect(OperationStubURLProtocol.bodies(for: "TeamIssues").count == 2)
        // Never the search query: the server answers an empty query with nothing.
        #expect(OperationStubURLProtocol.bodies(for: "Search").isEmpty)
    }

    @Test("issues I subscribe to come from the subscriber selection, opt-outs excluded")
    func subscribedScope() async throws {
        let api = client()
        OperationStubURLProtocol.answer("Viewer", body: data("viewer", """
        {"user":{"id":"u1","name":"m","displayName":"M","avatarUrl":null,"email":null},
         "workspace":{"id":"w1","name":"W","urlKey":"w","plan":"free"},"workspaces":[],"syncVersion":3}
        """))
        OperationStubURLProtocol.answer("Teams", body: data("teams", """
        [{"id":"t1","key":"ENG","name":"Eng","icon":null,"color":null,"triageEnabled":false,"cyclesEnabled":false}]
        """))
        let subscribed = String(issueJSON.dropLast(1)) + #","subscribers":[{"userId":"u1","unsubscribed":false,"reason":"MANUAL"}]}"#
        let optedOut = String(otherIssueJSON.dropLast(1)) + #","subscribers":[{"userId":"u1","unsubscribed":true,"reason":"MANUAL"}]}"#
        OperationStubURLProtocol.answer("TeamIssuesWithSubscribers", body: data("issues", "[\(subscribed),\(optedOut)]"))

        let mine = try await api.myIssues(scope: .subscribed, includeCompleted: true)
        #expect(mine.map(\.id) == ["i1"])
        #expect(OperationStubURLProtocol.bodies(for: "TeamIssues").isEmpty)
    }

    @Test("the assigned scope is the original query")
    func assignedScope() async throws {
        let api = client()
        OperationStubURLProtocol.answer("MyIssues", body: data("myIssues", "[\(issueJSON)]"))
        let mine = try await api.myIssues(scope: .assigned, includeCompleted: true)
        #expect(mine.count == 1)
        #expect(OperationStubURLProtocol.variables(for: "MyIssues")?["includeCompleted"] as? Bool == true)
    }

    @Test("a search carries its filter AST inside the input")
    func searchWithFilter() async throws {
        let api = client()
        OperationStubURLProtocol.answer("Search", body: data("search", #"{"issueCount":0,"issues":[]}"#))
        _ = try await api.search(query: "sync", teamId: nil, first: 10, filter: IssueFilter.createdBy("u1"))
        let input = try #require(OperationStubURLProtocol.variables(for: "Search")?["input"] as? [String: Any])
        let filter = try #require(input["filter"] as? [String: Any])
        #expect(filter["field"] as? String == "creator")
        #expect(input.keys.contains("teamId") == false)

        _ = try await api.search(query: "sync", teamId: nil, first: 10)
        let plain = try #require(OperationStubURLProtocol.variables(for: "Search")?["input"] as? [String: Any])
        #expect(plain.keys.contains("filter") == false)
    }

    @Test("a create carries the parent, labels and planning fields; an update carries the clear flags")
    func createAndUpdateInputs() async throws {
        let api = client()
        OperationStubURLProtocol.answer("CreateIssue", body: data("createIssue", #"{"version":1,"issue":\#(issueJSON)}"#))
        OperationStubURLProtocol.answer("UpdateIssue", body: data("updateIssue", #"{"version":2,"issue":\#(issueJSON)}"#))

        _ = try await api.createIssue(IssueDraft(
            teamId: "t1", title: "child", labelIds: ["l1"], dueDate: "2026-09-12", estimate: 2,
            projectId: "p1", cycleId: "cy1", parentId: "i1"
        ))
        let created = try #require(OperationStubURLProtocol.variables(for: "CreateIssue")?["input"] as? [String: Any])
        #expect(created["parentId"] as? String == "i1")
        #expect(created["labelIds"] as? [String] == ["l1"])
        #expect(created["dueDate"] as? String == "2026-09-12")
        #expect(created["estimate"] as? Int == 2)
        #expect(created["projectId"] as? String == "p1")
        #expect(created["cycleId"] as? String == "cy1")

        _ = try await api.updateIssue(IssueChange(id: "i1", clearDueDate: true, projectId: "p2", clearCycle: true))
        let updated = try #require(OperationStubURLProtocol.variables(for: "UpdateIssue")?["input"] as? [String: Any])
        #expect(updated["clearDueDate"] as? Bool == true)
        #expect(updated["projectId"] as? String == "p2")
        #expect(updated["clearCycle"] as? Bool == true)
        // Untouched flags are absent, not false: absent means "leave alone".
        #expect(updated.keys.contains("clearEstimate") == false)
        #expect(updated.keys.contains("dueDate") == false)
    }

    @Test("every idempotent mutation carries the caller's opId and the client's id")
    func idempotencyPair() async throws {
        let api = client()
        OperationStubURLProtocol.answer("DeleteIssue", body: data("deleteIssue", #"{"version":1,"id":"i1"}"#))
        OperationStubURLProtocol.answer("DeleteComment", body: data("deleteComment", #"{"version":1,"id":"c1"}"#))
        OperationStubURLProtocol.answer("RemoveReaction", body: data("removeReaction", #"{"version":1,"id":"r1"}"#))
        OperationStubURLProtocol.answer("RemoveIssueLabel", body: data("removeIssueLabel", #"{"version":1,"id":"l1"}"#))
        OperationStubURLProtocol.answer("DeleteIssueRelation", body: data("deleteIssueRelation", #"{"version":1,"id":"r1"}"#))

        try await api.deleteIssue(id: "i1", opId: "op-1")
        try await api.deleteComment(id: "c1", opId: "op-2")
        try await api.removeReaction(commentId: "c1", emoji: "👍", opId: "op-3")
        try await api.removeIssueLabel(issueId: "i1", labelId: "l1", opId: "op-4")
        try await api.deleteIssueRelation(id: "r1", opId: "op-5")

        for (operation, opId) in [("DeleteIssue", "op-1"), ("DeleteComment", "op-2"), ("RemoveReaction", "op-3"),
                                  ("RemoveIssueLabel", "op-4"), ("DeleteIssueRelation", "op-5")] {
            let which = Testing.Comment(rawValue: operation)
            let variables = try #require(OperationStubURLProtocol.variables(for: operation), which)
            #expect(variables["opId"] as? String == opId, which)
            #expect((variables["clientId"] as? String)?.isEmpty == false, which)
        }
        #expect(OperationStubURLProtocol.variables(for: "RemoveReaction")?["emoji"] as? String == "👍")
    }

    @Test("comment and reaction writes unwrap their payloads")
    func commentWrites() async throws {
        let api = client()
        OperationStubURLProtocol.answer("UpdateComment", body: data("updateComment", """
        {"version":4,"comment":{"id":"c1","body":"edited","actor":{"type":"USER","id":"u1"},"editedAt":"2026-08-25T11:00:00Z",
         "createdAt":"2026-08-25T10:00:00Z","parentId":null,"resolvedAt":null,"reactions":[]}}
        """))
        OperationStubURLProtocol.answer("AddReaction", body: data("addReaction", """
        {"version":5,"reaction":{"id":"r1","commentId":"c1","userId":"u1","emoji":"🎉","createdAt":"2026-08-25T11:00:00Z"}}
        """))
        let comment = try await api.updateComment(id: "c1", body: "edited", opId: "op")
        #expect(comment.body == "edited" && comment.editedAt != nil)
        #expect(OperationStubURLProtocol.variables(for: "UpdateComment")?["body"] as? String == "edited")

        let reaction = try await api.addReaction(commentId: "c1", emoji: "🎉", opId: "op")
        #expect(reaction.emoji == "🎉" && reaction.userId == "u1")
    }

    @Test("adding a label unwraps the nested label, and a subscription its row")
    func labelAndSubscription() async throws {
        let api = client()
        OperationStubURLProtocol.answer("AddIssueLabel", body: data("addIssueLabel", """
        {"version":6,"issueLabel":{"id":"il1","label":{"id":"l1","name":"backend","color":"#5B8DEF","teamId":null,"parentId":null,"isGroup":false}}}
        """))
        OperationStubURLProtocol.answer("SetIssueSubscription", body: data("setIssueSubscription", """
        {"version":7,"subscription":{"userId":"u1","unsubscribed":true,"reason":"MANUAL"}}
        """))
        let label = try await api.addIssueLabel(issueId: "i1", labelId: "l1", opId: "op")
        #expect(label.name == "backend")
        #expect(OperationStubURLProtocol.variables(for: "AddIssueLabel")?["labelId"] as? String == "l1")

        let row = try await api.setIssueSubscription(issueId: "i1", subscribed: false)
        #expect(row.isActive == false)
        #expect(OperationStubURLProtocol.variables(for: "SetIssueSubscription")?["subscribed"] as? Bool == false)
    }

    @Test("triage, relations, links and favourites unwrap their payloads and send their enums as names")
    func triageRelationsLinksFavourites() async throws {
        let api = client()
        OperationStubURLProtocol.answer("AcceptTriageIssue", body: data("acceptTriageIssue", #"{"version":1,"issue":\#(issueJSON)}"#))
        OperationStubURLProtocol.answer("DeclineTriageIssue", body: data("declineTriageIssue", #"{"version":1,"issue":\#(otherIssueJSON)}"#))
        OperationStubURLProtocol.answer("CreateIssueRelation", body: data("createIssueRelation", """
        {"version":8,"relation":{"id":"r1","type":"BLOCKS","issue":{"id":"i1","identifier":"ENG-1","title":"t"},
         "relatedIssue":{"id":"i2","identifier":"ENG-2","title":"o"}}}
        """))
        OperationStubURLProtocol.answer("CreateAttachment", body: data("createAttachment", """
        {"version":9,"attachment":{"id":"a1","url":"https://x","title":"X","subtitle":null,"iconUrl":null,"createdAt":"2026-08-25T10:00:00Z"}}
        """))
        OperationStubURLProtocol.answer("AddFavorite", body: data("addFavorite", """
        {"version":10,"favorite":{"id":"f1","kind":"TEAM","targetId":"t1","name":null}}
        """))
        OperationStubURLProtocol.answer("RemoveFavorite", body: data("removeFavorite", #"{"version":11,"id":"f1"}"#))

        #expect(try await api.acceptTriageIssue(id: "i1", opId: "op").id == "i1")
        #expect(try await api.declineTriageIssue(id: "i2", opId: "op").id == "i2")

        let relation = try await api.createIssueRelation(issueId: "i1", relatedIssueId: "i2", type: .blocks, opId: "op")
        #expect(relation.counterpart(of: "i1").id == "i2")
        #expect(OperationStubURLProtocol.variables(for: "CreateIssueRelation")?["type"] as? String == "BLOCKS")

        let attachment = try await api.createAttachment(issueId: "i1", url: "https://x", title: nil, opId: "op")
        #expect(attachment.title == "X")
        let input = try #require(OperationStubURLProtocol.variables(for: "CreateAttachment")?["input"] as? [String: Any])
        #expect(input["url"] as? String == "https://x")
        #expect(input.keys.contains("title") == false)

        #expect(try await api.addFavorite(kind: .team, targetId: "t1").kind == .team)
        #expect(OperationStubURLProtocol.variables(for: "AddFavorite")?["kind"] as? String == "TEAM")
        try await api.removeFavorite(kind: .team, targetId: "t1")
        #expect(OperationStubURLProtocol.variables(for: "RemoveFavorite")?["targetId"] as? String == "t1")
    }

    @Test("profile and preference writes send partial inputs and read back what the server kept")
    func profileAndPrefs() async throws {
        let api = client()
        OperationStubURLProtocol.answer("UpdateProfile", body: data("updateProfile", """
        {"version":1,"user":{"id":"u1","name":"m","displayName":"Miguel P.","avatarUrl":null,"email":null,"notificationPrefs":null}}
        """))
        OperationStubURLProtocol.answer("UpdateNotificationPrefs", body: data("updateNotificationPrefs", """
        {"version":2,"user":{"id":"u1","name":"m","displayName":"M","avatarUrl":null,"email":null,
         "notificationPrefs":{"muted":["COMMENT"],"emailDigest":"daily"}}}
        """))
        OperationStubURLProtocol.answer("Viewer", body: data("viewer", """
        {"user":{"id":"u1","name":"m","displayName":"M","avatarUrl":null,"email":null,"notificationPrefs":{"desktop":true}},
         "workspace":{"id":"w1","name":"W","urlKey":"w","plan":"free"},"workspaces":[],"syncVersion":3}
        """))

        let user = try await api.updateProfile(ProfileChange(displayName: "Miguel P."))
        #expect(user.displayName == "Miguel P.")
        let input = try #require(OperationStubURLProtocol.variables(for: "UpdateProfile")?["input"] as? [String: Any])
        #expect(input["displayName"] as? String == "Miguel P.")
        #expect(input.keys.contains("name") == false)

        // The server dropped the cadence it did not recognise; the client shows what was kept.
        let kept = try await api.updateNotificationPrefs(NotificationPrefs(muted: ["COMMENT"], emailDigest: "fortnightly"))
        #expect(kept.emailDigest == "daily")
        let prefs = try #require(OperationStubURLProtocol.variables(for: "UpdateNotificationPrefs")?["prefs"] as? [String: Any])
        #expect(prefs["muted"] as? [String] == ["COMMENT"])

        #expect(try await api.notificationPrefs().desktop == true)
    }

    @Test("the socket gets a token that is valid now, and the URL beside the API")
    func socketCredentials() async throws {
        let api = client()
        // No token held yet: the first ask refreshes, which is what the /auth/refresh route is
        // for. A held token within a minute of expiry would refresh the same way.
        #expect(try await api.accessToken() == "tok")
        #expect(OperationStubURLProtocol.bodies(for: "/auth/refresh").count == 1)
        #expect(try await api.accessToken() == "tok")
        #expect(OperationStubURLProtocol.bodies(for: "/auth/refresh").count == 1, "a fresh token was refreshed again")
        #expect(api.syncSocketURL().absoluteString == "wss://polaris.test/sync")
    }
}
