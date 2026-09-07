import AuthenticationServices
import PolarisCore
import SwiftUI

/// Sign in with Google.
///
/// Drawn only when the server says it offers Google — see `AppModel.loadAuthProviders`. A
/// deployment without `POLARIS_GOOGLE_CLIENT_IDS` answers `POST /auth/oidc/google` with a
/// 404, and a button that completes an entire sign-in at Google before failing against a
/// route that does not exist is worse than no button at all.
///
/// There is no Google SDK here and there is not going to be one: this app carries zero
/// third-party dependencies, and adding a package to open a web view is a poor trade. What
/// replaces it is `ASWebAuthenticationSession` — the system's own OAuth browser, which shares
/// Safari's cookies, so somebody already signed in to Google taps once — plus the PKCE
/// plumbing in `PolarisCore.GoogleSignIn`, where it can be tested without a browser.
///
/// The button itself follows Google's identity branding guidelines rather than this app's
/// house style: their surface, their stroke, their label colour, their wording, and the G
/// drawn as vectors. Every colour still comes from `Theme` — the guidelines fix the values,
/// the token layer is how a view is stopped from naming one directly.
struct GoogleSignInButton: View {
    @Environment(AppModel.self) private var model

    /// "Sign in with Google" beside a password form, "Continue with Google" where the screen
    /// is not specifically about signing in. Both are permitted wordings; inventing a third
    /// is not.
    let title: String
    let onFailure: (PolarisError) -> Void
    let onStart: () -> Void
    /// Somebody closed the sheet. Separate from `onFailure` because the screen still has to
    /// hear about it — it put itself in a busy state on `onStart`, and a dismissed sheet that
    /// reports nothing leaves a spinner running over a form that is perfectly usable.
    let onCancel: () -> Void

    var body: some View {
        Button(action: start) {
            HStack(spacing: Theme.Space.md) {
                GoogleMark()
                    .frame(width: 20, height: 20)
                Text(title)
                    // Google specifies Roboto Medium. It is not on iOS and shipping a font
                    // file to draw eleven words is not a trade worth making; the system face
                    // at the same weight is what every other native app does here.
                    .font(.system(.subheadline).weight(.medium))
                    .foregroundStyle(Theme.googleLabel)
            }
            .frame(maxWidth: .infinity)
            // 48, matching the Apple button above it rather than Google's 40pt minimum. Two
            // adjacent buttons of different heights read as a mistake, and the guidelines set
            // a floor, not a fixed size.
            .frame(height: 48)
            .background(Theme.googleSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.googleBorder, lineWidth: 1)
            )
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier("auth.google")
    }

    private func start() {
        onStart()
        let attempt = GoogleSignIn.attempt()
        Task {
            do {
                // The flow object has to outlive the await: `presentationContextProvider` is
                // a weak reference, and a provider that has been released takes the sheet
                // with it — the session ends immediately with no error worth the name.
                let flow = GoogleAuthorizationFlow()
                guard let redirect = try await flow.authorize(attempt.url) else {
                    onCancel()
                    return
                }
                switch try GoogleSignIn.callback(redirect, state: attempt.state) {
                case .cancelled:
                    onCancel()
                case let .code(code):
                    let idToken = try await exchange(code: code, verifier: attempt.codeVerifier)
                    if let error = await model.signInWithGoogle(
                        idToken: idToken, nonce: attempt.nonce, displayName: nil
                    ) {
                        onFailure(error)
                    }
                }
            } catch {
                onFailure(PolarisError.mapped(error))
            }
        }
    }

    /// Trades the authorization code for an ID token, on the device.
    ///
    /// Straight to Google rather than through `LivePolarisClient`, because this is not a
    /// Polaris call: it goes to `oauth2.googleapis.com` with no session, no workspace header
    /// and nothing the client's transport does for a Polaris request. The Polaris server sees
    /// only what comes out — the ID token, on the same endpoint the web client uses.
    private func exchange(code: String, verifier: String) async throws -> String {
        let request = GoogleSignIn.tokenRequest(code: code, codeVerifier: verifier)
        let (data, _) = try await URLSession.shared.data(for: request)
        // The status is not consulted: an OAuth token endpoint puts its reason in the body
        // either way, and `idToken(fromTokenResponse:)` reads both shapes.
        return try GoogleSignIn.idToken(fromTokenResponse: data)
    }
}

