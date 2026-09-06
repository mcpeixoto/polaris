import XCTest
import PolarisCore
@testable import Polaris

/// The pure helpers behind the detail screen: how a description is split into blocks, how
/// a history entry is said, and how history and comments are merged into one thread.
/// None of them touch a view, which is what lets them run without a screen.
final class IssueDetailLogicTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(T.self, from: Data(json.utf8))
    }

    private func entry(kind: String, from: String = "null", to: String = "null",
                       actor: String = #"{"type":"USER","id":"u1"}"#, at: String = "2026-08-19T13:00:00Z",
                       id: String = "h") throws -> IssueHistoryEntry {
        try decode("""
        {"id":"\(id)","kind":"\(kind)","actor":\(actor),"fromValue":\(from),"toValue":\(to),"createdAt":"\(at)"}
        """)
    }

    private var names: HistoryText.Names {
        HistoryText.Names(
            users: ["u1": "Miguel Peixoto", "u2": "Ana Silva"],
            states: ["s2": "Todo", "s3": "In Progress"],
            labels: ["lab1": "backend"],
            projects: ["p1": "Mobile parity"],
            cycles: ["cy1": "Cycle 7"],
            issues: ["i9": "ENG-9"]
        )
    }

    // MARK: - Markdown blocks

    func testParagraphsSplitOnBlankLinesAndKeepSoftBreaks() {
        let blocks = MarkdownBlockParser.parse("First line\nsecond line\n\nSecond paragraph")
        XCTAssertEqual(blocks, [.paragraph("First line\nsecond line"), .paragraph("Second paragraph")])
    }

    func testHeadingsUpToThreeLevels() {
        let blocks = MarkdownBlockParser.parse("# One\n## Two\n### Three\n#### Four\n#hashtag")
        XCTAssertEqual(blocks, [
            .heading(level: 1, text: "One"),
            .heading(level: 2, text: "Two"),
            .heading(level: 3, text: "Three"),
            .paragraph("#### Four\n#hashtag"),
        ])
    }

    func testBulletAndOrderedListsWithCheckboxes() {
        let blocks = MarkdownBlockParser.parse("- [ ] open\n- [x] closed\n* plain\n\n1. first\n2. second")
        XCTAssertEqual(blocks, [
            .list(items: [
                .init(text: "open", checked: false),
                .init(text: "closed", checked: true),
                .init(text: "plain", checked: nil),
            ], ordered: false),
            .list(items: [
                .init(text: "first", checked: nil),
                .init(text: "second", checked: nil),
            ], ordered: true),
        ])
    }

    func testAListDirectlyAfterAParagraphStartsANewBlock() {
        let blocks = MarkdownBlockParser.parse("Steps:\n- one\n- two")
        XCTAssertEqual(blocks, [
            .paragraph("Steps:"),
            .list(items: [.init(text: "one", checked: nil), .init(text: "two", checked: nil)], ordered: false),
        ])
    }

    func testQuotesJoinConsecutiveLines() {
        let blocks = MarkdownBlockParser.parse("> quoted\n> more\n\nafter")
        XCTAssertEqual(blocks, [.quote("quoted\nmore"), .paragraph("after")])
    }

    func testFencedCodeKeepsItsContentVerbatim() {
        let blocks = MarkdownBlockParser.parse("```swift\nlet x = 1\n\n# not a heading\n```\ntail")
        XCTAssertEqual(blocks, [
            .code("let x = 1\n\n# not a heading", language: "swift"),
            .paragraph("tail"),
        ])
    }

    func testAnUnclosedFenceRunsToTheEnd() {
        let blocks = MarkdownBlockParser.parse("```\nstill code")
        XCTAssertEqual(blocks, [.code("still code", language: nil)])
    }

    func testEmptyDescriptionHasNoBlocks() {
        XCTAssertEqual(MarkdownBlockParser.parse(""), [])
        XCTAssertEqual(MarkdownBlockParser.parse("\n\n  \n"), [])
    }

    // MARK: - History text

    func testStatusChangeReadsTheRecordedNames() throws {
        let entry = try entry(
            kind: "state",
            from: #"{"id":"s2","name":"Todo"}"#, to: #"{"id":"s3","name":"In Progress"}"#
        )
        XCTAssertEqual(
            HistoryText.line(for: entry, names: names),
            "Miguel Peixoto changed status from Todo to In Progress"
        )
    }

    func testStatusChangeResolvesBareIdsThroughNames() throws {
        let entry = try entry(kind: "state", from: #""s2""#, to: #""s3""#)
        XCTAssertEqual(HistoryText.describe(entry, names: names), "changed status from Todo to In Progress")
    }

    func testAssigneeIdIsResolvedToTheCurrentName() throws {
        let assigned = try entry(kind: "assignee", to: #""u1""#, actor: #"{"type":"USER","id":"u2"}"#)
        XCTAssertEqual(HistoryText.line(for: assigned, names: names), "Ana Silva assigned it to Miguel Peixoto")

        let cleared = try entry(kind: "assignee", from: #""u1""#)
        XCTAssertEqual(HistoryText.describe(cleared, names: names), "unassigned Miguel Peixoto")
    }

    func testUnknownPersonFallsBackWithoutCrashing() throws {
        let entry = try entry(kind: "assignee", to: #""u404""#, actor: #"{"type":"USER","id":"u404"}"#)
        XCTAssertEqual(HistoryText.line(for: entry, names: names), "Somebody assigned it to u404")
    }

    func testPriorityUsesTheScaleLabels() throws {
        let entry = try entry(kind: "priority", from: "4", to: "1")
        XCTAssertEqual(HistoryText.describe(entry, names: names), "changed priority from Low to Urgent")
    }

    func testCreatedAndSystemActor() throws {
        let entry = try entry(kind: "created", actor: #"{"type":"SYSTEM","id":null}"#)
        XCTAssertEqual(HistoryText.line(for: entry, names: names), "Polaris created the issue")
    }

    func testLabelProjectCycleParentAndEstimate() {
        XCTAssertEqual(HistoryText.describe(kind: "label", from: nil, to: .string("lab1"), names: names), "added the label backend")
        XCTAssertEqual(HistoryText.describe(kind: "label", from: .string("lab1"), to: nil, names: names), "removed the label backend")
        XCTAssertEqual(HistoryText.describe(kind: "project", from: nil, to: .string("p1"), names: names), "put it in Mobile parity")
        XCTAssertEqual(HistoryText.describe(kind: "project", from: .string("p1"), to: .null, names: names), "took it out of the project")
        XCTAssertEqual(HistoryText.describe(kind: "cycle", from: nil, to: .string("cy1"), names: names), "moved it to Cycle 7")
        XCTAssertEqual(HistoryText.describe(kind: "parent", from: nil, to: .string("i9"), names: names), "made it a sub-issue of ENG-9")
        XCTAssertEqual(HistoryText.describe(kind: "parent", from: .string("i9"), to: nil, names: names), "made it a top-level issue")
        XCTAssertEqual(HistoryText.describe(kind: "estimate", from: nil, to: .int(3), names: names), "estimated it at 3")
        XCTAssertEqual(HistoryText.describe(kind: "estimate", from: .int(3), to: nil, names: names), "removed the estimate")
    }

    func testDueDateInBothSpellingsAndCleared() {
        let set = HistoryText.describe(kind: "due_date", from: nil, to: .string("2026-09-12"), names: names)
        XCTAssertTrue(set.hasPrefix("set the due date to "), set)
        XCTAssertTrue(set.contains("12"), "should name the day: \(set)")
        XCTAssertEqual(
            HistoryText.describe(kind: "dueDate", from: .string("2026-09-12"), to: nil, names: names),
            "cleared the due date"
        )
    }

    func testTitleRenameAndSubscription() {
        XCTAssertEqual(
            HistoryText.describe(kind: "title", from: .string("Old"), to: .string("New"), names: names),
            "renamed it from “Old” to “New”"
        )
        XCTAssertEqual(HistoryText.describe(kind: "subscribe", from: nil, to: .bool(false), names: names), "stopped watching the issue")
        XCTAssertEqual(HistoryText.describe(kind: "subscribe", from: nil, to: .bool(true), names: names), "started watching the issue")
    }

    func testAnUnknownKindIsHumanised() {
        XCTAssertEqual(HistoryText.describe(kind: "slaBreached", from: nil, to: nil, names: names), "changed the sla breached")
        XCTAssertEqual(HistoryText.describe(kind: "snooze_until", from: nil, to: nil, names: names), "changed the snooze until")
    }

    // MARK: - Activity merge

    func testHistoryAndCommentsInterleaveByDate() throws {
        let created = try entry(kind: "created", at: "2026-08-01T09:00:00Z", id: "h1")
        let moved = try entry(kind: "state", at: "2026-08-19T13:00:00Z", id: "h2")
        let comment: Comment = try decode("""
        {"id":"c1","body":"Reproduced.","actor":{"type":"USER","id":"u2"},"editedAt":null,
         "createdAt":"2026-08-19T10:00:00Z"}
        """)
        let items = IssueActivity.merge(history: [moved, created], comments: [comment])
        XCTAssertEqual(items.map(\.id), ["event-h1", "comment-c1", "event-h2"])
    }

    func testTiesKeepTheirInputOrder() throws {
        let event = try entry(kind: "state", at: "2026-08-19T10:00:00Z", id: "h1")
        let comment: Comment = try decode("""
        {"id":"c1","body":"Same second.","actor":{"type":"USER","id":"u2"},"editedAt":null,
         "createdAt":"2026-08-19T10:00:00Z"}
        """)
        XCTAssertEqual(IssueActivity.merge(history: [event], comments: [comment]).map(\.id), ["event-h1", "comment-c1"])
    }

    // MARK: - Pickers

    func testDayStringIsZeroPaddedWireFormat() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = ISO8601DateFormatter().date(from: "2026-03-05T12:00:00Z")!
        XCTAssertEqual(DatePickerSheet.dayString(date, calendar: calendar), "2026-03-05")
    }

    func testCycleSectionsRunActiveUpcomingPast() throws {
        let now = ISO8601DateFormatter().date(from: "2026-09-06T12:00:00Z")!
        func cycle(_ id: String, _ number: Int, _ start: String, _ end: String) throws -> Cycle {
            try decode("""
            {"id":"\(id)","teamId":"t1","number":\(number),"name":"","description":null,
             "startsAt":"\(start)","endsAt":"\(end)","completedAt":null}
            """)
        }
        let past = try cycle("a", 5, "2026-08-01T00:00:00Z", "2026-08-15T00:00:00Z")
        let active = try cycle("b", 7, "2026-09-01T00:00:00Z", "2026-09-15T00:00:00Z")
        let upcoming = try cycle("c", 8, "2026-09-15T00:00:00Z", "2026-09-29T00:00:00Z")
        let sections = CyclePicker.sections([upcoming, past, active], now: now)
        XCTAssertEqual(sections.map(\.title), ["Active", "Upcoming", "Past"])
        XCTAssertEqual(sections.map { $0.cycles.map(\.id) }, [["b"], ["c"], ["a"]])
    }
}
