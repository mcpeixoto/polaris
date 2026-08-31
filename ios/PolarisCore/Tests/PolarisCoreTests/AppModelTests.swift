import Foundation
import Testing
@testable import PolarisCore

// MARK: - Sign in with Apple

@Suite("Sign in with Apple")
struct AppleSignInTests {
    /// An Apple assertion has to end in exactly the state a password does. Anything else and
    /// "signed in with Apple" is a subtly different session from "signed in", which is the
    /// kind of difference that surfaces three screens later as a missing workspace.
    @Test("an accepted assertion signs the app in like any other credential")
    @MainActor
    func acceptedAssertionSignsIn() async {
        let model = AppModel(environment: .localDevelopment, api: FixturePolarisClient())

        let failure = await model.signInWithApple(
            idToken: "an.apple.token", nonce: "n-1", displayName: "Ada Lovelace"
        )

        #expect(failure == nil)
        // `ready` or `needsWorkspace` — which one depends on whether the fixture account has
        // a workspace, and that is not what this test is about. What matters is that it is no
        // longer signed out, which is the state a password sign-in leaves too.
        if case .signedOut = model.phase {
            Issue.record("phase is \(model.phase) after an accepted assertion")
        }
    }

    /// A refusal is returned rather than parked in `phase`, for the reason `signIn` gives:
    /// an error that only reaches a global phase leaves the form looking like nothing
    /// happened, and re-announces itself on a screen where it cannot be acted on.
    @Test("a refused assertion is reported to the caller")
    @MainActor
    func refusedAssertionIsReported() async {
        let model = AppModel(environment: .localDevelopment, api: FixturePolarisClient())
        let before = model.phase

        let failure = await model.signInWithApple(idToken: "", nonce: "n-1", displayName: String?.none)

        #expect(failure != nil)
        // Unchanged, which is the actual contract: the refusal is handed back to the screen
        // and nothing is written into the global phase. Asserting a particular phase here
        // would be asserting where the caller happened to start from.
        #expect(model.phase == before)
    }
}