/// Owns one `ASWebAuthenticationSession` for the length of one sign-in.
///
/// A class, and held alive by the caller, because the session's context provider is weak and
/// the session itself is cancelled the moment nothing references it. Both facts have exactly
/// one symptom — the sheet does not appear — which is why they are stated here rather than
/// left to be rediscovered.
@MainActor
private final class GoogleAuthorizationFlow: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    /// Opens the authorization page and resolves with the redirect, or nil when the person
    /// dismissed it. Dismissal is not an error: an alert about somebody changing their mind
    /// makes an ordinary gesture look like a fault — the same call `AppleSignInButton` makes
    /// for `ASAuthorizationError.canceled`.
    func authorize(_ url: URL) async throws -> URL? {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: GoogleSignIn.redirectScheme
            ) { callback, error in
                if let callback {
                    continuation.resume(returning: callback)
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    continuation.resume(returning: nil)
                } else {
                    continuation.resume(throwing: PolarisError.unauthorized("that sign-in could not be completed"))
                }
            }
            session.presentationContextProvider = self
            // Not ephemeral. An ephemeral session throws away the browser's cookies, which
            // means anybody already signed in to Google on this device is made to type a
            // password they have already typed — the single biggest reason to use the system
            // browser rather than an embedded web view in the first place.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            // The foreground scene's key window. `ASPresentationAnchor()` compiles and
            // presents nothing on iOS — it is an empty UIWindow with no scene — so the
            // fallback is the first window of any connected scene rather than a fresh one.
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap(\.windows)
            return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        }
    }
}

/// Google's G, as vectors.
///
/// Drawn rather than bundled: the branding assets are Google's to license, an image in the
/// asset catalogue is one more thing to keep at three scales, and a mark built from arcs is
/// crisp at any size and in any appearance. The geometry is an approximation of the official
/// artwork — four arcs of a ring, plus the bar — accurate enough to be the Google mark and
/// not so exact that it needs to be re-measured when nothing has changed.
private struct GoogleMark: View {
    /// Ring thickness, as a fraction of the frame.
    private let weight: CGFloat = 0.22

    var body: some View {
        // A canvas rather than four stacked Shapes: the arcs share a centre and a radius, and
        // splitting them across views is four chances for one of them to be a pixel off.
        Canvas { context, size in
            let side = min(size.width, size.height)
            let centre = CGPoint(x: size.width / 2, y: size.height / 2)
            let line = side * weight
            let radius = (side - line) / 2

            // Screen angles: 0° is east, and they grow clockwise, so 270° is the top. The gap
            // between the red arc's end and the bar is the slot on the mark's right side.
            let arcs: [(Palette.Token, Double, Double)] = [
                (Palette.GoogleMark.red, 200, 315),
                (Palette.GoogleMark.blue, 345, 45),
                (Palette.GoogleMark.green, 45, 140),
                (Palette.GoogleMark.yellow, 140, 200),
            ]
            for (token, start, end) in arcs {
                var path = Path()
                path.addArc(
                    center: centre,
                    radius: radius,
                    startAngle: .degrees(start),
                    endAngle: .degrees(end),
                    clockwise: false
                )
                context.stroke(path, with: .color(Color(token)), lineWidth: line)
            }

            // The bar, in the blue of the arc it joins. It starts at the centre and runs to
            // the ring's outer edge, which is where the blue arc already is at 0° — so the
            // two meet flush and read as one shape.
            let bar = CGRect(
                x: centre.x,
                y: centre.y - line / 2,
                width: radius + line / 2,
                height: line
            )
            context.fill(Path(bar), with: .color(Color(Palette.GoogleMark.blue)))
        }
        // Decorative. The button's own label already says Google, and a second announcement
        // is one more thing for VoiceOver to read before the reader reaches the verb.
        .accessibilityHidden(true)
    }
}
