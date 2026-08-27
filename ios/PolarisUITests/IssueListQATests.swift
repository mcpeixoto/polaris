import XCTest

/// QA sweep over the issue list and the issue composer.
///
/// These tests are diagnostic as much as assertive: they print the accessibility tree so the
/// exact rendered strings can be read out of the `xcodebuild test` log, and attach screenshots
/// so layout can be inspected afterwards.
///
/// Tests whose name ends in `_QAFixtures` depend on the temporary `-qa-*` fixture variants
/// added to `FixtureData` for this sweep.
///
/// Several checks are grouped into one test on purpose: an app launch costs ~30-90s on a
/// loaded machine, so each launch does as much work as it can.
@MainActor
final class IssueListQATests: XCTestCase {

    // MARK: - Helpers

    private func launch(_ arguments: [String] = ["-polaris-fixtures"]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(
            app.staticTexts["My Issues"].waitForExistence(timeout: 120),
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

    private func dump(_ app: XCUIApplication, _ label: String) {
        print("=====QA-TREE \(label) BEGIN=====")
        print(app.debugDescription)
        print("=====QA-TREE \(label) END=====")
    }

    /// The row order as XCUITest sees it. Rows carry the combined label built in
    /// `IssueRow.accessibilityDescription`, which starts with the identifier.
    private func rowLabels(_ app: XCUIApplication) -> [String] {
        app.buttons.allElementsBoundByIndex
            .map { element in element.label }
            .filter { $0.contains("Status:") }
    }

    private func eyebrowLabel(_ app: XCUIApplication) -> String? {
        app.staticTexts.allElementsBoundByIndex
            .map { element in element.label }
            .first { $0.uppercased().contains("OPEN") || $0.uppercased() == "LOADING" }
    }

    private func titleField(_ app: XCUIApplication) -> XCUIElement {
        app.textViews["Issue title"].exists
            ? app.textViews["Issue title"]
            : app.textFields["Issue title"]
    }

    private func toggleShowCompleted(_ app: XCUIApplication) {
        app.buttons["Filter"].tap()
        let toggle = app.switches["Show completed"].exists
            ? app.switches["Show completed"]
            : app.buttons["Show completed"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "filter menu should offer Show completed")
        toggle.tap()
    }

    // MARK: - 1. Header count, ordering, filter, pull-to-refresh

    func testListHeaderOrderingFilterAndRefresh() {
        let app = launch()
        dump(app, "default-list")
        snap(app, "01-default-list")

        // --- header count and ordering ---
        let rows = rowLabels(app)
        print("=====QA-DEFAULT eyebrow=\(eyebrowLabel(app) ?? "<none>") rows=\(rows.count)")
        rows.forEach { print("  ROW: \($0)") }

        // Fixtures: ENG-1 urgent/In Progress, ENG-2 medium/Todo, ENG-3 high/Backlog,
        // ENG-4 no-priority/Done. With completed hidden: the three open issues, urgent first.
        XCTAssertEqual(rows.count, 3, "completed is hidden by default, so 3 rows")
        XCTAssertTrue(rows[0].hasPrefix("ENG-1"), "urgent first, got \(rows.map { $0.prefix(6) })")
        XCTAssertTrue(rows[1].hasPrefix("ENG-3"), "high second, got \(rows.map { $0.prefix(6) })")
        XCTAssertTrue(rows[2].hasPrefix("ENG-2"), "medium third, got \(rows.map { $0.prefix(6) })")
        XCTAssertEqual(eyebrowLabel(app), "3 OPEN", "three open issues")

        // --- pull to refresh ---
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
        start.press(forDuration: 0.05, thenDragTo: end)
        snap(app, "02-after-pull-to-refresh")
        let afterRefresh = rowLabels(app)
        print("=====QA-REFRESH before=\(rows.count) after=\(afterRefresh.count)")
        XCTAssertEqual(rows, afterRefresh, "pull to refresh should return the same list")

        // --- filter menu ---
        app.buttons["Filter"].tap()
        snap(app, "03-filter-menu-open")
        dump(app, "filter-menu")
        let toggle = app.switches["Show completed"].exists
            ? app.switches["Show completed"]
            : app.buttons["Show completed"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        toggle.tap()

        // The very next frame: does the list survive the refetch, or blank to a spinner?
        snap(app, "04-immediately-after-filter-toggle")
        print("=====QA-TOGGLE-IMMEDIATE rows=\(rowLabels(app).count) eyebrow=\(eyebrowLabel(app) ?? "<none>")")
        dump(app, "immediately-after-filter-toggle")

        var withCompleted = rowLabels(app)
        let deadline = Date().addingTimeInterval(15)
        while withCompleted.count != 4, Date() < deadline { withCompleted = rowLabels(app) }
        let eyebrowAfter = eyebrowLabel(app)
        print("=====QA-TOGGLED eyebrow=\(eyebrowAfter ?? "<none>") rows=\(withCompleted.count)")
        withCompleted.forEach { print("  ROW: \($0)") }
        snap(app, "05-show-completed-on")

        XCTAssertEqual(withCompleted.count, 4, "showing completed should add ENG-4")
        XCTAssertEqual(
            eyebrowAfter, "3 OPEN",
            "the open count must not change when completed work is merely revealed"
        )
        XCTAssertTrue(
            withCompleted.last?.hasPrefix("ENG-4") ?? false,
            "completed work sinks to the bottom, got \(withCompleted.map { $0.prefix(6) })"
        )
    }

    // MARK: - 2. Does a detail-screen status change reach the list?

    func testStatusChangeOnDetailReachesTheList() {
        let app = launch()
        guard let firstRow = app.buttons.allElementsBoundByIndex
            .first(where: { $0.label.contains("ENG-1") })
        else { return XCTFail("ENG-1 should be on screen") }
        firstRow.tap()

        XCTAssertTrue(app.staticTexts["ENG-1"].waitForExistence(timeout: 20), "detail should open")
        snap(app, "06-detail-open")

        let statusPicker = app.buttons["Status"].exists ? app.buttons["Status"] : app.otherElements["Status"]
        if statusPicker.waitForExistence(timeout: 10) {
            statusPicker.tap()
            let done = app.buttons["Done"]
            if done.waitForExistence(timeout: 10) {
                done.tap()
            } else {
                dump(app, "status-picker-options")
                XCTFail("could not find a Done option in the status picker")
            }
        } else {
            dump(app, "detail-no-status-picker")
            XCTFail("could not find the status picker")
        }
        snap(app, "07-detail-after-done")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: 20))
        _ = app.buttons["Filter"].waitForExistence(timeout: 5)

        let eyebrowAfter = eyebrowLabel(app)
        let rowsAfter = rowLabels(app)
        print("=====QA-BACKFROMDETAIL eyebrowAfter=\(eyebrowAfter ?? "?")")
        rowsAfter.forEach { print("  ROW: \($0)") }
        snap(app, "08-list-after-detail-change")

        XCTAssertFalse(
            rowsAfter.contains { $0.hasPrefix("ENG-1") && $0.contains("In Progress") },
            "ENG-1 was moved to Done on the detail screen; the list still shows it In Progress"
        )
        XCTAssertEqual(eyebrowAfter, "2 OPEN", "the open count should drop from 3 to 2")
    }

    // MARK: - 3. Is there any way to change status from the list?

    func testListOffersNoStatusAffordance() {
        let app = launch()
        guard let row = app.buttons.allElementsBoundByIndex
            .first(where: { $0.label.contains("ENG-1") })
        else { return XCTFail("no ENG-1 row") }

        row.swipeLeft()
        snap(app, "09-row-swipe-left")
        dump(app, "row-after-swipe-left")

        row.press(forDuration: 1.2)
        snap(app, "10-row-long-press")
        dump(app, "row-after-long-press")
        print("=====QA-NOTE inspect the two dumps above for any complete/Done affordance")
    }

    // MARK: - 4. Composer: focus, validity, team picker, cancel

    func testComposerFocusValidityAndCancel() {
        let app = launch()
        app.buttons["New issue"].tap()
        XCTAssertTrue(app.staticTexts["New Issue"].waitForExistence(timeout: 20), "composer should open")
        snap(app, "11-composer-open")
        dump(app, "composer-open")

        let create = app.buttons["Create"]
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        XCTAssertFalse(create.isEnabled, "Create must be disabled with an empty title")

        let keyboardUp = app.keyboards.element.waitForExistence(timeout: 5)
        let field = titleField(app)
        let focused = field.exists ? (field.value(forKey: "hasKeyboardFocus") as? Bool ?? false) : false
        print("=====QA-COMPOSER keyboardVisible=\(keyboardUp) titleExists=\(field.exists) titleFocused=\(focused)")
        XCTAssertTrue(keyboardUp, "the title field should be focused on open, so the keyboard is up")
        XCTAssertTrue(focused, "the title field should hold keyboard focus on open")

        // Whitespace-only title must not enable Create.
        field.tap()
        app.typeText("   ")
        snap(app, "12-composer-whitespace-title")
        XCTAssertFalse(create.isEnabled, "whitespace-only title must not enable Create")

        app.typeText("Half-written thought worth keeping")
        XCTAssertTrue(create.isEnabled, "a real title should enable Create")
        snap(app, "13-composer-valid")

        // What does the team picker show?
        let pickerValues = app.buttons.allElementsBoundByIndex
            .map { element in "[\(element.label)]=[\(element.value as? String ?? "<no value>")]" }
            .filter { $0.contains("Team") || $0.contains("Priority") || $0.contains("ENG") }
        print("=====QA-PICKERS \(pickerValues)")
        dump(app, "composer-with-title")

        // Cancel with unsaved text: is anything confirmed?
        app.buttons["Cancel"].tap()
        let confirmationAppeared = app.sheets.element.waitForExistence(timeout: 3)
            || app.alerts.element.waitForExistence(timeout: 2)
        print("=====QA-CANCEL confirmationAppeared=\(confirmationAppeared)")
        snap(app, "14-after-cancel")
        XCTAssertTrue(
            app.staticTexts["My Issues"].waitForExistence(timeout: 10),
            "cancel should return to the list"
        )
        XCTAssertTrue(
            confirmationAppeared,
            "cancelling a composer holding unsaved text should confirm before discarding it"
        )

        // Reopen: is the draft gone?
        app.buttons["New issue"].tap()
        XCTAssertTrue(app.staticTexts["New Issue"].waitForExistence(timeout: 20))
        dump(app, "composer-reopened-after-cancel")
        snap(app, "15-composer-reopened")
    }

    // MARK: - 5. Composer: creating

    func testCreatedIssueAppearsInSortPositionAndKeepsItsPriority() {
        let app = launch()
        let before = rowLabels(app)

        // (a) default priority -> should sort last among open work
        app.buttons["New issue"].tap()
        XCTAssertTrue(app.staticTexts["New Issue"].waitForExistence(timeout: 20))
        titleField(app).tap()
        app.typeText("Brand new thing with no priority")
        app.buttons["Create"].tap()
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: 20), "composer should close")

