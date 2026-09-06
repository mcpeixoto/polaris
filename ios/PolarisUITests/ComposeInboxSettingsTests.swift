import XCTest

/// The Linear-parity additions to My Issues, the composer, the inbox, search and settings:
/// scope tabs, the property pills, the unread filter, remembered searches, and the
/// notifications and profile screens. Everything runs on `-polaris-fixtures`, with no server.
final class ComposeInboxSettingsTests: XCTestCase {
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

    /// The row order as XCUITest sees it. Rows carry the combined label built in
    /// `IssueRow.accessibilityDescription`, which starts with the identifier.
    private func rowLabels(_ app: XCUIApplication) -> [String] {
        app.buttons.allElementsBoundByIndex
            .map { $0.label }
            .filter { $0.contains("Status:") }
    }

    /// Anything on screen that carries the identifier or the label, whatever element type
    /// the SDK chose for it — a menu-style `Picker` is a button on one SDK and a container
    /// on another.
    private func control(_ app: XCUIApplication, _ key: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ OR label == %@", key, key))
            .firstMatch
    }

    /// Taps once the element can take a tap. This machine runs several simulators at once
    /// and a tab bar can lag a second or two behind the launch.
    private func tapWhenReady(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: long), "\(element) should exist")
        let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        _ = XCTWaiter().wait(for: [hittable], timeout: long)
        element.tap()
    }

    private func waitForRows(_ app: XCUIApplication, count: Int) -> [String] {
        var rows = rowLabels(app)
        let deadline = Date().addingTimeInterval(20)
        while rows.count != count, Date() < deadline { rows = rowLabels(app) }
        return rows
    }

    // MARK: - My Issues

    /// The three tabs switch the store's scope. The fixture's reader created ENG-2 and ENG-3
    /// and neither is finished, so Created is two rows and the count follows the list.
    func testScopeTabsSwitchTheList() {
        let app = launch()
        XCTAssertEqual(waitForRows(app, count: 3).count, 3, "Assigned is the default")
        XCTAssertTrue(app.staticTexts["3 open"].waitForExistence(timeout: long))

        // One adjustable element, like a segmented control; the tabs sit left to right
        // inside it, so a tap lands on one by fraction of its width.
        let tabs = app.descendants(matching: .any)["issues.scope"]
        XCTAssertTrue(tabs.waitForExistence(timeout: long), "the scope tabs should be under the bar")
        XCTAssertEqual(tabs.value as? String, "Assigned")
        tabs.coordinate(withNormalizedOffset: CGVector(dx: 0.44, dy: 0.5)).tap()

        let rows = waitForRows(app, count: 2)
        XCTAssertEqual(rows.count, 2, "two open issues were created by the reader, got \(rows)")
        XCTAssertTrue(rows[0].hasPrefix("ENG-3"), "priority order holds on every tab, got \(rows.map { $0.prefix(6) })")
        XCTAssertTrue(app.staticTexts["2 open"].waitForExistence(timeout: long), "the count is of the current list")
        XCTAssertEqual(tabs.value as? String, "Created")
        snap(app, "scope-created")

        tabs.coordinate(withNormalizedOffset: CGVector(dx: 0.13, dy: 0.5)).tap()
        XCTAssertEqual(waitForRows(app, count: 3).count, 3, "back to the assigned list")
        XCTAssertEqual(tabs.value as? String, "Assigned")
        XCTAssertTrue(app.staticTexts["3 open"].waitForExistence(timeout: long))
    }

    /// The filter menu grew Linear's display options beside the completed toggle.
    func testFilterMenuOffersGroupingAndOrder() {
        let app = launch()
        app.buttons["Filter"].tap()
        let showCompleted = app.switches["Show completed"].exists
            ? app.switches["Show completed"] : app.buttons["Show completed"]
        XCTAssertTrue(showCompleted.waitForExistence(timeout: 10), "the completed toggle is still there")
        let group = app.switches["Group by status"].exists
            ? app.switches["Group by status"] : app.buttons["Group by status"]
        XCTAssertTrue(group.exists, "the menu should offer grouping")
        XCTAssertTrue(
            app.buttons["Order"].exists || app.otherElements["Order"].exists
                || app.buttons.containing(NSPredicate(format: "label CONTAINS 'Order'")).firstMatch.exists,
            "the menu should offer an order"
        )
        snap(app, "filter-menu")
        group.tap()

        XCTAssertTrue(
            app.descendants(matching: .any)["issues.group.In Progress"].waitForExistence(timeout: long),
            "grouping on puts status headings in My Issues"
        )
        XCTAssertEqual(waitForRows(app, count: 3).count, 3, "the rows themselves are unchanged")
        snap(app, "grouped-my-issues")
    }

    // MARK: - Composer

    /// Every property the create mutation accepts is a pill above the keyboard, and the
    /// label picker actually applies a label.
    func testComposerShowsLinearPropertyPillsAndCreateMore() {
        let app = launch()
        app.buttons["New issue"].tap()
        XCTAssertTrue(app.staticTexts["New Issue"].waitForExistence(timeout: long), "composer should open")

        for key in ["compose.status", "compose.priority", "Assign to me", "Assignee", "Labels", "Due date", "compose.estimate"] {
            XCTAssertTrue(
                control(app, key).waitForExistence(timeout: 10),
                "the composer should offer a \(key) pill"
            )
        }
        let createMore = app.switches["compose.createMore"].exists
            ? app.switches["compose.createMore"]
            : app.switches["Create more"]
        XCTAssertTrue(createMore.waitForExistence(timeout: 10), "Create more should be under the pills")
        snap(app, "composer-pills")

        app.buttons["Labels"].tap()
        let backend = app.buttons["label.lab1"]
        XCTAssertTrue(backend.waitForExistence(timeout: long), "the label sheet lists the team's labels")
        backend.tap()
        snap(app, "composer-labels-sheet")
        app.buttons["Done"].firstMatch.tap()

        let labels = app.buttons["Labels"]
        XCTAssertTrue(labels.waitForExistence(timeout: 10))
        XCTAssertEqual(labels.value as? String, "backend", "the chosen label should show on the pill")
        snap(app, "composer-with-label")
    }

    // MARK: - Inbox

    /// "Unread only" hides the one read row of the fixture's three and leaves the two
    /// unread ones; "All" brings it back.
    func testInboxFilterMenuOffersUnreadOnly() {
        let app = launch()
        tapWhenReady(app.buttons["Inbox"].firstMatch)
        XCTAssertTrue(app.staticTexts["Inbox"].waitForExistence(timeout: long))
        XCTAssertTrue(app.buttons["inbox.row.n3"].waitForExistence(timeout: long), "the read row is in the full list")

        app.buttons["inbox.filter"].tap()
        let unreadOnly = app.buttons["Unread only"]
        XCTAssertTrue(unreadOnly.waitForExistence(timeout: 10), "the filter menu should offer Unread only")
        unreadOnly.tap()
        snap(app, "inbox-unread-only")

        XCTAssertTrue(app.buttons["inbox.row.n1"].waitForExistence(timeout: long))
        XCTAssertTrue(app.buttons["inbox.row.n2"].exists)
        XCTAssertFalse(app.buttons["inbox.row.n3"].exists, "the read row is hidden under Unread only")

        app.buttons["inbox.filter"].tap()
        let all = app.buttons["All"]
        XCTAssertTrue(all.waitForExistence(timeout: 10))
        all.tap()
        XCTAssertTrue(app.buttons["inbox.row.n3"].waitForExistence(timeout: long), "All shows the read row again")
    }

    /// The long press offers read, snooze and delete, and the snooze submenu the three
    /// Linear options.
    func testInboxRowContextMenuOffersSnoozeOptions() {
        let app = launch()
        tapWhenReady(app.buttons["Inbox"].firstMatch)
        // The identifier sits on the row and on the link behind it; the row is the one
        // with a spoken label.
        let row = app.buttons.matching(
            NSPredicate(format: "identifier == 'inbox.row.n1' AND label BEGINSWITH 'Unread'")
        ).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: long))
        row.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Mark read"].waitForExistence(timeout: 10), "an unread row offers Mark read")
        XCTAssertTrue(app.buttons["Delete"].firstMatch.exists)
        let snooze = app.buttons["Snooze…"].firstMatch
        XCTAssertTrue(snooze.exists, "the context menu should offer a snooze submenu")
        snooze.tap()
        XCTAssertTrue(app.buttons["snooze.tomorrow"].waitForExistence(timeout: 10)
                      || app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Tomorrow'")).firstMatch.waitForExistence(timeout: 5))
        snap(app, "inbox-snooze-menu")
    }

    // MARK: - Search

    /// A submitted search is remembered and offered again when the field is empty, and the
    /// chips row carries the team and the two quick filters.
    func testSearchRemembersSubmittedQueries() {
        let app = launch()
        tapWhenReady(app.buttons["Search"].firstMatch)
        XCTAssertTrue(app.staticTexts["Search"].waitForExistence(timeout: long))
        XCTAssertTrue(app.buttons["search.team.ENG"].waitForExistence(timeout: long), "the team chips should be under the field")
        XCTAssertTrue(app.buttons["search.assignedToMe"].exists)
        XCTAssertTrue(app.buttons["search.openOnly"].exists)

        let field = app.searchFields.firstMatch
        tapWhenReady(field)
        field.typeText("sync\n")

        let count = app.staticTexts["search.count"]
        XCTAssertTrue(count.waitForExistence(timeout: long), "a submitted search should show its count")
        XCTAssertTrue(count.label.contains("result"), "read \(count.label)")
        snap(app, "search-results")

        // Empty the field: the recents take the place of the results.
        let clear = field.buttons["Clear text"]
        if clear.waitForExistence(timeout: 5) {
            clear.tap()
        } else {
            field.tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 4))
        }
        let recent = app.buttons["search.recent.sync"]
        XCTAssertTrue(recent.waitForExistence(timeout: long), "the search just run should be listed as recent")
        XCTAssertTrue(app.buttons["search.recentClear"].exists, "recents can be cleared")
        snap(app, "search-recents")

        recent.tap()
        XCTAssertTrue(count.waitForExistence(timeout: long), "tapping a recent runs it again")
    }

    // MARK: - Settings

    /// Account opens the profile, and Notifications opens the six switches over the twenty
    /// types, with the fixture's muted digest leaving its group on.
    func testSettingsOpensProfileAndNotifications() {
        let app = launch()
        tapWhenReady(app.buttons["Settings"].firstMatch)
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: long))
        XCTAssertTrue(app.buttons["Sign out"].firstMatch.exists, "sign out is still on the screen")

        let notifications = app.buttons["settings.notifications"].exists
            ? app.buttons["settings.notifications"]
            : app.cells["settings.notifications"]
        XCTAssertTrue(notifications.waitForExistence(timeout: long), "the Preferences section should link to Notifications")
        notifications.tap()
        XCTAssertTrue(app.staticTexts["Notifications"].waitForExistence(timeout: long), "the notifications screen should open")
        let assignments = app.switches["notifications.assignments"]
        XCTAssertTrue(assignments.waitForExistence(timeout: long))
        for group in ["statusChanges", "commentsAndMentions", "dueDatesAndBlocking", "projectsAndInitiatives", "customers"] {
            XCTAssertTrue(app.switches["notifications.\(group)"].exists, "missing the \(group) switch")
        }
        XCTAssertEqual(assignments.value as? String, "1", "nothing in the fixture mutes assignments")
        XCTAssertEqual(
            app.switches["notifications.projectsAndInitiatives"].value as? String, "1",
            "a muted digest alone leaves its group on"
        )
        snap(app, "settings-notifications")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: long))

        let profile = app.buttons["settings.profile"].exists
            ? app.buttons["settings.profile"]
            : app.cells["settings.profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: long), "the account row should open the profile")
        profile.tap()
        XCTAssertTrue(app.staticTexts["Profile"].waitForExistence(timeout: long))
        let displayName = app.textFields["profile.displayName"]
        XCTAssertTrue(displayName.waitForExistence(timeout: long))
        XCTAssertEqual(displayName.value as? String, "Miguel Peixoto")
        XCTAssertFalse(app.buttons["profile.save"].isEnabled, "nothing changed yet, so nothing to save")
        snap(app, "settings-profile")
    }
}
