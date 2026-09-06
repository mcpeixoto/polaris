import XCTest

/// The one test that talks to a real backend: the app without `-polaris-fixtures`, against a
/// `make dev` stack on the same machine.
///
/// Opt-in, because it needs that stack: `TEST_RUNNER_POLARIS_LIVE_STACK=1 xcodebuild test …`,
/// plus `TEST_RUNNER_POLARIS_SYNC_HUB=ws://localhost:8091/sync` when the hub on :8089 is not
/// this checkout's.
/// Without the variable it skips rather than fails, so the ordinary hermetic run stays
/// hermetic. What it proves is the part fixtures cannot — that a Debug build signs in through
/// the dev session, dismisses the badge-permission prompt, and lands on a live issue list with
/// no connectivity pill showing. The sync socket's own handshake is read off the device log
/// (`Logger(subsystem: "com.peixotolabs.polaris", category: "sync")`) by whoever runs this;
/// XCUITest cannot see a WebSocket.
final class LiveStackTests: XCTestCase {
    private let long: TimeInterval = 60

    override func setUpWithError() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["POLARIS_LIVE_STACK"] == "1",
            "set TEST_RUNNER_POLARIS_LIVE_STACK=1 with a make dev stack on localhost:8088"
        )
    }

    func testSignsInThroughTheDevSessionAndStaysConnected() {
        let app = XCUIApplication()
        // A hub other than :8089, for the machine where that port is owned by an older build.
        if let hub = ProcessInfo.processInfo.environment["POLARIS_SYNC_HUB"] {
            app.launchArguments = ["-polaris-sync-hub", hub]
        }
        app.launch()

        // The badge permission prompt is the system's, so it lives in SpringBoard, not in the
        // app. Its buttons are localised; the second one is always the affirmative.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let prompt = springboard.alerts.firstMatch
        if prompt.waitForExistence(timeout: 15) {
            prompt.buttons.element(boundBy: 1).tap()
        }

        XCTAssertTrue(
            app.staticTexts["My Issues"].waitForExistence(timeout: long),
            "a Debug build should sign in through the dev session and land on the issue list"
        )
        // Long enough for the socket to hand-shake and for one poll interval to elapse, so a
        // failure in either path would have shown the pill by now.
        sleep(8)
        XCTAssertFalse(
            app.otherElements["connection.banner"].exists || app.staticTexts["Reconnecting"].exists
                || app.staticTexts["Offline"].exists,
            "no connectivity pill should show while the socket is up against a healthy stack"
        )
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "live-stack"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
