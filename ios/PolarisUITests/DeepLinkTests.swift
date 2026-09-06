import XCTest

/// Links into the app, end to end: the URL goes through the same router a tap in Messages
/// would, and the screen it names comes up.
///
/// Two ways in. `-polaris-open-url` hands the link over on the command line, which is the
/// only way to test a link that *launches* the app. `XCUIApplication.open(_:)` delivers one
/// to an app that is already running, which is the other half.
final class DeepLinkTests: XCTestCase {
    private let long: TimeInterval = 60

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-polaris-fixtures"] + extra
        app.launch()
        return app
    }

    func testAnIssueLinkAtLaunchOpensTheIssue() {
        let app = launch(["-polaris-open-url", "polaris://issue/ENG-1"])
        XCTAssertTrue(
            app.navigationBars["ENG-1"].waitForExistence(timeout: long),
            "the detail screen for ENG-1 should be pushed once the shell is up"
        )
        XCTAssertTrue(app.textFields["issue.title"].exists)
    }

    func testAWebLinkAtLaunchOpensTheSameIssue() {
        let app = launch(["-polaris-open-url", "https://polaris.peixotolabs.com/issue/eng-1"])
        XCTAssertTrue(app.navigationBars["ENG-1"].waitForExistence(timeout: long))
    }

    func testATeamLinkOpensTheTeam() {
        let app = launch(["-polaris-open-url", "polaris://team/ENG"])
        // The team's screen is titled with its name. Not "My Issues": the push lands before
        // the list's title is ever on screen, so waiting for it is waiting for the past.
        XCTAssertTrue(
            app.navigationBars["Engineering"].waitForExistence(timeout: long),
            "a team link should push the team onto My Issues"
        )
    }

    func testALinkToARunningAppNavigates() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: long))

        app.open(URL(string: "polaris://inbox")!)
        XCTAssertTrue(
            app.navigationBars["Inbox"].waitForExistence(timeout: long),
            "an inbox link should select the inbox tab"
        )

        app.open(URL(string: "polaris://issue/ENG-1")!)
        XCTAssertTrue(
            app.navigationBars["ENG-1"].waitForExistence(timeout: long),
            "an issue link should push the issue onto the tab that is up"
        )
    }

    func testALinkToNothingSaysSo() {
        let app = launch(["-polaris-open-url", "polaris://issue/ENG-9999"])
        XCTAssertTrue(app.alerts["Couldn't open that link"].waitForExistence(timeout: long))
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.staticTexts["My Issues"].waitForExistence(timeout: long))
    }
}
