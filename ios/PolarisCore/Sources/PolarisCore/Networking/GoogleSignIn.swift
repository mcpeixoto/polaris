import CryptoKit
import Foundation
import Security

/// Sign in with Google, as far as it can be written without a view.
///
/// Everything here is pure: build a URL, read a callback, build a token request, read a token
/// response. The browser and the network live in the app target, because only it can present
/// an `ASWebAuthenticationSession` — and because a flow that cannot be exercised without a
/// browser is a flow with no tests.
///
/// **Why a code exchange, when the server takes an ID token.** The web client gets one for
/// free: Google Identity Services hands the page a signed ID token and there is no
/// authorization code anywhere. iOS has no such SDK, and this app carries no third-party
/// dependencies — so the only way to an ID token is the authorization-code flow with PKCE,
/// which is what Google requires of native apps and what AppAuth does under the hood. The
/// exchange happens on the device, not on the Polaris server: an iOS OAuth client has no
/// client secret precisely so that it can.
///
/// What reaches Polaris at the end is the same `idToken` string the Apple button sends, on
/// `POST /auth/oidc/google`, verified there against Google's published keys. Nothing about
/// this flow is visible past that call.
public enum GoogleSignIn {

    // MARK: - Configuration

    /// The iOS OAuth client. Not a secret — it travels in the query string of every
    /// authorization request — but it is the one value that must agree with three other
    /// places: the client Google issued, the `CFBundleURLSchemes` entry in `ios/project.yml`,
    /// and the audience list the server accepts (`POLARIS_GOOGLE_CLIENT_IDS`). It is written
    /// once, here, and the URL scheme is derived from it below rather than copied.
    public static let clientID = "415057540542-s7an2kfcima1eqccpre0qq5o79et8s4f.apps.googleusercontent.com"

    /// The custom scheme Google redirects back through: the client id with its dot-separated
    /// components reversed.
    ///
    /// Derived rather than declared, so the scheme cannot drift from the client id. The one
    /// copy that has to be a literal is the `Info.plist` registration in `ios/project.yml` —
    /// iOS reads that before any Swift runs — and `GoogleSignInTests` pins this value against
    /// it so a change to one without the other fails a test rather than a sign-in.
    public static var redirectScheme: String { reversingComponents(of: clientID) }

    /// Google's documented redirect shape for an iOS client: the reversed client id, a single
    /// slash, and a path. A second slash would make `oauth2redirect` the *host*, which the
    /// registered client does not match.
    public static var redirectURI: String { "\(redirectScheme):/oauth2redirect" }

    static let authorizationEndpoint = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    static let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!

    /// `openid` is what makes the response carry an ID token at all; `email` and `profile`
    /// are what put an address and a name in it, which is everything the server needs to
    /// match or create an account. Nothing broader is asked for — this app reads no Google
    /// data beyond who the person is.
    static let scope = "openid email profile"

    // MARK: - Starting an attempt

    /// One authorization attempt, and the three secrets it is bound to.
    ///
    /// All three are generated together and must survive until the callback comes back, which
    /// is why they are one value the caller holds rather than three the caller might refresh
    /// independently — a regenerated `state` between opening the browser and reading the
    /// callback rejects a sign-in that was perfectly good.
    public struct Attempt: Sendable, Hashable {
        /// Where to send the browser.
        public let url: URL
        /// PKCE. Proves at the token endpoint that the app redeeming the code is the app that
        /// asked for it — the whole defence for a public client that has no secret to prove
        /// it with.
        public let codeVerifier: String
        /// Echoed by Google in the callback. Guards against a crafted redirect into our
        /// scheme carrying somebody else's code: any app on the device may claim a custom
        /// scheme, so a callback that did not come from the request we made must be dropped.
        public let state: String
        /// Echoed by Google into the ID token's `nonce` claim, and sent to Polaris alongside
        /// the token so the server can compare them. Same job as the Apple button's nonce,
        /// and sent raw both ways for the same reason: hashing on one side only fails with an
        /// error that names neither side.
        public let nonce: String
    }

