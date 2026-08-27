import XCTest

/// Drives the real app against the in-memory client.
///
/// `-polaris-fixtures` is what makes this possible at all: every screen past the welcome page
/// needs a session, and there is no server, no database and no account to get one from. The
/// fixture client answers sign-in without a network, so the signed-in screens become testable
/// on a machine with no backend.
final class SmokeTests: XCTestCase {
    private func launch(_ arguments: [String] = ["-polaris-fixtures"]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    func testSignedInLandsOnIssueList() {
        let app = launch()
        XCTAssertTrue(
            app.staticTexts["My Issues"].waitForExistence(timeout: 10),
            "fixtures should sign in and land on the issue list"
        )
    }

    func testWelcomeOffersBothWaysIn() {
        // No fixtures: the hosted environment cannot mint a dev session, so this is the
        // first-run screen a real new user meets.
        let app = launch(["-polaris-hosted"])
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["I already have an account"].exists)
    }
}
