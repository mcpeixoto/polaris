import XCTest

/// Focused probe: does the composer's discard confirmation leave the list interactive?
final class DiscardProbeTests: XCTestCase {
    func testDiscardLeavesTheListUsable() {
        let app = XCUIApplication()
        app.launchArguments = ["-polaris-fixtures"]
        app.launch()

        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: 20))
        app.buttons["New issue"].tap()
        XCTAssertTrue(app.staticTexts["New Issue"].waitForExistence(timeout: 20))

        // Type something so Cancel has to confirm.
        let title = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        title.tap()
        app.typeText("unsaved words")

        app.buttons["Cancel"].tap()
        let discard = app.buttons["Discard"]
        XCTAssertTrue(discard.waitForExistence(timeout: 10), "the discard confirmation should appear")
        discard.tap()

        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: 20), "back on the list")

        let newIssue = app.buttons["New issue"]
        print("PROBE exists=\(newIssue.exists) hittable=\(newIssue.isHittable) frame=\(newIssue.frame)")
        print("PROBE sheet still present? \(app.staticTexts["New Issue"].exists)")
        print("PROBE tree:\n\(app.debugDescription.prefix(1800))")
    }
}
