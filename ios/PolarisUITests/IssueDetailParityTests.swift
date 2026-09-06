import XCTest

/// The detail screen after the Linear parity pass: every property is a pill that opens a
/// picker, the children and the activity feed are on the page, and the overflow menu carries
/// the subscription.
///
/// Everything runs on `-polaris-fixtures`. ENG-1 carries two labels, a due date, an
/// estimate, a project, the running cycle, two children and three history rows; ENG-2 has
/// one comment with a 👍 from the signed-in user.
final class IssueDetailParityTests: XCTestCase {
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

    private func open(_ app: XCUIApplication, _ identifier: String) {
        let row = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", identifier + ",")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: long), "\(identifier) row should exist")
        row.tap()
        XCTAssertTrue(app.staticTexts["Properties"].waitForExistence(timeout: long))
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: - Pills

    /// The labels pill names the labels, opens the picker, and follows a toggle.
    func testLabelsPillOpensPickerAndFollowsAToggle() {
        let app = launch()
        open(app, "ENG-1")

        let pill = app.buttons["issue.labels"]
        XCTAssertTrue(pill.waitForExistence(timeout: long))
        XCTAssertEqual(pill.label, "Labels, backend, regression")
        pill.tap()

        let option = app.buttons["label.option.needs-design"]
        XCTAssertTrue(option.waitForExistence(timeout: long), "the picker should offer the workspace's labels")
        snap(app, "parity-label-picker")
        option.tap()
        app.buttons["labelPicker.done"].tap()

        XCTAssertTrue(
            pill.waitForExistence(timeout: long)
                && waitUntil(timeout: long) { pill.label.contains("needs-design") },
            "the pill should name the label just added, read \(pill.label)"
        )
        snap(app, "parity-labels-after")
    }

    /// The rest of ENG-1's properties are pills, each saying its value.
    func testEveryPropertyIsAPillWithItsValue() {
        let app = launch()
        open(app, "ENG-1")

        let dueDate = app.buttons["issue.dueDate"]
        XCTAssertTrue(dueDate.waitForExistence(timeout: long))
        // "Sep 12" or "12 Sep", depending on the simulator's region — the day and the month
        // are the facts, their order is the locale's.
        XCTAssertTrue(
            dueDate.label.contains("12") && dueDate.label.contains("Sep"),
            "the due date pill should say the day, read \(dueDate.label)"
        )
        XCTAssertEqual(app.buttons["issue.estimate"].label, "Estimate, 3")
        XCTAssertEqual(app.buttons["issue.project"].label, "Project, Mobile parity")
        XCTAssertEqual(app.buttons["issue.cycle"].label, "Cycle, Cycle 7")
        XCTAssertEqual(app.buttons["issue.parent"].label, "Parent, none")
        snap(app, "parity-detail-pills")

        // The estimate picker sets a value and the pill follows.
        app.buttons["issue.estimate"].tap()
        let five = app.buttons["estimatePicker.option.5"]
        XCTAssertTrue(five.waitForExistence(timeout: long))
        five.tap()
        XCTAssertTrue(waitUntil(timeout: long) { app.buttons["issue.estimate"].label == "Estimate, 5" })
    }

    // MARK: - Sections

    func testSubIssuesListTheChildrenWithProgress() {
        let app = launch()
        open(app, "ENG-1")

        XCTAssertTrue(app.staticTexts["Sub-issues"].waitForExistence(timeout: long))
        let child = app.buttons["issue.subIssue.ENG-91"]
        XCTAssertTrue(child.waitForExistence(timeout: long), "ENG-91 should be listed under its parent")
        XCTAssertTrue(child.label.contains("ENG-91"), "read \(child.label)")
        XCTAssertTrue(app.buttons["issue.subIssue.ENG-92"].exists)
        let progress = app.descendants(matching: .any)["issue.subIssues.progress"]
        XCTAssertTrue(progress.exists, "the roll-up should be drawn as a bar")
        XCTAssertEqual(progress.label, "1 of 2 sub-issues done")

        // Tapping a child opens it, and the child's breadcrumb links back up.
        child.tap()
        XCTAssertTrue(app.buttons["issue.parentLink"].waitForExistence(timeout: long))
        XCTAssertTrue(app.buttons["issue.parentLink"].label.contains("ENG-1"))
        snap(app, "parity-sub-issue-open")
    }

    func testActivityShowsHistoryAsSentences() {
        let app = launch()
        open(app, "ENG-1")
        app.swipeUp()
        app.swipeUp()

        XCTAssertTrue(app.staticTexts["Comments"].waitForExistence(timeout: long))
        let moved = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "changed status from Todo to In Progress")
        ).firstMatch
        XCTAssertTrue(moved.waitForExistence(timeout: long), "the state change should read as a sentence")
        XCTAssertTrue(moved.label.hasPrefix("Miguel Peixoto"), "the actor is named first, read \(moved.label)")
        let assigned = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "assigned it to Miguel Peixoto")
        ).firstMatch
        XCTAssertTrue(assigned.exists, "an assignee id should resolve to a name")
        snap(app, "parity-activity")
    }

    // MARK: - Reactions

    func testReactionChipTogglesOff() {
        let app = launch()
        open(app, "ENG-2")
        app.swipeUp()

        let chip = app.buttons["comment.reaction.👍"]
        XCTAssertTrue(chip.waitForExistence(timeout: long), "ENG-2's comment carries a 👍 in the fixture")
        XCTAssertEqual(chip.label, "👍 1")
        snap(app, "parity-reaction")
        chip.tap()
        XCTAssertTrue(
            waitUntil(timeout: long) { !chip.exists },
            "removing the only 👍 should remove the chip"
        )
        XCTAssertFalse(
            app.buttons["comment.addReaction.c-eng2"].exists,
            "with no reactions left the picker goes too; the long-press menu is the way back in"
        )
    }

    // MARK: - Menu

    func testSubscribeTogglesInTheMenu() {
        let app = launch()
        open(app, "ENG-1")

        let menu = app.buttons["issue.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: long))
        menu.tap()
        let unsubscribe = app.buttons["Unsubscribe"]
        XCTAssertTrue(unsubscribe.waitForExistence(timeout: long), "the viewer follows ENG-1 in the fixture")
        XCTAssertTrue(app.buttons["Archive"].exists)
        XCTAssertTrue(app.buttons["Delete"].exists)
        snap(app, "parity-menu")
        unsubscribe.tap()

        menu.tap()
        XCTAssertTrue(app.buttons["Subscribe"].waitForExistence(timeout: long), "the item should flip once the write lands")
        app.buttons["Subscribe"].tap()
        menu.tap()
        XCTAssertTrue(app.buttons["Unsubscribe"].waitForExistence(timeout: long))
    }

    /// Polls rather than sleeping: the write is optimistic and lands in a frame, but the
    /// simulator is shared and a frame can be a while.
    private func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }
}
