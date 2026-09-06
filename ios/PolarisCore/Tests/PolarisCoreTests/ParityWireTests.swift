import Foundation
import Testing
@testable import PolarisCore

// Decoding for the parity surface: every new wire type, from the JSON the server sends, and
// the defaulting that keeps an older cache or a lighter selection decodable.

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try PolarisJSON.decoder().decode(T.self, from: Data(json.utf8))
}

private let issueJSON = """
{"id":"i1","identifier":"ENG-1","title":"t","description":"d","priority":1,"estimate":3,
 "dueDate":"2026-09-12","parentId":"i0","projectId":"p1","cycleId":"cy1",
 "state":{"id":"s","name":"Todo","color":"#fff","category":"UNSTARTED","position":"a"},
 "team":{"id":"t","key":"ENG","name":"Eng","triageEnabled":true,"cyclesEnabled":false},
 "assignee":null,"creator":{"id":"u2","name":"ana","displayName":"Ana Silva"},
 "labels":[{"id":"l1","name":"backend","color":"#5B8DEF","teamId":"t","parentId":null,"isGroup":false}],
 "parent":{"id":"i0","identifier":"ENG-0","title":"Parent"},
 "project":{"id":"p1","name":"Mobile","color":"#5B8DEF","icon":null},
 "cycle":{"id":"cy1","number":7,"name":"","startsAt":"2026-08-25T00:00:00Z","endsAt":"2026-09-08T00:00:00Z"},
 "progress":{"total":2,"completed":1,"canceled":0,"percent":50},
 "createdAt":"2026-08-25T10:00:00Z","updatedAt":"2026-08-25T10:00:00Z"}
"""

@Suite("Parity wire types")
struct ParityWireTests {
    @Test("an issue carries its parent, project, cycle and roll-up")
    func issueRefs() throws {
        let issue = try decode(Issue.self, issueJSON)
        #expect(issue.parentId == "i0")
        #expect(issue.parent?.identifier == "ENG-0")
        #expect(issue.projectId == "p1")
        #expect(issue.project?.name == "Mobile")
        #expect(issue.cycleId == "cy1")
        #expect(issue.cycle?.displayName == "Cycle 7")
        #expect(issue.progress?.percent == 50)
        #expect(issue.estimate == 3)
        #expect(issue.dueDate == "2026-09-12")
        #expect(issue.team.triageEnabled == true)
        #expect(issue.team.cyclesEnabled == false)
        #expect(issue.labels.first?.teamId == "t")
        #expect(issue.ref == IssueRef(id: "i1", identifier: "ENG-1", title: "t"))
    }

    /// The row a cached list holds was written by a build that selected none of the new
    /// fields. It must still decode, with every one of them absent rather than failing.
    @Test("an issue without the new selections still decodes")
    func issueWithoutRefs() throws {
        let json = """
        {"id":"1","identifier":"ENG-1","title":"t","description":"","priority":2,
         "state":{"id":"s","name":"Todo","color":"#fff","category":"UNSTARTED","position":"a"},
         "team":{"id":"t","key":"ENG","name":"Eng"},
         "labels":[{"id":"l1","name":"backend","color":"#5B8DEF"}],
         "createdAt":"2026-08-25T10:00:00Z","updatedAt":"2026-08-25T10:00:00Z"}
        """
        let issue = try decode(Issue.self, json)
        #expect(issue.parent == nil && issue.project == nil && issue.cycle == nil)
        #expect(issue.progress == nil)
        #expect(issue.team.triageEnabled == false && issue.team.cyclesEnabled == false)
        #expect(issue.labels.first?.isGroup == false)
        #expect(issue.labels.first?.teamId == nil)
    }

    @Test("an issue round-trips through the cache encoder with its refs intact")
    func issueRoundTrip() throws {
        let issue = try decode(Issue.self, issueJSON)
        let data = try PolarisJSON.encoder().encode(issue)
        let again = try PolarisJSON.decoder().decode(Issue.self, from: data)
        #expect(again == issue)
    }

