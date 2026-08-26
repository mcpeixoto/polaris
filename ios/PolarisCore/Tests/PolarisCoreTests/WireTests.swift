import Foundation
import Testing
@testable import PolarisCore

// These tests cover the places where this client can silently disagree with the server:
// identity format, partial-update semantics, and the two date shapes Go emits. Each one
// stands for a bug that is invisible in the UI until data is wrong.

@Suite("Client-minted identity")
struct UUIDv7Tests {
    @Test("is shaped like a v7 UUID")
    func layout() {
        let value = UUIDv7.string()
        #expect(value.count == 36)
        let groups = value.split(separator: "-").map(String.init)
        #expect(groups.map(\.count) == [8, 4, 4, 4, 12])
        // The server rejects a create whose id is not v7, so the version nibble and the
        // variant bits are the contract, not cosmetics.
        #expect(groups[2].hasPrefix("7"))
        #expect("89ab".contains(groups[3].first!))
    }

    @Test("is parseable by Foundation")
    func parseable() {
        #expect(UUID(uuidString: UUIDv7.string()) != nil)
    }

    @Test("orders by time, because the timestamp leads")
    func monotonic() {
        let early = UUIDv7.string(now: Date(timeIntervalSince1970: 1_000_000), randomness: { 0 })
        let late = UUIDv7.string(now: Date(timeIntervalSince1970: 2_000_000), randomness: { 0 })
        #expect(early < late)
    }
}

@Suite("Partial updates")
struct JSONValueTests {
    @Test("omits absent fields instead of nulling them")
    func compactingDropsNil() throws {
        // The distinction under test: an absent key means "leave alone", an explicit null
        // means "clear". Encoding nil as null would wipe every field the user did not touch.
        let value = JSONValue.object(compacting: [
            "id": .string("abc"),
            "title": .string("new title"),
            "assigneeId": nil,
        ])
        let data = try JSONEncoder().encode(value)
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(root["title"] as? String == "new title")
        #expect(root.keys.contains("assigneeId") == false)
    }

    @Test("clearAssignee is sent only when set")
    func clearAssigneeIsExplicit() throws {
        let untouched = IssueChange(id: "i1", stateId: "s1")
        #expect(untouched.clearAssignee == false)

        let cleared = IssueChange(id: "i1", clearAssignee: true)
        #expect(cleared.clearAssignee)
    }
}

@Suite("Decoding what the server actually sends")
struct DecodingTests {
    /// Go's time.Time emits fractional seconds only when the value has them, so one server
    /// sends both shapes for the same field. A single ISO8601 strategy fails intermittently
    /// on real data — which looks like a flaky network rather than a decoding bug.
    @Test("accepts RFC3339 with and without fractional seconds")
    func bothDateShapes() throws {
        struct Row: Decodable { let at: Date }
        let decoder = PolarisJSON.decoder()

        let plain = try decoder.decode(Row.self, from: Data(#"{"at":"2026-08-25T10:00:00Z"}"#.utf8))
        let fractional = try decoder.decode(Row.self, from: Data(#"{"at":"2026-08-25T10:00:00.512Z"}"#.utf8))

        #expect(Int(plain.at.timeIntervalSince1970) == 1787652000)
        #expect(fractional.at > plain.at)
    }

    @Test("an unknown state category degrades instead of throwing")
    func unknownCategory() throws {
        // A server that adds a category must not empty an already-shipped app's issue list.
        struct Row: Decodable { let category: StateCategory }
        let row = try PolarisJSON.decoder().decode(
            Row.self, from: Data(#"{"category":"SOMETHING_NEW"}"#.utf8)
        )
        #expect(row.category == .backlog)
    }

    @Test("an out-of-range priority clamps to none")
    func unknownPriority() throws {
        let json = """
        {"id":"1","identifier":"ENG-1","title":"t","description":"","priority":99,
         "state":{"id":"s","name":"Todo","color":"#fff","category":"UNSTARTED","position":"a"},
         "team":{"id":"t","key":"ENG","name":"Eng"},
         "labels":[],"createdAt":"2026-08-25T10:00:00Z","updatedAt":"2026-08-25T10:00:00Z"}
        """
        let issue = try PolarisJSON.decoder().decode(Issue.self, from: Data(json.utf8))
        #expect(issue.priority == .none)
        #expect(issue.assignee == nil)
    }

    @Test("priority sorts urgent first and none last")
    func prioritySortWeight() {
        let ordered = Priority.allCases.sorted { $0.sortWeight < $1.sortWeight }
        // Spelled out: bare `.none` in an optional comparison resolves to Optional.none, so
        // this assertion silently compares against nil and passes for the wrong reason.
        #expect(ordered.first == Priority.urgent)
        #expect(ordered.last == Priority.none)
    }
}

@Suite("Error mapping")
struct ErrorTests {
    @Test("only transport-ish failures offer a retry")
    func retryability() {
        #expect(PolarisError.offline.isRetryable)
        #expect(PolarisError.timedOut.isRetryable)
        #expect(PolarisError.unauthorized.isRetryable == false)
        #expect(PolarisError.validation(message: "no", field: nil).isRetryable == false)
    }

    @Test("every case has copy that can be shown to a user")
    func displayMessages() {
        let cases: [PolarisError] = [
            .offline, .timedOut, .unauthorized, .forbidden, .notFound,
            .rateLimited(retryAfter: 30), .validation(message: "Title is required", field: "title"),
            .server(status: 500, message: nil), .decoding("x"), .badResponse,
        ]
        for error in cases {
            #expect(error.displayMessage.isEmpty == false)
        }
        #expect(PolarisError.validation(message: "Title is required", field: "title")
            .displayMessage == "Title is required")
    }
}
