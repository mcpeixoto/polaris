import XCTest
import PolarisCore
@testable import Polaris

/// The pure helpers behind the Linear-style list: how a due date is said, how an inbox is
/// bucketed by day, and how a team's list is grouped by status. Each takes its clock and
/// calendar as arguments, which is what makes these assertions the same at midnight as at
/// noon and the same in Lisbon as in Auckland.
final class ListPresentationTests: XCTestCase {
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }()

    private func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: iso)!
    }

    // MARK: - Due dates

    func testDueDateBeforeTodayIsOverdue() throws {
        let today = date("2026-09-06T12:00:00Z")
        let due = try XCTUnwrap(DueDateFormat.present("2026-08-30", relativeTo: today, calendar: utc))
        XCTAssertTrue(due.isOverdue)
        XCTAssertTrue(due.text.contains("30"), "should name the day, got \(due.text)")
        XCTAssertFalse(due.text.contains("2026"), "same year, so no year: \(due.text)")
    }

    func testDueTodayIsNotOverdue() throws {
        let today = date("2026-09-06T23:59:00Z")
        let due = try XCTUnwrap(DueDateFormat.present("2026-09-06", relativeTo: today, calendar: utc))
        XCTAssertFalse(due.isOverdue, "due today is the day it is due, not a missed deadline")
    }

    func testDueDateInAnotherYearSaysTheYear() throws {
        let today = date("2026-09-06T12:00:00Z")
        let due = try XCTUnwrap(DueDateFormat.present("2027-01-15", relativeTo: today, calendar: utc))
        XCTAssertFalse(due.isOverdue)
        XCTAssertTrue(due.text.contains("2027"), "a different year has to be said: \(due.text)")
    }

    func testMalformedDueDateRendersAsNoDate() {
        let today = date("2026-09-06T12:00:00Z")
        XCTAssertNil(DueDateFormat.present("soon", relativeTo: today, calendar: utc))
        XCTAssertNil(DueDateFormat.present("2026-13-01", relativeTo: today, calendar: utc))
        XCTAssertNil(DueDateFormat.present("2026-02-30", relativeTo: today, calendar: utc))
    }

    // MARK: - Day grouping

    func testDayGroupingNamesTodayAndYesterdayThenDates() {
        let now = date("2026-08-25T15:00:00Z")
        let titles = [
            "2026-08-25T09:00:00Z",
            "2026-08-25T01:00:00Z",
            "2026-08-24T16:30:00Z",
            "2026-08-23T11:00:00Z",
            "2025-12-31T11:00:00Z",
        ].map { DayGrouping.title(for: date($0), now: now, calendar: utc) }

        XCTAssertEqual(titles[0], "Today")
        XCTAssertEqual(titles[1], "Today", "any time on the day is today, not just the same hour")
        XCTAssertEqual(titles[2], "Yesterday")
        XCTAssertTrue(titles[3].contains("23"), "an older day is dated: \(titles[3])")
        XCTAssertFalse(titles[3].contains("2026"), "same year, so no year: \(titles[3])")
        XCTAssertTrue(titles[4].contains("2025"), "a previous year says so: \(titles[4])")
    }

    func testDayGroupingKeepsTheCallerOrderAndBucketsConsecutiveRuns() {
        let now = date("2026-08-25T15:00:00Z")
        let items = ["2026-08-25T09:00:00Z", "2026-08-25T08:00:00Z", "2026-08-24T16:30:00Z", "2026-08-23T11:00:00Z"]
            .map(date)
        let groups = DayGrouping.group(items, date: { $0 }, now: now, calendar: utc)

        XCTAssertEqual(groups.map(\.title), ["Today", "Yesterday", groups[2].title])
        XCTAssertEqual(groups.map(\.items.count), [2, 1, 1])
        XCTAssertEqual(groups[0].items, [items[0], items[1]], "newest first, as handed in")
    }

    func testDayGroupingOfNothingIsNothing() {
        let groups = DayGrouping.group([Date](), date: { $0 }, now: .now, calendar: utc)
        XCTAssertTrue(groups.isEmpty)
    }

    // MARK: - Status grouping

    func testStatusGroupsRunStartedThenUnstartedThenBacklogThenClosed() {
        let states = FixtureData.states
        let issues = IssueOrder.sorted(FixtureData.baseIssues)
        let groups = IssueGrouping.byStatus(issues) { _ in states }

        XCTAssertEqual(groups.map(\.state.name), ["In Progress", "Todo", "Backlog", "Done"])
        XCTAssertEqual(
            groups.map { $0.issues.map(\.identifier) },
            [["ENG-1"], ["ENG-2"], ["ENG-3"], ["ENG-4"]]
        )
    }

    func testStatusGroupsOmitStatesWithNoIssues() {
        let states = FixtureData.states
        let open = FixtureData.baseIssues.filter { $0.state.category.isOpen }
        let groups = IssueGrouping.byStatus(open) { _ in states }

        XCTAssertFalse(groups.contains { $0.state.name == "Done" }, "an empty group is not a group")
        XCTAssertEqual(groups.count, 3)
    }

    func testStatusGroupsKeepTheOrderInsideAGroup() {
        let states = FixtureData.states
        let todo = states[1]
        let issues = [
            FixtureData.issue(id: "a", identifier: "ENG-10", title: "First", priority: .urgent, state: todo),
            FixtureData.issue(id: "b", identifier: "ENG-11", title: "Second", priority: .low, state: todo),
            FixtureData.issue(id: "c", identifier: "ENG-12", title: "Third", priority: Priority.none, state: todo),
        ]
        let groups = IssueGrouping.byStatus(issues) { _ in states }

        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].issues.map(\.identifier), ["ENG-10", "ENG-11", "ENG-12"])
    }

    func testStatusGroupsWithinACategoryFollowTheWorkspaceOrder() throws {
        // Two unstarted states, positioned "Later" before "Soon" in the workspace.
        let decoder = JSONDecoder()
        let later = try decoder.decode(WorkflowState.self, from: Data(
            ##"{"id":"u1","name":"Later","color":"#9AA0A6","category":"UNSTARTED","position":"a"}"##.utf8))
        let soon = try decoder.decode(WorkflowState.self, from: Data(
            ##"{"id":"u2","name":"Soon","color":"#9AA0A6","category":"UNSTARTED","position":"b"}"##.utf8))
        let issues = [
            FixtureData.issue(id: "a", identifier: "ENG-1", title: "A", priority: .high, state: soon),
            FixtureData.issue(id: "b", identifier: "ENG-2", title: "B", priority: .high, state: later),
        ]
        let groups = IssueGrouping.byStatus(issues) { _ in [later, soon] }

        XCTAssertEqual(groups.map(\.state.name), ["Later", "Soon"])
    }
}