    @Test("the in-memory issue initialiser produces the same shape the wire does")
    func memberwiseIssue() throws {
        let wire = try decode(Issue.self, issueJSON)
        let built = PolarisCore.Issue(
            id: "x", identifier: "ENG-…", title: "placeholder", state: wire.state, team: wire.team,
            parentId: wire.id, parent: wire.ref
        )
        #expect(built.parentId == "i1")
        #expect(built.parent?.identifier == "ENG-1")
        #expect(built.labels.isEmpty)
        #expect(built.priority == Priority.none)
    }

    @Test("a label applies to a team when it is the workspace's or that team's, and never a group")
    func labelScope() throws {
        // ##"…"## rather than #"…"#: the colour starts with `#` right after a quote, and `"#`
        // would close the literal in the middle of the JSON.
        let workspace = try decode(Label.self, ##"{"id":"a","name":"w","color":"#000"}"##)
        let team = try decode(Label.self, ##"{"id":"b","name":"t","color":"#000","teamId":"t1"}"##)
        let group = try decode(Label.self, ##"{"id":"c","name":"g","color":"#000","isGroup":true}"##)
        #expect(workspace.applies(toTeam: "t1") && workspace.applies(toTeam: "t2"))
        #expect(team.applies(toTeam: "t1") && !team.applies(toTeam: "t2"))
        #expect(!group.applies(toTeam: "t1"))
    }

    @Test("a comment decodes its reactions, and defaults to none")
    func commentReactions() throws {
        let with = try decode(PolarisCore.Comment.self,"""
        {"id":"c1","body":"hi","actor":{"type":"USER","id":"u1"},"editedAt":null,
         "createdAt":"2026-08-25T10:00:00Z","parentId":"c0","resolvedAt":"2026-08-26T10:00:00Z",
         "reactions":[{"id":"r1","commentId":"c1","userId":"u2","emoji":"👍","createdAt":"2026-08-25T10:05:00Z"}]}
        """)
        #expect(with.reactions.count == 1)
        #expect(with.hasReaction("👍", by: "u2"))
        #expect(!with.hasReaction("👍", by: "u1"))
        #expect(with.parentId == "c0")
        #expect(with.resolvedAt != nil)

        let without = try decode(PolarisCore.Comment.self,"""
        {"id":"c2","body":"hi","actor":{"type":"USER","id":"u1"},"editedAt":null,"createdAt":"2026-08-25T10:00:00Z"}
        """)
        #expect(without.reactions.isEmpty)
        #expect(without.parentId == nil)
    }

    @Test("a user carries the viewer's preferences, and survives a bag it cannot read")
    func userPrefs() throws {
        let viewer = try decode(User.self, """
        {"id":"u1","name":"m","displayName":"M","notificationPrefs":{"muted":["COMMENT"],"emailDigest":"weekly","desktop":true}}
        """)
        #expect(viewer.notificationPrefs?.muted == ["COMMENT"])
        #expect(viewer.notificationPrefs?.emailDigest == "weekly")
        #expect(viewer.notificationPrefs?.desktop == true)
        #expect(viewer.notificationPrefs?.isMuted(.comment) == true)

        // A bag that is not an object — the column default, or a legacy write — must not take
        // the sign-in down with it.
        let odd = try decode(User.self, #"{"id":"u1","name":"m","displayName":"M","notificationPrefs":"legacy"}"#)
        #expect(odd.notificationPrefs == nil)
        let absent = try decode(User.self, #"{"id":"u1","name":"m","displayName":"M"}"#)
        #expect(absent.notificationPrefs == nil)
    }

    @Test("notification prefs send only what is set, and mute toggles by wire name")
    func prefsEncoding() throws {
        var prefs = NotificationPrefs(muted: ["PULSE_DIGEST"], emailDigest: "daily")
        prefs.setMuted(.comment, true)
        prefs.setMuted(.pulseDigest, false)
        #expect(prefs.muted == ["COMMENT"])

        let data = try JSONEncoder().encode(prefs.jsonValue)
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(root["muted"] as? [String] == ["COMMENT"])
        #expect(root["emailDigest"] as? String == "daily")
        // Absent, not null: the server reads per key.
        #expect(root.keys.contains("desktop") == false)
        #expect(root.keys.contains("emailPerNotification") == false)
    }

    @Test("a project flattens its team links and reads its status category")
    func project() throws {
        let project = try decode(Project.self, """
        {"id":"p1","name":"Mobile","summary":null,"description":"","icon":null,"color":"#5B8DEF",
         "priority":2,"leadId":"u1","startDate":"2026-08-01","targetDate":null,
         "status":{"id":"ps3","name":"In Progress","color":"#F5B700","category":"STARTED"},
         "lead":{"id":"u1","name":"m","displayName":"M"},
         "teams":[{"team":{"id":"t1","key":"ENG","name":"Eng"}},{"team":{"id":"t2","key":"OPS","name":"Ops"}}],
         "milestones":[{"id":"m1","name":"Detail","targetDate":"2026-09-20"}]}
        """)
        #expect(project.teams.map(\.key) == ["ENG", "OPS"])
        #expect(project.status.category == .started)
        #expect(project.status.category.isOpen)
        #expect(project.priority == Priority.high)
        #expect(project.milestones.first?.name == "Detail")
        #expect(project.ref.name == "Mobile")

        // Encoded and decoded again, the join shape survives — the fixture relies on it.
        let again = try PolarisJSON.decoder().decode(Project.self, from: try PolarisJSON.encoder().encode(project))
        #expect(again == project)
    }

    @Test("an unknown project status category degrades to backlog")
    func unknownProjectCategory() throws {
        let status = try decode(ProjectStatus.self, ##"{"id":"x","name":"?","color":"#000","category":"PAUSED"}"##)
        #expect(status.category == .backlog)
    }

    @Test("a cycle knows whether it is running")
    func cycle() throws {
        let cycle = try decode(Cycle.self, """
        {"id":"cy1","teamId":"t1","number":7,"name":"","description":null,
         "startsAt":"2026-09-01T00:00:00Z","endsAt":"2026-09-15T00:00:00Z","completedAt":null}
        """)
        let during = try #require(PolarisJSON.parseRFC3339("2026-09-06T12:00:00Z"))
        let before = try #require(PolarisJSON.parseRFC3339("2026-08-20T12:00:00Z"))
        let after = try #require(PolarisJSON.parseRFC3339("2026-09-20T12:00:00Z"))
        #expect(cycle.isActive(at: during))
        #expect(!cycle.isActive(at: before) && cycle.isUpcoming(at: before))
        #expect(!cycle.isActive(at: after) && !cycle.isUpcoming(at: after))
        #expect(cycle.displayName == "Cycle 7")
        #expect(cycle.ref.id == "cy1")
    }

    @Test("an issue detail reads the lists beside the issue, and both ends of a relation")
    func issueDetail() throws {
        let json = String(issueJSON.dropLast(1)) + """
        ,"children":[\(issueJSON.replacingOccurrences(of: "\"id\":\"i1\"", with: "\"id\":\"i1a\""))],
         "attachments":[{"id":"a1","url":"https://x","title":"X","subtitle":null,"iconUrl":null,"createdAt":"2026-08-25T10:00:00Z"}],
         "relations":[{"id":"r1","type":"BLOCKS","issue":{"id":"i1","identifier":"ENG-1","title":"t"},
                       "relatedIssue":{"id":"i2","identifier":"ENG-2","title":"other"}}],
         "blockedBy":[{"id":"r2","type":"BLOCKS","issue":{"id":"i9","identifier":"ENG-9","title":"blocker"},
                       "relatedIssue":{"id":"i1","identifier":"ENG-1","title":"t"}}],
         "subscribers":[{"userId":"u1","unsubscribed":false,"reason":"ASSIGNED"},
                        {"userId":"u2","unsubscribed":true,"reason":"MANUAL"}]}
        """
        let detail = try decode(IssueDetail.self, json)
        #expect(detail.issue.id == "i1")
        #expect(detail.children.map(\.id) == ["i1a"])
        #expect(detail.attachments.first?.title == "X")
        #expect(detail.relations.first?.counterpart(of: "i1").identifier == "ENG-2")
        #expect(detail.blockedBy.first?.counterpart(of: "i1").identifier == "ENG-9")
        #expect(detail.isSubscribed("u1"))
        #expect(!detail.isSubscribed("u2"))

        let again = try PolarisJSON.decoder().decode(IssueDetail.self, from: try PolarisJSON.encoder().encode(detail))
        #expect(again == detail)
    }

    @Test("an issue detail with none of the lists is the issue on its own")
    func bareIssueDetail() throws {
        let detail = try decode(IssueDetail.self, issueJSON)
        #expect(detail.children.isEmpty && detail.relations.isEmpty && detail.subscribers.isEmpty)
    }

    @Test("an unknown relation type reads as related")
    func unknownRelation() throws {
        let relation = try decode(IssueRelation.self, """
        {"id":"r","type":"MIRRORS","relatedIssue":{"id":"i2","identifier":"ENG-2","title":"o"}}
        """)
        #expect(relation.type == .related)
        #expect(relation.issue == nil)
        #expect(relation.counterpart(of: "i1").id == "i2")
    }

    @Test("a history entry keeps its JSON values whatever their shape")
    func history() throws {
        let entries = try decode([IssueHistoryEntry].self, """
        [{"id":"h1","kind":"state","actor":{"type":"USER","id":"u1"},
          "fromValue":{"id":"s2","name":"Todo"},"toValue":"In Progress","createdAt":"2026-08-19T13:00:00Z"},
         {"id":"h2","kind":"estimate","actor":{"type":"SYSTEM","id":null},
          "fromValue":null,"toValue":2.5,"createdAt":"2026-08-19T14:00:00Z"},
         {"id":"h3","kind":"priority","actor":{"type":"USER","id":"u1"},
          "fromValue":1,"toValue":true,"createdAt":"2026-08-19T15:00:00Z"}]
        """)
        #expect(entries[0].fromValue == .object(["id": .string("s2"), "name": .string("Todo")]))
        #expect(entries[0].toValue?.stringValue == "In Progress")
        #expect(entries[1].fromValue == nil)
        #expect(entries[1].toValue == .double(2.5))
        #expect(entries[2].fromValue == .int(1))
        #expect(entries[2].toValue == .bool(true))
    }

    @Test("a favourite of a kind this build does not know is kept, not dropped")
    func favoriteKinds() throws {
        let rows = try decode([Favorite].self, """
        [{"id":"f1","kind":"ISSUE","targetId":"i3","name":null},
         {"id":"f2","kind":"DASHBOARD","targetId":"d1","name":null},
         {"id":"f3","kind":"FOLDER","targetId":"f3","name":"Mine"}]
        """)
        #expect(rows.map(\.kind) == [.issue, .other, .folder])
        #expect(rows[2].name == "Mine")
    }

    /// Every value of the schema's `NotificationType` gets its own symbol and sentence.
    /// Read from the schema itself, so a type the server adds is a failing test rather than
    /// a bell icon that says "Update".
    @Test("every notification type in the schema is rendered, not folded into other")
    func notificationTypesCoverSchema() throws {
        let schemaURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "schema/schema.graphql")
        let schema = try String(contentsOf: schemaURL, encoding: .utf8)
        let block = try #require(schema.range(of: "enum NotificationType {"))
        let end = try #require(schema.range(of: "}", range: block.upperBound..<schema.endIndex))
        let values = schema[block.upperBound..<end.lowerBound]
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("\"") && !$0.hasPrefix("#") }
        #expect(values.count >= 20)
        for value in values {
            let type = PolarisNotificationType(rawValue: value)
            #expect(type != nil && type != .other, "\(value) is not rendered")
            #expect(type?.summary.isEmpty == false)
            #expect(type?.symbolName.isEmpty == false)
        }
    }
}

@Suite("Parity inputs")
struct ParityInputTests {
    @Test("every clearable property has its own flag, and nil never means clear")
    func clearFlags() {
        let untouched = IssueChange(id: "i1", title: "x")
        #expect(!untouched.clearDueDate && !untouched.clearEstimate && !untouched.clearParent)
        #expect(!untouched.clearProject && !untouched.clearCycle)

        let cleared = IssueChange(id: "i1", clearEstimate: true, clearDueDate: true, clearParent: true,
                                  clearProject: true, clearCycle: true)
        #expect(cleared.clearEstimate && cleared.clearDueDate && cleared.clearParent)
        #expect(cleared.clearProject && cleared.clearCycle)
        #expect(cleared.estimate == nil && cleared.dueDate == nil)
    }

    @Test("a draft carries labels, dates, planning and a parent")
    func draftFields() {
        let draft = IssueDraft(
            teamId: "t1", title: "x", labelIds: ["l1", "l2"], dueDate: "2026-09-12",
            estimate: 3, projectId: "p1", cycleId: "cy1", parentId: "i1"
        )
        #expect(draft.labelIds == ["l1", "l2"])
        #expect(draft.dueDate == "2026-09-12" && draft.estimate == 3)
        #expect(draft.projectId == "p1" && draft.cycleId == "cy1" && draft.parentId == "i1")
        // The plain form still exists, with nothing extra.
        #expect(IssueDraft(teamId: "t1", title: "y").labelIds.isEmpty)
    }

    @Test("the socket URL follows the API origin's scheme and ends at /sync")
    func socketURL() {
        #expect(PolarisEnvironment.hosted.syncSocketURL.absoluteString == "wss://polaris.peixotolabs.com/sync")
        #expect(PolarisEnvironment.localDevelopment.syncSocketURL.absoluteString == "ws://localhost:8088/sync")
        let odd = PolarisEnvironment(apiBaseURL: URL(string: "https://polaris.example:8443/base?x=1")!, allowsDevSession: false)
        #expect(odd.syncSocketURL.absoluteString == "wss://polaris.example:8443/sync")
    }

    @Test("the filter AST spells clauses the way the grammar does")
    func filterAST() throws {
        let created = IssueFilter.myIssues(scope: .created, viewerId: "u1", includeCompleted: false)
        let data = try JSONEncoder().encode(created)
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(root["conj"] as? String == "and")
        let nodes = try #require(root["nodes"] as? [[String: Any]])
        #expect(nodes.count == 2)
        #expect(nodes[0]["field"] as? String == "creator")
        #expect(nodes[0]["op"] as? String == "eq")
        #expect(nodes[0]["values"] as? [String] == ["u1"])
        #expect(nodes[1]["field"] as? String == "stateCategory")
        #expect(nodes[1]["op"] as? String == "notIn")
        #expect(nodes[1]["values"] as? [String] == ["completed", "canceled", "duplicate"])

        let subscribed = IssueFilter.myIssues(scope: .subscribed, viewerId: "u1", includeCompleted: true)
        let subscribedData = try JSONEncoder().encode(subscribed)
        let subscribedRoot = try #require(try JSONSerialization.jsonObject(with: subscribedData) as? [String: Any])
        let subscribedNodes = try #require(subscribedRoot["nodes"] as? [[String: Any]])
        #expect(subscribedNodes.count == 1)
        #expect(subscribedNodes[0]["field"] as? String == "subscriber")

        // `isNull` carries no `values` key at all — an empty array is refused server-side.
        let unassigned = try JSONEncoder().encode(IssueFilter.clause("assignee", .isNull))
        let unassignedRoot = try #require(try JSONSerialization.jsonObject(with: unassigned) as? [String: Any])
        #expect(unassignedRoot.keys.contains("values") == false)
    }

    @Test("a JSON value decodes every shape and encodes it back")
    func jsonValueRoundTrip() throws {
        let source = #"{"a":1,"b":2.5,"c":true,"d":"s","e":null,"f":[1,"x"],"g":{"h":false}}"#
        let value = try PolarisJSON.decoder().decode(JSONValue.self, from: Data(source.utf8))
        #expect(value == .object([
            "a": .int(1), "b": .double(2.5), "c": .bool(true), "d": .string("s"), "e": .null,
            "f": .array([.int(1), .string("x")]), "g": .object(["h": .bool(false)]),
        ]))
        let again = try PolarisJSON.decoder().decode(JSONValue.self, from: try JSONEncoder().encode(value))
        #expect(again == value)
    }

    @Test("every My-issues scope has a label")
    func scopes() {
        for scope in MyIssuesScope.allCases {
            #expect(!scope.label.isEmpty)
        }
        #expect(MyIssuesScope.allCases.first == .assigned)
    }
}
