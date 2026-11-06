import XCTest

/// "Share anonymous usage stats": on by default, on the first connect screen (so it is seen
/// before anything can be sent) and in Settings.
///
/// Under `-polaris-fixtures` nothing is ever counted or sent, so flipping the switch here
/// reaches no server. Each test leaves it on, the default, for whatever runs next.
final class UsageStatsToggleTests: XCTestCase {
    private let long: TimeInterval = 60

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func toggle(_ app: XCUIApplication) -> XCUIElement {
        app.switches.matching(NSPredicate(format: "identifier == %@", "settings.shareUsage")).firstMatch
    }

    private func isOn(_ element: XCUIElement) -> Bool {
        (element.value as? String) == "1"
    }

    func testSwitchIsOnTheFirstConnectScreenAndOnByDefault() {
        let app = launch(["-polaris-fixtures", "-polaris-signed-out", "-polaris-force-connect"])
        XCTAssertTrue(app.buttons["connect.continue"].waitForExistence(timeout: long))
        let share = toggle(app)
        XCTAssertTrue(share.waitForExistence(timeout: long), "the switch must be seen before the first ping")
        XCTAssertTrue(isOn(share), "on by default")
    }

    func testSettingsSwitchTurnsOffAndBackOn() {
        let app = launch(["-polaris-fixtures"])
        let tab = app.buttons["Settings"].firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: long))
        tab.tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: long))

        let share = toggle(app)
        if !share.waitForExistence(timeout: 10) || !share.isHittable { app.swipeUp() }
        XCTAssertTrue(share.waitForExistence(timeout: long), "Settings should carry the usage switch")
        XCTAssertTrue(isOn(share))

        share.switches.firstMatch.exists ? share.switches.firstMatch.tap() : share.tap()
        XCTAssertFalse(isOn(share), "the switch turns off")
        share.switches.firstMatch.exists ? share.switches.firstMatch.tap() : share.tap()
        XCTAssertTrue(isOn(share), "and back on")
    }
}
