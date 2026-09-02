import XCTest

/// QA sweep over issue detail, comments and settings.
///
/// Everything here runs against `-polaris-fixtures`, so there is no server and no account.
/// Several tests are exploratory rather than assertive: they dump the accessibility tree,
/// because the question being answered ("what would VoiceOver say?") is not a value the app
/// exposes to an assertion.
///
/// The `-qa-*` arguments are read by `QAFixtureSwitches` in FixturePolarisClient.swift. They
/// only reshape the in-memory fixture — a plan string, an empty workflow-state list, an armed
/// write failure, long text, seeded comments — so that states the stock fixture cannot produce
/// are reachable without a server.
///
/// Prefer an accessibility identifier over a label wherever the app ships one. The property
/// rows are `Menu`s whose label is the row read out whole — "Status, In Progress" — so a
/// lookup by the word "Status" finds nothing, and one by the current value stops working the
/// moment the test changes it.
final class DetailAndSettingsTests: XCTestCase {
    private let hugeType = [
        "-UIPreferredContentSizeCategoryName",
        "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
    ]

    /// This machine runs many simulators at once, so every wait is generous on purpose.
    private let long: TimeInterval = 60

    @discardableResult
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-polaris-fixtures"] + extra
        app.launch()
        return app
    }

    private func snap(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func dump(_ app: XCUIApplication, _ tag: String) {
        print("QA-TREE-BEGIN \(tag)\n\(app.debugDescription)\nQA-TREE-END \(tag)")
    }

    private func openFirstIssue(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: long))
        let row = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "ENG-1")
        ).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: long), "ENG-1 row should exist")
        row.tap()
    }

    /// Menu-style pickers surface differently across SDKs; try the label, then the value.
    private func tapPicker(_ app: XCUIApplication, label: String, value: String) -> Bool {
        let byLabel = app.buttons[label].firstMatch
        if byLabel.waitForExistence(timeout: 8) { byLabel.tap(); return true }
        let containing = app.buttons.containing(
            NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", label, value)
        ).firstMatch
        if containing.waitForExistence(timeout: 8) { containing.tap(); return true }
        let other = app.otherElements.containing(
            NSPredicate(format: "label CONTAINS[c] %@", label)
        ).firstMatch
        if other.waitForExistence(timeout: 5) { other.tap(); return true }
        return false
    }

    private func composerField(_ app: XCUIApplication) -> XCUIElement {
        app.textViews.firstMatch.waitForExistence(timeout: 10)
            ? app.textViews.firstMatch
            : app.textFields.firstMatch
    }

    // MARK: - Detail, stock fixtures

    /// 1, 2 and the list/detail consistency question, in one launch.
    func testDetailBaselineAndPickers() {
        let app = launch()
        openFirstIssue(app)

        // The title is an editable `TextField` now, not a label, so it carries its text as a
        // value under the identifier rather than as the name of a static text.
        let title = app.textFields["issue.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 20), "detail should open seeded")
        XCTAssertEqual(
            title.value as? String, "Sync drops a comment on reconnect",
            "the detail screen should open on the row that was tapped"
        )
        snap("01-detail-open")
        dump(app, "DETAIL-OPEN")

        XCTAssertTrue(app.staticTexts["Properties"].waitForExistence(timeout: long))
        snap("02-properties")

        // Status: In Progress -> Done
        XCTAssertTrue(tapPicker(app, label: "Status", value: "In Progress"), "status row not tappable")
        snap("03-status-menu")
        dump(app, "STATUS-MENU")
        let done = app.buttons["Done"].firstMatch
        if done.waitForExistence(timeout: 10) { done.tap() }
        snap("04-after-status")
        dump(app, "AFTER-STATUS")

        // Priority: Urgent -> Low
        XCTAssertTrue(tapPicker(app, label: "Priority", value: "Urgent"), "priority row not tappable")
        snap("05-priority-menu")
        let low = app.buttons["Low"].firstMatch
        if low.waitForExistence(timeout: 10) { low.tap() }
        snap("06-after-priority")
        dump(app, "AFTER-PRIORITY")

        // Assignee: Miguel Peixoto -> Unassigned
        XCTAssertTrue(tapPicker(app, label: "Assignee", value: "Miguel"), "assignee row not tappable")
        snap("07-assignee-menu")
        let unassigned = app.buttons["Unassigned"].firstMatch
        if unassigned.waitForExistence(timeout: 10) { unassigned.tap() }
        snap("08-after-assignee")
        dump(app, "AFTER-ASSIGNEE")

        // Back to the list: does the row it came from reflect the three writes?
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: long))
        snap("09-list-after-detail-writes")
        dump(app, "LIST-AFTER-WRITES")

        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "ENG-1")).firstMatch
        if row.exists {
            print("QA-ROW-LABEL-AFTER-WRITES: \(row.label)")
            XCTAssertTrue(
                row.label.contains("Unassigned"),
                "list row should reflect the assignee cleared on the detail screen, was: \(row.label)"
            )
        } else {
            print("QA-ROW-LABEL-AFTER-WRITES: ENG-1 no longer in the list")
        }
    }

    /// 2, the specific question: is a refused property write reported at all?
    func testRefusedPropertyWriteIsReported() {
        let app = launch(["-qa-fail-writes"])
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Properties"].waitForExistence(timeout: long))
        snap("10-fail-before")

        XCTAssertTrue(tapPicker(app, label: "Priority", value: "Urgent"), "priority row not tappable")
        let low = app.buttons["Low"].firstMatch
        if low.waitForExistence(timeout: 10) { low.tap() }

        // Give the (failing) write time to come back and roll the value back.
        _ = app.staticTexts["nothing-should-match-this"].waitForExistence(timeout: 5)
        snap("11-fail-after")
        dump(app, "AFTER-REFUSED-WRITE")

        let anyError = app.descendants(matching: .any).containing(
            NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "problem handling", "couldn")
        ).firstMatch
        XCTAssertTrue(
            anyError.exists,
            "a refused property write should say so; nothing on screen mentions the failure"
        )
    }

    /// 3. Status picker with no workflow states for the team.
    func testStatusRowWithNoStates() {
        let app = launch(["-qa-no-states"])
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Properties"].waitForExistence(timeout: long))
        snap("12-no-states")
        dump(app, "NO-STATES")

        let explains = app.descendants(matching: .any).containing(
            NSPredicate(format: "label CONTAINS[c] %@", "status")
        ).firstMatch
        print("QA-NO-STATES-STATUS-ELEMENT exists=\(explains.exists) label=\(explains.exists ? explains.label : "-")")
    }

    // MARK: - Comments

    func testCommentsRenderAndPost() {
        let app = launch(["-qa-comments"])
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Comments"].waitForExistence(timeout: long))
        app.swipeUp()
        snap("13-comments-list")
        dump(app, "COMMENTS-LIST")

        let field = composerField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 20), "composer should exist")
        field.tap()
        field.typeText("Posted from the QA sweep")
        snap("14-comment-typed")

        let post = app.buttons["Post comment"].firstMatch
        XCTAssertTrue(post.waitForExistence(timeout: 10))
        post.tap()
        XCTAssertTrue(
            app.staticTexts.containing(
                NSPredicate(format: "label CONTAINS %@", "Posted from the QA sweep")
            ).firstMatch.waitForExistence(timeout: 20),
            "the posted comment should appear in the list"
        )
        snap("15-comment-posted")
        dump(app, "COMMENT-POSTED")
    }

    func testWhitespaceOnlyCommentIsRefused() {
        let app = launch(["-qa-comments"])
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Comments"].waitForExistence(timeout: long))
        let field = composerField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("     ")
        snap("16-whitespace-typed")
        let post = app.buttons["Post comment"].firstMatch
        XCTAssertTrue(post.exists)
        XCTAssertFalse(post.isEnabled, "post should stay disabled for a whitespace-only draft")
    }

    /// 4, the specific question: on a refused post, is the error shown and is the draft kept?
    func testRefusedCommentKeepsTheDraft() {
        let app = launch(["-qa-comments", "-qa-fail-writes"])
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Comments"].waitForExistence(timeout: long))

        let field = composerField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        let draft = "A comment worth not losing"
        field.typeText(draft)
        snap("17-refused-typed")

        app.buttons["Post comment"].firstMatch.tap()
        _ = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "problem handling")
        ).firstMatch.waitForExistence(timeout: 20)
        snap("18-refused-after")
        dump(app, "COMMENT-REFUSED")

        let errorShown = app.descendants(matching: .any).containing(
            NSPredicate(format: "label CONTAINS[c] %@", "problem handling")
        ).firstMatch.exists
        XCTAssertTrue(errorShown, "a refused comment post should show the error")

        let value = (composerField(app).value as? String) ?? ""
        print("QA-DRAFT-AFTER-FAILURE: '\(value)'")
        XCTAssertTrue(
            value.contains(draft),
            "the typed comment should survive a refused post, composer held: '\(value)'"
        )
    }

    // MARK: - 5/6. Long content, keyboard, Dynamic Type

    func testLongTitleDescriptionAndComments() {
        let app = launch(["-qa-long-text", "-qa-comments"])
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Properties"].waitForExistence(timeout: long))
        snap("19-long-top")
        app.swipeUp()
        snap("20-long-mid")
        app.swipeUp()
        snap("21-long-bottom")
        dump(app, "LONG-TEXT")
    }

    func testComposerStaysAboveTheKeyboard() {
        let app = launch(["-qa-comments"])
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Comments"].waitForExistence(timeout: long))
        let field = composerField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("Typing while the keyboard is up")
        snap("22-composer-keyboard")

        let keyboard = app.keyboards.firstMatch
        guard keyboard.waitForExistence(timeout: 10) else {
            print("QA-KEYBOARD: no software keyboard on this simulator, skipping")
            return
        }
        let keyboardTop = keyboard.frame.minY
        let frame = composerField(app).frame
        print("QA-KEYBOARD field=\(frame) keyboardTop=\(keyboardTop)")
        XCTAssertTrue(
            frame.maxY <= keyboardTop + 1,
            "composer should sit above the keyboard: field=\(frame) keyboardTop=\(keyboardTop)"
        )
    }

    func testDetailAtLargestDynamicType() {
        let app = launch(["-qa-comments"] + hugeType)
        openFirstIssue(app)
        XCTAssertTrue(app.staticTexts["Properties"].waitForExistence(timeout: long))
        snap("23-huge-detail-top")
        app.swipeUp()
        snap("24-huge-detail-mid")
        app.swipeUp()
        snap("25-huge-detail-bottom")
        dump(app, "HUGE-DETAIL")
    }

    // MARK: - Settings

    private func goToSettings(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: long))
        app.buttons["Settings"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: long))
    }

    /// 7. Every plan the label has to cope with, in one test — each needs its own launch.
    func testEveryPlanRendersSensibly() {
        for (plan, tag) in [("pro", "pro"), ("free", "free"), ("self_hosted", "selfhosted"), ("wildcat_tier", "unknown"), ("", "empty")] {
            let app = XCUIApplication()
            app.launchArguments = ["-polaris-fixtures", "-qa-plan", plan]
            app.launch()
            goToSettings(app)
            snap("26-plan-\(tag)")
            dump(app, "PLAN-\(tag.uppercased())")
            app.terminate()
        }
    }

    func testSettingsBaselineAndLongNames() {
        let app = launch()
        goToSettings(app)
        snap("27-settings")
        dump(app, "SETTINGS")
        app.terminate()

        let longApp = XCUIApplication()
        longApp.launchArguments = ["-polaris-fixtures", "-qa-long-names"]
        longApp.launch()
        goToSettings(longApp)
        snap("28-settings-long-names")
        dump(longApp, "SETTINGS-LONG-NAMES")
    }

    func testSettingsAtLargestDynamicType() {
        let app = launch(hugeType)
        goToSettings(app)
        snap("29-settings-huge-top")
        app.swipeUp()
        snap("30-settings-huge-bottom")
        dump(app, "SETTINGS-HUGE")
    }

    /// 8. Sign out.
    func testSignOutReturnsToWelcome() {
        let app = launch()
        goToSettings(app)
        app.buttons["Sign out"].firstMatch.tap()
        XCTAssertTrue(
            app.staticTexts["Sign out of Polaris?"].waitForExistence(timeout: 20),
            "confirmation dialog should appear"
        )
        snap("31-signout-dialog")
        dump(app, "SIGNOUT-DIALOG")

        let confirm = app.sheets.buttons["Sign out"].firstMatch
        if confirm.waitForExistence(timeout: 10) {
            confirm.tap()
        } else {
            let matches = app.buttons.matching(identifier: "Sign out")
            matches.element(boundBy: matches.count - 1).tap()
        }
        snap("32-after-signout")
        let welcome = app.buttons["Create an account"].waitForExistence(timeout: 30)
        dump(app, "AFTER-SIGNOUT")
        XCTAssertTrue(welcome, "signing out should land on the welcome screen")
    }
}
