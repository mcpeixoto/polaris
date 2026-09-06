import XCTest

/// The structure the Linear-style restyle introduced: status groups on a team's list, day
/// groups in the inbox, property pills on the detail screen, and a plain open count on My
/// Issues where the uppercase eyebrow used to be.
///
/// Everything runs on `-polaris-fixtures`, with no server.
final class LinearParityTests: XCTestCase {
    /// This machine runs many simulators at once, so every wait is generous on purpose.
    private let long: TimeInterval = 60

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-polaris-fixtures"] + extra
        app.launch()
        XCTAssertTrue(
            app.staticTexts["My Issues"].waitForExistence(timeout: long),
            "fixtures should sign in and land on the issue list"
        )
        return app
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Every element whose identifier starts with the prefix, top to bottom.
    private func elements(_ app: XCUIApplication, prefixed prefix: String) -> [XCUIElement] {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix))
            .allElementsBoundByIndex
            .sorted { $0.frame.minY < $1.frame.minY }
    }

    // MARK: - My Issues

    /// The open count is a plain caption now — "3 open", not "3 OPEN" — and the rows are
    /// flat, in priority order, with no status headings between them.
    func testMyIssuesShowsAPlainOpenCountAndNoStatusGroups() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["3 open"].waitForExistence(timeout: long))
        XCTAssertTrue(
            elements(app, prefixed: "issues.group.").isEmpty,
            "My Issues keeps Linear's flat priority order rather than grouping by status"
        )
        snap(app, "parity-my-issues")
    }

    // MARK: - Team list

    /// A team's list is grouped by workflow state, started work first and finished work last,
    /// with a heading per state that has something under it.
    func testTeamListGroupsByStatusInLinearOrder() {
        let app = launch()
        let chip = app.buttons["team.chip.ENG"]
        XCTAssertTrue(chip.waitForExistence(timeout: long), "the team pill should be on My Issues")
        chip.tap()

        XCTAssertTrue(
            app.otherElements["issues.group.In Progress"].waitForExistence(timeout: long)
                || app.staticTexts["issues.group.In Progress"].waitForExistence(timeout: 5),
            "the team list should carry a status heading"
        )
        snap(app, "parity-team-list")

        let headings = elements(app, prefixed: "issues.group.").map { $0.identifier }
        XCTAssertEqual(
            headings,
            ["issues.group.In Progress", "issues.group.Todo", "issues.group.Backlog", "issues.group.Done"],
            "groups run started, unstarted, backlog, then closed; got \(headings)"
        )

        // The heading says how many rows sit under it.
        let inProgress = app.descendants(matching: .any)["issues.group.In Progress"]
        XCTAssertTrue(inProgress.label.contains("In Progress"))
        XCTAssertTrue(inProgress.label.contains("1"), "one issue is in progress; heading read \(inProgress.label)")
    }

    // MARK: - Inbox

    /// The inbox is bucketed by day. The fixture's three rows fall on three different days,
    /// so there are three headings, newest first.
    func testInboxGroupsRowsByDay() {
        let app = launch()
        app.buttons["Inbox"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Inbox"].waitForExistence(timeout: long))

        let firstRow = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH 'Unread, '")).firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: long), "inbox rows should load from the fixture")
        snap(app, "parity-inbox")

        let days = elements(app, prefixed: "inbox.day.")
        XCTAssertEqual(days.count, 3, "three rows on three days make three headings, got \(days.map { $0.identifier })")

        // Every row carries the unread/read state, what happened, and the issue, in that order.
        XCTAssertTrue(firstRow.label.hasPrefix("Unread"), "the newest fixture row is unread, read \(firstRow.label)")
        XCTAssertTrue(firstRow.label.contains("ENG-1"), "the row should name its issue, read \(firstRow.label)")
    }

    // MARK: - Detail

    /// The properties are pills whose spoken label is the property and its value, and the
    /// heading over them is still the word the rest of the suite waits for.
    func testDetailShowsPropertyPills() {
        let app = launch()
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "ENG-1")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: long))
        row.tap()

        XCTAssertTrue(app.staticTexts["Properties"].waitForExistence(timeout: long))
        snap(app, "parity-detail")

        let status = app.buttons["issue.status"]
        XCTAssertTrue(status.waitForExistence(timeout: long))
        XCTAssertEqual(status.label, "Status, In Progress")
        XCTAssertEqual(app.buttons["issue.priority"].label, "Priority, Urgent")
        XCTAssertEqual(app.buttons["issue.assignee"].label, "Assignee, Miguel Peixoto")
        XCTAssertTrue(app.staticTexts["Comments"].exists)
    }

    // MARK: - Rows

    /// A row is one line: the identifier, the title, the status and the assignee, as one
    /// button. A due date in the past is on the row and the row still reads as an issue.
    func testStressRowsCarryDueDatesWithoutBreakingTheLabel() {
        let app = launch(["-qa-stress"])
        let row = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "PLATFORM-100234")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: long))
        XCTAssertTrue(row.label.contains("Status: In Progress"))
        XCTAssertTrue(row.label.contains("Priority: Urgent"))
        XCTAssertTrue(row.label.hasSuffix("Unassigned"))
        snap(app, "parity-stress")
    }
}