        let afterFirst = rowLabels(app)
        print("=====QA-CREATE before=\(before.count) after=\(afterFirst.count) eyebrow=\(eyebrowLabel(app) ?? "<none>")")
        afterFirst.forEach { print("  ROW: \($0)") }
        snap(app, "16-list-after-create")

        XCTAssertEqual(afterFirst.count, before.count + 1, "the new issue should appear immediately")
        guard let created = afterFirst.first(where: { $0.contains("Brand new thing") }) else {
            return XCTFail("the new issue is not in the list")
        }
        XCTAssertEqual(
            afterFirst.last, created,
            "a no-priority issue sorts last among open work, order was \(afterFirst.map { $0.prefix(8) })"
        )
        XCTAssertTrue(
            created.contains("Assigned to"),
            "an issue created from My Issues should be assigned to the viewer, got: \(created)"
        )

        // (b) explicit Urgent priority -> should survive creation and sort near the top
        app.buttons["New issue"].tap()
        XCTAssertTrue(app.staticTexts["New Issue"].waitForExistence(timeout: 20))
        titleField(app).tap()
        app.typeText("Urgent by choice")
        app.swipeDown()  // dismiss the keyboard so the pickers are reachable
        let priorityPicker = app.buttons["Priority"].exists ? app.buttons["Priority"] : app.otherElements["Priority"]
        if priorityPicker.waitForExistence(timeout: 10) {
            priorityPicker.tap()
            let urgent = app.buttons["Urgent"]
            if urgent.waitForExistence(timeout: 10) { urgent.tap() } else { dump(app, "priority-picker") }
        } else {
            dump(app, "composer-no-priority-picker")
        }
        snap(app, "17-composer-urgent")
        app.buttons["Create"].tap()
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: 20))

        let afterSecond = rowLabels(app)
        afterSecond.forEach { print("  ROW: \($0)") }
        snap(app, "18-list-after-urgent-create")
        guard let urgentRow = afterSecond.first(where: { $0.contains("Urgent by choice") }) else {
            return XCTFail("second created issue not in list")
        }
        XCTAssertTrue(
            urgentRow.contains("Priority: Urgent"),
            "the chosen priority should survive creation, got: \(urgentRow)"
        )
    }

    // MARK: - 6. Empty states (needs the QA fixture variants)

    func testEmptyState_NothingAssignedAtAll_QAFixtures() {
        let app = launch(["-polaris-fixtures", "-qa-empty"])
        snap(app, "19-empty-nothing-assigned")
        dump(app, "empty-nothing-assigned")
        print("=====QA-EMPTY eyebrow=\(eyebrowLabel(app) ?? "<none>")")

        let claimsHiddenCompleted = app.staticTexts.allElementsBoundByIndex
            .contains { $0.label.contains("Completed work is hidden") }
        XCTAssertFalse(
            claimsHiddenCompleted,
            "nothing is assigned at all, so the empty state must not blame the completed filter"
        )
    }

    func testEmptyState_EverythingCompleted_QAFixtures() {
        let app = launch(["-polaris-fixtures", "-qa-only-completed"])
        snap(app, "20-empty-completed-hidden")
        dump(app, "empty-completed-hidden")
        print("=====QA-EMPTY-COMPLETED eyebrow=\(eyebrowLabel(app) ?? "<none>")")

        let saysNothingAssigned = app.staticTexts.allElementsBoundByIndex
            .contains { $0.label.contains("Nothing assigned to you") }
        XCTAssertFalse(
            saysNothingAssigned,
            "two completed issues are assigned; the headline must not say nothing is assigned"
        )

        toggleShowCompleted(app)
        var rows = rowLabels(app)
        let deadline = Date().addingTimeInterval(15)
        while rows.count != 2, Date() < deadline { rows = rowLabels(app) }
        print("=====QA-EMPTY-COMPLETED afterToggle rows=\(rows.count) eyebrow=\(eyebrowLabel(app) ?? "<none>")")
        rows.forEach { print("  ROW: \($0)") }
        snap(app, "21-completed-revealed")
        XCTAssertEqual(rows.count, 2, "both completed issues should appear")
        XCTAssertEqual(eyebrowLabel(app), "0 OPEN", "nothing is open")
    }

    // MARK: - 7. Row layout stress + stagger under scroll (needs the QA fixture variants)

    func testRowLayoutStressAndStagger_QAFixtures() {
        let app = launch(["-polaris-fixtures", "-qa-stress"])
        snap(app, "22-stress-top")
        dump(app, "stress-top")
        let rows = rowLabels(app)
        print("=====QA-STRESS visibleRows=\(rows.count) eyebrow=\(eyebrowLabel(app) ?? "<none>")")
        rows.prefix(8).forEach { print("  ROW: \($0)") }

        // Screenshots taken immediately after each flick: rows still mid-stagger appear blank
        // or half-risen, which is the glitch this is looking for.
        for step in 0..<5 {
            app.swipeUp(velocity: .fast)
            snap(app, "23-scroll-down-\(step)")
        }
        for step in 0..<4 {
            app.swipeDown(velocity: .fast)
            snap(app, "24-scroll-up-\(step)")
        }
        dump(app, "after-scrolling")
    }

    func testRowLayoutStressAtLargestDynamicType_QAFixtures() {
        let app = launch([
            "-polaris-fixtures", "-qa-stress",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        snap(app, "25-stress-ax-xxxl")
        dump(app, "stress-ax-xxxl")
        app.swipeUp()
        snap(app, "26-stress-ax-xxxl-second-screen")

        app.buttons["New issue"].tap()
        _ = app.staticTexts["New Issue"].waitForExistence(timeout: 20)
        snap(app, "27-composer-ax-xxxl")
        dump(app, "composer-ax-xxxl")
    }

    func testListAtLargestDynamicType() {
        let app = launch([
            "-polaris-fixtures",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        snap(app, "28-list-ax-xxxl")
        dump(app, "list-ax-xxxl")
    }
}
