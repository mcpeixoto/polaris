import XCTest

/// Not a test of the product — a probe that prints what the accessibility audit objects to.
///
/// `performAccessibilityAudit(for:_:)` hands each issue to a closure before deciding the
/// result, and returning `true` marks it handled. That closure is the only place the element
/// and the audit's own description are available: the failure message on the test itself is
/// just "Contrast failed", and the result bundle stores nothing more.
final class AuditDiagnosticTests: XCTestCase {
    private func probe(_ app: XCUIApplication, _ screen: String) {
        try? app.performAccessibilityAudit { issue in
            let element = issue.element
            print("""
            AUDIT[\(screen)] type=\(issue.auditType) \
            detail=\(issue.compactDescription) \
            element=<\(element?.elementType.rawValue ?? 0)> \
            label=\(element?.label ?? "nil") \
            id=\(element?.identifier ?? "nil") \
            frame=\(element?.frame ?? .zero)
            """)
            return true   // handled, so the probe reports everything instead of stopping
        }
    }

    func testProbeWelcome() {
        let app = XCUIApplication()
        // Reduce Motion, so nothing is mid-fade when the audit samples pixels.
        app.launchArguments = ["-polaris-fixtures", "-polaris-signed-out"]
        app.launchEnvironment["UIAccessibilityReduceMotionEnabled"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 2)   // let the entrance animation settle
        probe(app, "welcome")
    }

    func testProbeSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["-polaris-fixtures", "-polaris-signed-out"]
        app.launch()
        XCTAssertTrue(app.buttons["I already have an account"].waitForExistence(timeout: 20))
        app.buttons["I already have an account"].tap()
        XCTAssertTrue(app.secureTextFields["Password"].waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 2)
        probe(app, "signin")
    }
}
