import AuthenticationServices
import CryptoKit
import PolarisCore
import SwiftUI

/// Sign in with Apple.
///
/// Apple's own button, not a facsimile: `SignInWithAppleButton` is what the Human Interface
/// Guidelines require, it draws itself correctly in both appearances, and it is the only
/// version that keeps working when Apple changes the mark.
///
/// The whole exchange is an ID token. `ASAuthorization` hands one back, the server verifies
/// it against Apple's published keys, and a session comes out — the same session a password
/// produces, so nothing downstream can tell the two apart.
///
/// **App Review, guideline 4.8**: an app offering any third-party sign-in must offer this one
/// too. The web has Google and Apple; the app has Apple and a password, and adding Google
/// here without this button would be a rejection rather than a feature.
struct AppleSignInButton: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    /// Reported to the screen so the failure lands beside the form, not in a global phase.
    let onFailure: (PolarisError) -> Void
    let onStart: () -> Void

    /// The nonce this attempt is bound to.
    ///
    /// Regenerated per authorisation and never reused: it is what stops an assertion captured
    /// from one sign-in being replayed into another. Held in `@State` because the value has to
    /// survive from configuring the request until the credential comes back.
    @State private var nonce = ""

    var body: some View {
        SignInWithAppleButton(.continue) { request in
            nonce = Self.newNonce()
            request.requestedScopes = [.fullName, .email]
            // Apple echoes this into the token's `nonce` claim, and the server compares it
            // against the value the app sends alongside. Sending the raw string both ways is
            // deliberate: hashing here would mean hashing there, and a mismatch in that
            // convention fails with an error that names neither side.
            request.nonce = nonce
            onStart()
        } onCompletion: { result in
            switch result {
            case let .success(authorization):
                handle(authorization)
            case let .failure(error):
                // Cancelling is not a failure worth showing. `ASAuthorizationError.canceled`
                // is somebody changing their mind, and an alert about it makes an ordinary
                // gesture look like a fault.
                if (error as? ASAuthorizationError)?.code != .canceled {
                    onFailure(.unauthorized("that sign-in could not be completed"))
                }
            }
        }
        .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
        .frame(height: 48)
        .accessibilityIdentifier("auth.apple")
    }

    private func handle(_ authorization: ASAuthorization) {
        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let data = credential.identityToken,
            let token = String(data: data, encoding: .utf8)
        else {
            onFailure(.unauthorized("Apple returned no identity token"))
            return
        }

        // Apple sends the name once, on the first authorisation for this app, and never
        // again. Read here or lost for good.
        let name = [credential.fullName?.givenName, credential.fullName?.familyName]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)

        let boundNonce = nonce
        Task {
            if let error = await model.signInWithApple(
                idToken: token,
                nonce: boundNonce,
                displayName: name.isEmpty ? nil : name
            ) {
                onFailure(error)
            }
        }
    }

    /// A random nonce, URL-safe and long enough that guessing it is not a strategy.
    private static func newNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        // SecRandomCopyBytes rather than a Swift RNG: this is the value the replay defence
        // rests on, and it should come from the system CSPRNG.
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            // Falling back to a system UUID rather than to something weaker. This branch is
            // not reachable in practice; a nonce that is merely unique is still far better
            // than a constant.
            return UUID().uuidString + UUID().uuidString
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