    /// Builds an authorization request.
    ///
    /// - Parameter randomBytes: How the three secrets are drawn. Injected so a test can pin
    ///   the URL exactly; every caller in the app takes the default, which is the system
    ///   CSPRNG.
    public static func attempt(
        clientID: String = GoogleSignIn.clientID,
        redirectURI: String = GoogleSignIn.redirectURI,
        randomBytes: (Int) -> Data = GoogleSignIn.randomBytes
    ) -> Attempt {
        let verifier = base64URL(randomBytes(32))
        let state = base64URL(randomBytes(16))
        let nonce = base64URL(randomBytes(16))

        var components = URLComponents(url: authorizationEndpoint, resolvingAgainstBaseURL: false)!
        // URLComponents percent-encodes these; hand-building the query string is how a scope
        // with a space becomes a malformed request that Google answers with a page rather
        // than a redirect.
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "code_challenge", value: challenge(for: verifier)),
            // S256, never `plain`. `plain` puts the verifier in the URL the browser and the
            // OS both log, which is the attack PKCE exists to stop.
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
        ]

        return Attempt(url: components.url!, codeVerifier: verifier, state: state, nonce: nonce)
    }

    /// The PKCE challenge: base64url of SHA-256 over the verifier's ASCII bytes.
    public static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    // MARK: - Reading the callback

    /// What came back through the redirect scheme.
    public enum Callback: Sendable, Equatable {
        case code(String)
        /// Google's `access_denied`: somebody pressed Cancel on the consent screen. Not a
        /// failure to report — an alert about a deliberate gesture makes it look like a
        /// fault, which is the same call `AppleSignInButton` makes for `.canceled`.
        case cancelled
    }

    /// Reads the authorization code out of a redirect, or says why there is none.
    ///
    /// - Parameter state: the value from the `Attempt` this callback should belong to.
    public static func callback(_ url: URL, state: String) throws -> Callback {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value
        }

        // Checked before the code and before the error, because a mismatched state means this
        // callback is not an answer to anything this app asked, whatever else it carries.
        guard value("state") == state else {
            throw PolarisError.unauthorized("that sign-in could not be verified")
        }
        if let error = value("error") {
            if error == "access_denied" { return .cancelled }
            throw PolarisError.unauthorized("that sign-in could not be completed")
        }
        guard let code = value("code"), !code.isEmpty else {
            throw PolarisError.badResponse
        }
        return .code(code)
    }

    // MARK: - Exchanging the code

    /// The POST that trades an authorization code for tokens.
    ///
    /// Form-encoded, not JSON: the token endpoint is RFC 6749 and answers a JSON body with a
    /// `400 invalid_request` to anything else. There is no `client_secret` — an iOS OAuth
    /// client is issued without one, and sending an empty string is rejected rather than
    /// ignored.
    public static func tokenRequest(
        code: String,
        codeVerifier: String,
        clientID: String = GoogleSignIn.clientID,
        redirectURI: String = GoogleSignIn.redirectURI
    ) -> URLRequest {
        var request = URLRequest(url: tokenEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(formEncoded([
            ("client_id", clientID),
            ("code", code),
            ("code_verifier", codeVerifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirectURI),
        ]).utf8)
        return request
    }

    /// The ID token out of a token response, or the reason there is none.
    ///
    /// Only `id_token` is read. The access token in the same body would let this app call
    /// Google's APIs, which it has no business doing — and a token nobody keeps is a token
    /// nobody can leak.
    public static func idToken(fromTokenResponse data: Data) throws -> String {
        struct Response: Decodable {
            let idToken: String?
            let error: String?
            let errorDescription: String?

            enum CodingKeys: String, CodingKey {
                case idToken = "id_token"
                case error
                case errorDescription = "error_description"
            }
        }

        guard let body = try? JSONDecoder().decode(Response.self, from: data) else {
            throw PolarisError.badResponse
        }
        if body.error != nil {
            // Google's own sentence is deliberately not shown: it is written for a developer
            // ("Malformed auth code."), and the person reading it here can do nothing with
            // it. The generic refusal is the same one the Polaris server gives.
            throw PolarisError.unauthorized("that sign-in could not be completed")
        }
        guard let idToken = body.idToken, !idToken.isEmpty else { throw PolarisError.badResponse }
        return idToken
    }

    // MARK: - Bits and bytes

    /// base64url without padding — RFC 7636's alphabet for the verifier and the challenge,
    /// and the alphabet the `state` and `nonce` are safe in as query values.
    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The system CSPRNG, for the same reason `AppleSignInButton` reaches for it: these are
    /// the values the replay and interception defences rest on. Public only because it is the
    /// default argument of a public function; nothing outside this type calls it.
    public static func randomBytes(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        if SecRandomCopyBytes(kSecRandomDefault, count, &bytes) != errSecSuccess {
            // Not reachable in practice. A merely-unique value is still enormously better
            // than a constant, and refusing to sign in at all would be a worse answer.
            return Data((UUID().uuidString + UUID().uuidString).utf8.prefix(count))
        }
        return Data(bytes)
    }

    /// `a.b.c` -> `c.b.a`. Google's "reversed client id".
    static func reversingComponents(of value: String) -> String {
        value.split(separator: ".").reversed().joined(separator: ".")
    }

    /// `application/x-www-form-urlencoded`, escaped by hand.
    ///
    /// `URLComponents.percentEncodedQuery` is not the same encoding: it leaves `+` alone, and
    /// a `+` in a form body is a space by the time the server reads it. Codes and verifiers
    /// are base64url and contain neither, but the value that eventually does is the one that
    /// fails at three in the morning.
    static func formEncoded(_ pairs: [(String, String)]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return pairs
            .map { name, value in
                let escaped = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
                return "\(name)=\(escaped)"
            }
            .joined(separator: "&")
    }
}
