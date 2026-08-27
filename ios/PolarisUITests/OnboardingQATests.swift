import XCTest

/// QA coverage for onboarding and authentication: welcome, sign-up, sign-in, create-workspace.
///
/// These began as adversarial tests written to pin down defects, and most of them failed on
/// first run. The defects they found are fixed, so they now stand as regression guards: each
/// assertion message names the bug it exists to catch coming back, rather than reporting one.
///
/// Everything runs on `-polaris-fixtures` with no network. That is newly possible — fixtures
/// alone sign straight in and land on the issue list, so every screen here used to be reachable
/// only by pointing the app at production. `-polaris-signed-out` and `-polaris-no-workspace`
/// close that gap, and the whole file moved off the hosted backend as a result. Nothing here
/// touches a real server, so the suite is safe to run anywhere, including CI.
///
/// The fixture client refuses any password but `correct-horse`, with the same sentence the
/// server sends: `incorrect email or password`.
///
/// Nothing here completes a registration or creates a workspace. The form assertions are all
/// client-side and stop short of submitting.
final class OnboardingQATests: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Signed out, so the welcome screen is the first thing on screen.
    private static let signedOut = ["-polaris-fixtures", "-polaris-signed-out"]

    /// Signed in but belonging to no workspace — the state a first registration lands in, and
    /// the only route to `CreateWorkspaceView`.
    private static let noWorkspace = ["-polaris-fixtures", "-polaris-no-workspace"]

    private func launch(_ arguments: [String] = OnboardingQATests.signedOut) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private static let hugeType = [
        "-UIPreferredContentSizeCategoryName",
        "UICTContentSizeCategoryAccessibilityXXXL",
    ]

    // MARK: - Welcome

    /// Regression guard for the worst bug this suite found: `WelcomeView` had no scroll view,
    /// so at the largest Dynamic Type both calls to action sat roughly 100pt below the bottom
    /// edge with no way to bring them back. Nobody using an accessibility text size could sign
    /// up or sign in at all — on the one screen whose entire job is to offer those two things.
    func testWelcomeCTAsStayReachableAtLargestDynamicType() {
        let app = launch(Self.signedOut + Self.hugeType)

        let create = app.buttons["Create an account"]
        XCTAssertTrue(create.waitForExistence(timeout: 30), "the CTA should exist at any text size")

        let window = app.windows.firstMatch.frame
        XCTAssertTrue(
            window.contains(create.frame),
            """
            REGRESSION: "Create an account" is off-screen at AccessibilityXXXL. \
            button=\(create.frame) window=\(window). The welcome hero must stay inside a \
            ScrollView with the footer pinned outside it.
            """
        )
        XCTAssertTrue(create.isHittable, "REGRESSION: the primary CTA cannot be tapped at AccessibilityXXXL")

        let signIn = app.buttons["I already have an account"]
        XCTAssertTrue(
            window.contains(signIn.frame),
            "REGRESSION: the secondary CTA is off-screen at AccessibilityXXXL. button=\(signIn.frame) window=\(window)"
        )
        XCTAssertTrue(signIn.isHittable, "REGRESSION: the secondary CTA cannot be tapped at AccessibilityXXXL")
    }

    /// The hero must actually scroll, not merely fit. Without the scroll view the headline is
    /// clipped under the status bar at large text sizes even when the buttons are reachable.
    func testWelcomeHeroScrollsAtLargestDynamicType() {
        let app = launch(Self.signedOut + Self.hugeType)
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 30))
        XCTAssertTrue(
            app.scrollViews.firstMatch.exists,
            "REGRESSION: the welcome hero is not inside a ScrollView, so overflowing content is unreachable"
        )
    }

    /// Same screen in landscape, where the vertical budget is roughly a third of what the
    /// layout assumes.
    func testWelcomeCTAsStayReachableInLandscape() {
        let app = launch()
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 30))

        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }

        let create = app.buttons["Create an account"]
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        let window = app.windows.firstMatch.frame
        XCTAssertTrue(
            window.contains(create.frame),
            "REGRESSION: the CTA leaves the screen in landscape. button=\(create.frame) window=\(window)"
        )
    }

    /// Both routes in must be reachable by VoiceOver.
    ///
    /// Deliberately does NOT assert on `app.images["sparkle"]`. On this runtime XCUITest still
    /// lists elements that carry `.accessibilityHidden(true)` — the error icon in
    /// `StateViews.swift` has the modifier applied directly to it and appears in the tree
    /// anyway — so tree presence is not evidence that VoiceOver reads something. The audit
    /// below is the oracle instead.
    func testWelcomeAccessibilitySurface() {
        let app = launch()
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["I already have an account"].exists)
    }

    func testWelcomeAccessibilityAudit() throws {
        let app = launch()
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 30))
        settleAnimations()
        try app.performAccessibilityAudit()
    }

    func testSignInAccessibilityAudit() throws {
        let app = launch()
        openSignIn(app)
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 15))
        settleAnimations()
        try app.performAccessibilityAudit()
    }

    func testSignUpAccessibilityAudit() throws {
        let app = launch()
        openSignUp(app)
        XCTAssertTrue(app.textFields["Your name"].waitForExistence(timeout: 15))
        settleAnimations()
        try app.performAccessibilityAudit()
    }

    func testCreateWorkspaceAccessibilityAudit() throws {
        let app = launch(Self.noWorkspace)
        XCTAssertTrue(app.textFields["Workspace name"].waitForExistence(timeout: 30))
        settleAnimations()
        try app.performAccessibilityAudit()
    }

    /// A cold launch with no stored session is not a failure and must not be dressed as one.
    func testWelcomeShowsNoErrorOnFirstLaunch() {
        let app = launch()
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 30))
        for message in [
            "Your session expired. Sign in again.",
            "no session",
            "Polaris sent an unexpected response.",
        ] {
            XCTAssertFalse(
                app.staticTexts[message].exists,
                "a first launch should not greet anybody with \"\(message)\""
            )
        }
    }

    // MARK: - Sign-up validation timing

    /// An untouched form must not scold anybody. No error should be on screen before a single
    /// character has been typed.
    func testSignUpShowsNoErrorBeforeTyping() {
        let app = launch()
        openSignUp(app)
        XCTAssertTrue(app.textFields["Your name"].waitForExistence(timeout: 15))
        for message in ["Enter your name", "Enter a valid email address", "Use at least 8 characters"] {
            XCTAssertFalse(
                app.staticTexts[message].exists,
                "an untouched sign-up form should not be showing \"\(message)\""
            )
        }
    }

    /// The name complaint should appear after the field is left empty, not while typing.
    func testSignUpNameErrorAppearsAfterLeavingEmptyNameField() {
        let app = launch()
        openSignUp(app)

        let name = app.textFields["Your name"]
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        name.tap()
        app.textFields["Email"].tap()

        XCTAssertTrue(
            app.staticTexts["Enter your name"].waitForExistence(timeout: 5),
            "leaving the name field empty should explain what is missing"
        )
    }

    /// The password complaint must not fire mid-typing, only once the field is left short.
    func testSignUpPasswordErrorTiming() {
        let app = launch()
        openSignUp(app)

        let password = app.secureTextFields["Password"]
        XCTAssertTrue(password.waitForExistence(timeout: 15))
        password.tap()
        password.typeText("short")

        XCTAssertFalse(
            app.staticTexts["Use at least 8 characters"].exists,
            "the password rule should not be thrown at somebody who is still typing it"
        )

        app.textFields["Email"].tap()
        XCTAssertTrue(
            app.staticTexts["Use at least 8 characters"].waitForExistence(timeout: 5),
            "leaving a short password should explain the rule"
        )
    }

    func testSignUpInvalidEmailReported() {
        let app = launch()
        openSignUp(app)

        let name = app.textFields["Your name"]
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        name.tap()
        name.typeText("QA Person")

        let email = app.textFields["Email"]
        email.tap()
        email.typeText("not-an-email")
        app.secureTextFields["Password"].tap()

        XCTAssertTrue(
            app.staticTexts["Enter a valid email address"].waitForExistence(timeout: 5),
            "an address with no @ should be caught before a round trip"
        )
    }

    /// Regression guard: `!email.contains("@")` accepted a bare `"@"` as a valid address, and
    /// several other shapes that cannot be delivered to.
    func testSignUpRejectsObviouslyBrokenAddresses() {
        let app = launch()
        openSignUp(app)

        let name = app.textFields["Your name"]
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        name.tap()
        name.typeText("QA Person")

        let email = app.textFields["Email"]
        for broken in ["@", "@example.com", "qa@", "qa@nodot", "qa@.com", "qa@example."] {
            email.tap()
            clear(email)
            email.typeText(broken)
            app.secureTextFields["Password"].tap()

            XCTAssertTrue(
                app.staticTexts["Enter a valid email address"].waitForExistence(timeout: 5),
                "REGRESSION: \"\(broken)\" was accepted as a valid email address"
            )
        }
    }

    /// A form with several problems should name one, not pile them up.
    func testSignUpReportsOnlyTheFirstProblem() {
        let app = launch()
        openSignUp(app)

        let name = app.textFields["Your name"]
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        name.tap()
        app.textFields["Email"].tap()
        app.secureTextFields["Password"].tap()
        app.textFields["Your name"].tap()

        let shown = ["Enter your name", "Enter a valid email address", "Use at least 8 characters"]
            .filter { app.staticTexts[$0].exists }
        XCTAssertLessThanOrEqual(
            shown.count, 1,
            "a form should name one problem at a time, showing \(shown)"
        )
    }

    func testSignUpFieldsAreLabelled() {
        let app = launch()
        openSignUp(app)
        XCTAssertTrue(app.textFields["Your name"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.textFields["Email"].exists, "the email field needs a VoiceOver label")
        XCTAssertTrue(app.secureTextFields["Password"].exists, "the password field needs a VoiceOver label")
    }

    func testSignUpSubmitReachableAtLargeDynamicType() {
        let app = launch(Self.signedOut + [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityM",
        ])
        openSignUp(app)

        let submit = app.buttons["Create account"]
        XCTAssertTrue(submit.waitForExistence(timeout: 15))
        let window = app.windows.firstMatch.frame
        XCTAssertTrue(
            window.contains(submit.frame),
            "the sign-up CTA should stay on screen at AccessibilityM. button=\(submit.frame) window=\(window)"
        )
    }

    /// Sweeps every content size, so a claim about where the welcome screen breaks is a table
    /// rather than an impression. This is the test that located the original failure at
    /// AccessibilityXXL; it now has to come back clean at every size.
    func testWelcomeCTABreakpointAcrossContentSizes() {
        let sizes = [
            "UICTContentSizeCategoryL",
            "UICTContentSizeCategoryXXXL",
            "UICTContentSizeCategoryAccessibilityM",
            "UICTContentSizeCategoryAccessibilityL",
            "UICTContentSizeCategoryAccessibilityXL",
            "UICTContentSizeCategoryAccessibilityXXL",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        var report: [String] = []
        var broken: [String] = []
        for size in sizes {
            let app = XCUIApplication()
            app.launchArguments = Self.signedOut + ["-UIPreferredContentSizeCategoryName", size]
            app.launch()
            let create = app.buttons["Create an account"]
            _ = create.waitForExistence(timeout: 30)
            let window = app.windows.firstMatch.frame
            let onScreen = window.contains(create.frame)
            report.append("\(size): onScreen=\(onScreen) button=\(create.frame) window=\(window)")
            if !onScreen { broken.append(size) }
            app.terminate()
        }
        XCTAssertTrue(
            broken.isEmpty,
            "REGRESSION: the welcome CTA leaves the screen at \(broken.joined(separator: ", ")).\n"
                + report.joined(separator: "\n")
        )
    }

    /// Attaches the welcome screen's accessibility tree, so a claim about what VoiceOver can
    /// and cannot reach is backed by the tree rather than by a single query.
    ///
    /// Read the attachment with care: on this runtime XCUITest still lists elements carrying
    /// `.accessibilityHidden(true)`, so an element appearing here does not prove VoiceOver
    /// reads it.
    func testAttachWelcomeAccessibilityTree() {
        let app = launch()
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 30))
        attach(app.debugDescription, named: "welcome-accessibility-tree")
    }

    /// Attaches the sign-in tree after a failure, to show what VoiceOver is given when the
    /// error appears.
    func testAttachSignInAccessibilityTreeAfterFailure() {
        let app = launch()
        failASignIn(app)
        attach(app.debugDescription, named: "signin-accessibility-tree-after-failure")
    }

    /// Waits for the entrance animation to finish before an audit samples the screen.
    ///
    /// `staggerRise` fades each row from opacity 0 to 1 over 0.5s plus an index delay, and
    /// `waitForExistence` returns the instant the element exists — which is mid-fade. A
    /// half-faded `#8B93FF` over this background computes to roughly 2.6:1 where the settled
    /// colour is 6.5:1, so auditing immediately measures a transient rather than the design.
    ///
    /// NOTE: this is the leading explanation for the contrast failures the first QA pass
    /// reported against the "POLARIS" eyebrow, but it is UNCONFIRMED — the accessibility
    /// bridge on the machine this was written on could not run a UI test to prove it. What is
    /// confirmed is that the earlier theory was wrong: sampling the rendered pixels shows the
    /// background under the eyebrow is #131822, giving 6.53:1, which passes comfortably. The
    /// mark's indigo glow does not reach it.
    private func settleAnimations() {
        let done = expectation(description: "entrance animations settle")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { done.fulfill() }
        wait(for: [done], timeout: 5)
    }

    private func attach(_ body: String, named name: String) {
        let attachment = XCTAttachment(string: body)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: - Sign-in

    /// The one thing `PolarisError.unauthorized(String?)` exists to get right: a mistyped
    /// password must read as a mistyped password, not as an expired session.
    func testWrongPasswordShowsTheServerSentenceAndStaysPut() {
        let app = launch()
        failASignIn(app)

        XCTAssertFalse(
            app.staticTexts["Your session expired. Sign in again."].exists,
            "REGRESSION: a mistyped password is being reported as an expired session"
        )
        XCTAssertTrue(
            app.buttons["Sign in"].exists,
            "REGRESSION: a failed sign-in threw the reader off the sign-in screen"
        )
        XCTAssertEqual(
            app.textFields["Email"].value as? String,
            "qa-nobody@example.com",
            "REGRESSION: a failed sign-in discarded the email that was typed"
        )
    }

    /// Regression guard: `AppModel.signIn` used to set `phase = .signedOut(error)`, and
    /// `RootView` renders that case as `WelcomeView(error:)` — so after going back from a
    /// failed sign-in the same sentence was printed again on the welcome screen, somewhere it
    /// could not be acted on.
    func testWelcomeIsCleanAfterBackingOutOfAFailedSignIn() {
        let app = launch()
        failASignIn(app)

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["Create an account"].waitForExistence(timeout: 15))
        XCTAssertFalse(
            app.staticTexts["incorrect email or password"].exists,
            "REGRESSION: the sign-in failure is repeated on the welcome screen after going back"
        )
    }

    /// Returning to a form should not hand back a half-filled one.
    func testSignInFieldsClearAfterLeavingAndReturning() {
        let app = launch()
        openSignIn(app)

        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap()
        email.typeText("qa@example.com")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["I already have an account"].waitForExistence(timeout: 15))
        app.buttons["I already have an account"].tap()

        let returned = app.textFields["Email"]
        XCTAssertTrue(returned.waitForExistence(timeout: 15))
        let value = (returned.value as? String) ?? ""
        XCTAssertTrue(
            value.isEmpty || value == "you@company.com",
            "leaving and returning should give a fresh form, got \(value)"
        )
    }

    /// The email field should be focused on arrival — a keyboard the reader has to summon is a
    /// tap nobody should have to make on a two-field form.
    func testSignInEmailIsFocusedOnArrival() {
        let app = launch()
        openSignIn(app)

        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        XCTAssertTrue(
            app.keyboards.element.waitForExistence(timeout: 8),
            "the keyboard should be up on arrival, so the field is autofocused"
        )
        XCTAssertTrue(
            email.value(forKey: "hasKeyboardFocus") as? Bool ?? false,
            "the email field should be the focused field on arrival"
        )
    }

    func testSignInNextMovesToPassword() {
        let app = launch()
        openSignIn(app)

        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap()
        email.typeText("qa@example.com\n")

        XCTAssertTrue(
            app.secureTextFields["Password"].value(forKey: "hasKeyboardFocus") as? Bool ?? false,
            "Next should move focus to the password field"
        )
    }

    /// Go on the password field submits the form. Proven by the request coming back refused
    /// rather than by a successful sign-in.
    func testSignInGoSubmitsTheForm() {
        let app = launch()
        openSignIn(app)

        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap()
        email.typeText("qa-nobody@example.com\n")
        app.secureTextFields["Password"].typeText("definitely-not-the-password\n")

        XCTAssertTrue(
            app.staticTexts["incorrect email or password"].waitForExistence(timeout: 30),
            "Go should submit the form"
        )
    }

    /// With the keyboard up, the submit button must still be on screen.
    func testKeyboardDoesNotCoverTheSignInCTA() {
        let app = launch()
        openSignIn(app)

        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        XCTAssertTrue(app.keyboards.element.waitForExistence(timeout: 8))

        let cta = app.buttons["Sign in"]
        let keyboard = app.keyboards.element.frame
        XCTAssertFalse(
            cta.frame.intersects(keyboard),
            "the keyboard should not cover the Sign in button. cta=\(cta.frame) keyboard=\(keyboard)"
        )
    }

    // MARK: - Create workspace

    /// The screen every first registration lands on. It was unreachable without a real server
    /// until `-polaris-no-workspace` existed, which is why its bugs were originally reported
    /// as inferred from source rather than observed.
    func testCreateWorkspaceIsReachable() {
        let app = launch(Self.noWorkspace)
        XCTAssertTrue(
            app.textFields["Workspace name"].waitForExistence(timeout: 30),
            "-polaris-no-workspace should land on the create-workspace screen"
        )
        XCTAssertTrue(app.buttons["Create workspace"].exists)
    }

    /// Regression guard for the derivation bugs. `KeyDerivation` used `Character.isLetter` and
    /// `.isNumber`, which accept the whole Unicode letter and number classes, while the server
    /// accepts ASCII only:
    ///
    ///   urlKey   ^[a-z0-9][a-z0-9-]{1,47}$   (workspace.go:19)
    ///   teamKey  ^[A-Z][A-Z0-9]{0,7}$        (team.go:20)
    ///
    /// So "Café Ltd" derived `café-ltd`, "Мир" derived `МИР`, "3M Design" derived `3MD` and a
    /// one-character name derived a one-character key — every one of them refused by the
    /// server, on the very first screen of a fresh install. This types each name into the real
    /// field and checks the derived keys against the server's own patterns.
    func testDerivedKeysSatisfyTheServerPatternsForAwkwardNames() {
        let app = launch(Self.noWorkspace)

        let name = app.textFields["Workspace name"]
        XCTAssertTrue(name.waitForExistence(timeout: 30))

        let urlPattern = "^[a-z0-9][a-z0-9-]{1,47}$"
        let teamPattern = "^[A-Z][A-Z0-9]{0,7}$"

        // Names that contain something ASCII to work with. Accent folding is what saves
        // "Café Ltd"; leading-digit handling is what saves "3M Design"; the one-character pad
        // is what saves "X".
        for workspaceName in ["Peixoto Labs", "Café Ltd", "3M Design", "42", "X", "  Spaced  Out  "] {
            name.tap()
            clear(name)
            name.typeText(workspaceName)

            let derived = value(of: app.textFields["Workspace address"], placeholder: "peixoto-labs")
            XCTAssertFalse(
                derived.isEmpty,
                "REGRESSION: \"\(workspaceName)\" derived no urlKey at all, which leaves the form unsubmittable"
            )
            XCTAssertNotNil(
                derived.range(of: urlPattern, options: .regularExpression),
                "REGRESSION: \"\(workspaceName)\" derived urlKey \"\(derived)\", which the server refuses"
            )
        }

        let teamName = app.textFields["First team name"]
        for team in ["Engineering", "3M Design", "Café"] {
            teamName.tap()
            clear(teamName)
            teamName.typeText(team)

            let derived = value(of: app.textFields["Team key"], placeholder: "ENG")
            XCTAssertFalse(derived.isEmpty, "REGRESSION: team \"\(team)\" derived no teamKey at all")
            XCTAssertNotNil(
                derived.range(of: teamPattern, options: .regularExpression),
                "REGRESSION: team \"\(team)\" derived teamKey \"\(derived)\", which the server refuses"
            )
        }
    }

    /// Some names still derive nothing: the fold is ASCII-only, so a wholly non-Latin name has
    /// no characters left after it. That is not a server refusal — the derivation is correct to
    /// refuse to invent a key — but the screen must not then offer a button that cannot work.
    ///
    /// Records what actually happens: the submit stays disabled, with no text on screen saying
    /// why. Silence is the remaining rough edge here, not a wrong key.
    func testNamesThatDeriveNothingLeaveTheFormUnsubmittable() {
        let app = launch(Self.noWorkspace)

        let name = app.textFields["Workspace name"]
        XCTAssertTrue(name.waitForExistence(timeout: 30))

        for unusable in ["Мир", "!!!", "世界"] {
            name.tap()
            clear(name)
            name.typeText(unusable)

            let derived = value(of: app.textFields["Workspace address"], placeholder: "peixoto-labs")
            guard derived.isEmpty else { continue }
            XCTAssertFalse(
                app.buttons["Create workspace"].isEnabled,
                "\"\(unusable)\" derived no address, so the submit must not be offered as usable"
            )
        }
    }

    /// Regression guard: the address row hardcoded `polaris.app/`, which is not a self-hoster's
    /// address and not ours to claim on their screen.
    func testCreateWorkspaceShowsTheRealHost() {
        let app = launch(Self.noWorkspace)
        XCTAssertTrue(app.textFields["Workspace name"].waitForExistence(timeout: 30))
        XCTAssertFalse(
            app.staticTexts["polaris.app/"].exists,
            "REGRESSION: the create-workspace screen is showing a hardcoded polaris.app/ rather than this build's host"
        )
    }

    /// Three of the four fields had no `accessibilityLabel`, so VoiceOver fell back to the
    /// placeholder and read the workspace-name field as "Peixoto Labs".
    func testCreateWorkspaceFieldsAreLabelled() {
        let app = launch(Self.noWorkspace)
        XCTAssertTrue(app.textFields["Workspace name"].waitForExistence(timeout: 30))
        for label in ["Workspace address", "First team name", "Team key"] {
            XCTAssertTrue(
                app.textFields[label].exists,
                "REGRESSION: the \(label) field has no VoiceOver label of its own"
            )
        }
    }

    // MARK: - Navigation and launch arguments

    /// There must be a way back out of both forms.
    func testBothFormsCanBeBackedOutOf() {
        let app = launch()

        openSignUp(app)
        XCTAssertTrue(app.textFields["Your name"].waitForExistence(timeout: 15))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(
            app.buttons["Create an account"].waitForExistence(timeout: 15),
            "there should be a way back from sign-up"
        )

        openSignIn(app)
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 15))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(
            app.buttons["Create an account"].waitForExistence(timeout: 15),
            "there should be a way back from sign-in"
        )
    }

    /// The testability gap this file was originally blocked by: `-polaris-fixtures` alone
    /// answers `signInWithDevSession()`, so the app went straight to the issue list and no
    /// onboarding screen could be driven without a real server. Both halves are pinned here —
    /// fixtures alone still sign in, and the new flag reaches the welcome screen.
    func testLaunchArgumentsReachBothStates() {
        let signedIn = launch(["-polaris-fixtures"])
        XCTAssertTrue(
            signedIn.staticTexts["My Issues"].waitForExistence(timeout: 30),
            "-polaris-fixtures alone should still land on the issue list"
        )
        signedIn.terminate()

        let signedOut = launch()
        XCTAssertTrue(
            signedOut.buttons["Create an account"].waitForExistence(timeout: 30),
            "-polaris-signed-out should reach the welcome screen without a server"
        )
        XCTAssertFalse(
            signedOut.staticTexts["My Issues"].exists,
            "-polaris-signed-out should not be signed in"
        )
    }

    // MARK: - Helpers

    private func openSignUp(_ app: XCUIApplication) {
        let button = app.buttons["Create an account"]
        XCTAssertTrue(button.waitForExistence(timeout: 30), "welcome screen never appeared")
        button.tap()
    }

    private func openSignIn(_ app: XCUIApplication) {
        let button = app.buttons["I already have an account"]
        XCTAssertTrue(button.waitForExistence(timeout: 30), "welcome screen never appeared")
        button.tap()
    }

    /// Signs in with a password the fixture client refuses, and waits for the refusal.
    private func failASignIn(_ app: XCUIApplication) {
        openSignIn(app)
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap()
        email.typeText("qa-nobody@example.com")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("definitely-not-the-password")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(
            app.staticTexts["incorrect email or password"].waitForExistence(timeout: 30),
            "the refusal sentence should reach the screen"
        )
    }

    /// An empty `TextField` reports its *placeholder* as `value`, so reading a derived field
    /// naively makes "no key was derived" indistinguishable from "the key happens to equal the
    /// placeholder" — and a test that skips this reports a pass for a field showing nothing.
    private func value(of field: XCUIElement, placeholder: String) -> String {
        let raw = (field.value as? String) ?? ""
        return raw == placeholder ? "" : raw
    }

    /// Empties a text field. `typeText` appends, so a table-driven test has to clear between
    /// rows or it reads the previous row's value with the next one stuck on the end.
    private func clear(_ field: XCUIElement) {
        guard let existing = field.value as? String, !existing.isEmpty else { return }
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
    }
}
