import Foundation
import Testing
@testable import PolarisCore

/// The half of Sign in with Google that can be tested without a browser, which is deliberately
/// almost all of it: the app target holds an `ASWebAuthenticationSession` and a button, and
/// every decision — what the authorization URL says, whether a callback belongs to us, what a
/// token response means — is in `GoogleSignIn`.
@Suite("Sign in with Google")
struct GoogleSignInTests {
    /// Deterministic bytes, so the URL a test asserts is the URL the code builds. `0x00…`
    /// rather than a real draw: the point is the shape of the request, and the real one comes
    /// from `SecRandomCopyBytes`.
    private static func fixedBytes(_ count: Int) -> Data {
        Data((0..<count).map { UInt8($0 & 0xFF) })
    }

    private func attempt() -> GoogleSignIn.Attempt {
        GoogleSignIn.attempt(randomBytes: Self.fixedBytes)
    }

    /// The single fact that ties the Swift half to `ios/project.yml`: iOS reads the URL scheme
    /// out of the Info.plist before any of this code runs, so the two are written separately
    /// and can drift. If this fails, the plist entry and the client id have parted company —
    /// and the symptom in the app is a sheet that never opens.
    @Test("the redirect scheme is the client id reversed, exactly as the Info.plist registers it")
    func redirectSchemeMatchesTheRegisteredScheme() {
        #expect(
            GoogleSignIn.redirectScheme
                == "com.googleusercontent.apps.415057540542-s7an2kfcima1eqccpre0qq5o79et8s4f"
        )
        // One slash. Two would make `oauth2redirect` the host of the redirect URI, which is a
        // different string from the one registered with the OAuth client, and Google refuses
        // the request rather than redirecting anywhere.
        #expect(GoogleSignIn.redirectURI == GoogleSignIn.redirectScheme + ":/oauth2redirect")
    }

    @Test("the authorization request carries PKCE, the redirect and an openid scope")
    func authorizationURL() throws {
        let attempt = attempt()
        let items = try #require(
            URLComponents(url: attempt.url, resolvingAgainstBaseURL: false)?.queryItems
        )
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })

        #expect(attempt.url.host == "accounts.google.com")
        #expect(query["client_id"] == GoogleSignIn.clientID)
        #expect(query["redirect_uri"] == GoogleSignIn.redirectURI)
        #expect(query["response_type"] == "code")
        // Without `openid` the response carries no ID token at all, and the ID token is the
        // only thing this whole flow exists to produce.
        #expect(query["scope"] == "openid email profile")
        // `plain` would put the verifier in a URL the browser and the OS both log.
        #expect(query["code_challenge_method"] == "S256")
        #expect(query["code_challenge"] == GoogleSignIn.challenge(for: attempt.codeVerifier))
        #expect(query["state"] == attempt.state)
        #expect(query["nonce"] == attempt.nonce)
    }

    /// RFC 7636's own test vector. The challenge is the one value Google recomputes on the
    /// other side, so an encoding mistake here is a flow that fails only against the real
    /// token endpoint — the most expensive place to find it.
    @Test("the PKCE challenge is base64url of SHA-256, per RFC 7636's vector")
    func pkceVector() {
        #expect(
            GoogleSignIn.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
                == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
    }

    @Test("the secrets are fresh on every attempt")
    func secretsAreNotReused() {
        let first = GoogleSignIn.attempt()
        let second = GoogleSignIn.attempt()
        #expect(first.codeVerifier != second.codeVerifier)
        #expect(first.state != second.state)
        #expect(first.nonce != second.nonce)
        // base64url only: a `+` or a `/` in a query value that something along the way
        // re-encodes is a verifier that no longer matches its challenge.
        #expect(first.codeVerifier.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
    }

    @Test("a matching callback yields the code")
    func callbackCode() throws {
        let url = URL(string: "\(GoogleSignIn.redirectScheme):/oauth2redirect?state=s1&code=4/abc")!
        #expect(try GoogleSignIn.callback(url, state: "s1") == .code("4/abc"))
    }

    /// Any app on the device may claim a custom scheme, so a callback that is not an answer to
    /// the request this app made is not a sign-in — whatever code it carries.
    @Test("a callback with somebody else's state is refused before its code is read")
    func callbackStateMismatch() {
        let url = URL(string: "\(GoogleSignIn.redirectScheme):/oauth2redirect?state=other&code=4/abc")!
        #expect(throws: PolarisError.unauthorized("that sign-in could not be verified")) {
            try GoogleSignIn.callback(url, state: "s1")
        }
    }

    /// Pressing Cancel on Google's consent screen is a decision, not a fault. It has to reach
    /// the button as something other than an error, or the screen puts an alert in front of
    /// somebody who just told it no.
    @Test("access_denied reads as a cancellation, not a failure")
    func callbackCancelled() throws {
        let url = URL(string: "\(GoogleSignIn.redirectScheme):/oauth2redirect?state=s1&error=access_denied")!
        #expect(try GoogleSignIn.callback(url, state: "s1") == .cancelled)
    }

    @Test("any other error from Google is a refusal")
    func callbackError() {
        let url = URL(string: "\(GoogleSignIn.redirectScheme):/oauth2redirect?state=s1&error=invalid_scope")!
        #expect(throws: PolarisError.unauthorized("that sign-in could not be completed")) {
            try GoogleSignIn.callback(url, state: "s1")
        }
    }

    @Test("a callback with neither code nor error is not a session")
    func callbackEmpty() {
        let url = URL(string: "\(GoogleSignIn.redirectScheme):/oauth2redirect?state=s1")!
        #expect(throws: PolarisError.badResponse) {
            try GoogleSignIn.callback(url, state: "s1")
        }
    }

    /// Form-encoded and secretless. A JSON body is answered with `400 invalid_request`, and an
    /// empty `client_secret` is rejected rather than ignored — an iOS OAuth client is issued
    /// without one.
    @Test("the token request is form-encoded, carries the verifier, and holds no secret")
    func tokenRequestShape() throws {
        let request = GoogleSignIn.tokenRequest(code: "4/abc", codeVerifier: "v-1")

        #expect(request.url?.absoluteString == "https://oauth2.googleapis.com/token")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")

        let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
        let fields = Dictionary(uniqueKeysWithValues: body.split(separator: "&").map { pair -> (String, String) in
            let halves = pair.split(separator: "=", maxSplits: 1)
            return (String(halves[0]), String(halves[1]))
        })
        #expect(fields["grant_type"] == "authorization_code")
        #expect(fields["code_verifier"] == "v-1")
        #expect(fields["client_id"] == GoogleSignIn.clientID)
        #expect(fields["client_secret"] == nil)
        // The redirect URI's colon and slash have to survive the form encoding, or the value
        // Google compares against the registered one is a different string.
        #expect(fields["redirect_uri"] == GoogleSignIn.redirectURI.addingPercentEncoding(
            withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        ))
    }

    @Test("the ID token is read out of a token response")
    func idToken() throws {
        let body = Data(#"{"access_token":"at","id_token":"eyJ.header.sig","expires_in":3599}"#.utf8)
        #expect(try GoogleSignIn.idToken(fromTokenResponse: body) == "eyJ.header.sig")
    }

    /// Google's own wording ("Malformed auth code.") is written for whoever wrote the client,
    /// not for whoever is holding the phone.
    @Test("an OAuth error becomes the same refusal the server gives, not Google's developer copy")
    func tokenResponseError() {
        let body = Data(#"{"error":"invalid_grant","error_description":"Malformed auth code."}"#.utf8)
        #expect(throws: PolarisError.unauthorized("that sign-in could not be completed")) {
            try GoogleSignIn.idToken(fromTokenResponse: body)
        }
    }

    @Test("a response with no ID token is not a sign-in")
    func tokenResponseWithoutIDToken() {
        // A valid OAuth response that simply has no `id_token`: what comes back when the
        // `openid` scope goes missing, which is a bug that otherwise surfaces as an empty
        // string posted to Polaris.
        let body = Data(#"{"access_token":"at","expires_in":3599}"#.utf8)
        #expect(throws: PolarisError.badResponse) {
            try GoogleSignIn.idToken(fromTokenResponse: body)
        }
    }

    @Test("a body that is not JSON at all is a bad response, not a crash")
    func tokenResponseGarbage() {
        #expect(throws: PolarisError.badResponse) {
            try GoogleSignIn.idToken(fromTokenResponse: Data("<html>502</html>".utf8))
        }
    }
}

/// What the sign-in screen asks before it draws a button.
@Suite("Auth providers")
struct AuthProvidersTests {
    @Test("the server's answer decodes, ignoring the browser client ids this app has no use for")
    func decoding() throws {
        let body = Data("""
        {"providers":["google","apple"],"googleClientId":"web.apps.googleusercontent.com",
         "appleClientId":"com.peixotolabs.polaris.web","openSignup":true}
        """.utf8)
        let providers = try JSONDecoder().decode(AuthProviders.self, from: body)
        #expect(providers.offersGoogle && providers.offersApple)
        #expect(providers.openSignup)
    }

    /// A deployment with no Google audiences omits it from the list, and the button is never
    /// drawn — the alternative is a full trip through Google's consent screen ending at a 404.
    @Test("a server offering only Apple offers no Google button")
    func appleOnly() throws {
        let body = Data(#"{"providers":["apple"],"googleClientId":"","appleClientId":"","openSignup":false}"#.utf8)
        let providers = try JSONDecoder().decode(AuthProviders.self, from: body)
        #expect(!providers.offersGoogle)
        #expect(providers.offersApple)
    }

    /// A provider this build has never heard of must not break the ones it has.
    @Test("an unknown provider name is carried, not choked on")
    func unknownProvider() throws {
        let body = Data(#"{"providers":["google","microsoft"],"openSignup":false}"#.utf8)
        let providers = try JSONDecoder().decode(AuthProviders.self, from: body)
        #expect(providers.offersGoogle)
        #expect(providers.providers.contains("microsoft"))
    }

    @Test("a client that cannot answer offers nothing rather than guessing")
    func defaultIsEmpty() async throws {
        // `RefusingClient` implements none of the auth surface, which is exactly the position
        // a double is in: the protocol's default is what it answers with.
        let providers = try await NoAuthClient().authProviders()
        #expect(providers.providers.isEmpty)
        #expect(!providers.offersGoogle)
    }

    @Test("a Google token is exchanged for a session like any other credential")
    @MainActor
    func googleSignsIn() async {
        let model = AppModel(environment: .localDevelopment, api: FixturePolarisClient())

        let failure = await model.signInWithGoogle(
            idToken: "a.google.token", nonce: "n-1", displayName: String?.none
        )

        #expect(failure == nil)
        if case .signedOut = model.phase {
            Issue.record("phase is \(model.phase) after an accepted Google token")
        }
    }

    @Test("the refusal is handed back to the screen, not written into the phase")
    @MainActor
    func googleRefusalIsReported() async {
        let model = AppModel(environment: .localDevelopment, api: FixturePolarisClient())
        let before = model.phase

        let failure = await model.signInWithGoogle(idToken: "", nonce: "n-1", displayName: nil)

        #expect(failure != nil)
        #expect(model.phase == before)
    }

    @Test("providers are asked for once and remembered")
    @MainActor
    func providersAreAskedOnce() async {
        let counting = CountingProvidersClient()
        let model = AppModel(environment: .localDevelopment, api: counting)

        await model.loadAuthProviders()
        await model.loadAuthProviders()

        #expect(model.authProviders?.offersGoogle == true)
        // Both auth screens call this on appear, and moving between them must not be a round
        // trip each time — the same dedupe the web client keeps in `features/auth/providers`.
        #expect(await counting.calls == 1)
    }
}

/// A client with nothing but the protocol's defaults behind its auth surface — the position
/// every double in this suite is in, and the one a narrow decorator elsewhere is in too.
private actor NoAuthClient: PolarisAPI {
    private let error = PolarisError.forbidden

    func signInWithDevSession() async throws -> Session { throw error }
    func signIn(email: String, password: String) async throws -> Session { throw error }
    func signInWithApple(idToken: String, nonce: String, displayName: String?) async throws -> Session { throw error }
    func register(email: String, password: String, inviteToken: String?, displayName: String?) async throws -> Session { throw error }
    func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace { throw error }
    func restoreSession() async throws -> Session { throw error }
    @discardableResult func signOut() async -> PolarisError? { nil }
    func useWorkspace(id: String) async {}

    func viewer() async throws -> Viewer { throw error }
    func syncVersion() async throws -> Int { throw error }
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] { throw error }
    func issues(teamId: String) async throws -> [PolarisCore.Issue] { throw error }
    func issue(id: String) async throws -> PolarisCore.Issue { throw error }
    func comments(issueId: String) async throws -> [PolarisCore.Comment] { throw error }
    func teams() async throws -> [Team] { throw error }
    func workflowStates(teamId: String) async throws -> [WorkflowState] { throw error }
    func users() async throws -> [User] { throw error }
    func unreadNotificationCount() async throws -> Int { throw error }
    func notifications(includeRead: Bool, includeSnoozed: Bool, first: Int?) async throws -> [PolarisNotification] { throw error }
    func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults { throw error }

    func createIssue(_ draft: IssueDraft) async throws -> PolarisCore.Issue { throw error }
    func updateIssue(_ change: IssueChange) async throws -> PolarisCore.Issue { throw error }
    func createComment(issueId: String, body: String, opId: String) async throws -> PolarisCore.Comment { throw error }
    func archiveIssue(id: String, archived: Bool, opId: String) async throws { throw error }
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification { throw error }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification { throw error }
    func deleteNotification(id: String) async throws { throw error }
}

/// Counts the calls, so "asked once" is a fact rather than a hope.
private actor CountingProvidersClient: PolarisAPI {
    private(set) var calls = 0
    private let inner = FixturePolarisClient()

    func authProviders() async throws -> AuthProviders {
        calls += 1
        return try await inner.authProviders()
    }

    func signInWithDevSession() async throws -> Session { try await inner.signInWithDevSession() }
    func signIn(email: String, password: String) async throws -> Session {
        try await inner.signIn(email: email, password: password)
    }
    func signInWithApple(idToken: String, nonce: String, displayName: String?) async throws -> Session {
        try await inner.signInWithApple(idToken: idToken, nonce: nonce, displayName: displayName)
    }
    func register(email: String, password: String, inviteToken: String?, displayName: String?) async throws -> Session {
        try await inner.register(email: email, password: password, inviteToken: inviteToken, displayName: displayName)
    }
    func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace { try await inner.createWorkspace(draft) }
    func restoreSession() async throws -> Session { throw PolarisError.forbidden }
    @discardableResult func signOut() async -> PolarisError? { nil }
    func useWorkspace(id: String) async { await inner.useWorkspace(id: id) }

    func viewer() async throws -> Viewer { try await inner.viewer() }
    func syncVersion() async throws -> Int { try await inner.syncVersion() }
    func myIssues(includeCompleted: Bool) async throws -> [PolarisCore.Issue] {
        try await inner.myIssues(includeCompleted: includeCompleted)
    }
    func issues(teamId: String) async throws -> [PolarisCore.Issue] { try await inner.issues(teamId: teamId) }
    func issue(id: String) async throws -> PolarisCore.Issue { try await inner.issue(id: id) }
    func comments(issueId: String) async throws -> [PolarisCore.Comment] { try await inner.comments(issueId: issueId) }
    func teams() async throws -> [Team] { try await inner.teams() }
    func workflowStates(teamId: String) async throws -> [WorkflowState] { try await inner.workflowStates(teamId: teamId) }
    func users() async throws -> [User] { try await inner.users() }
    func unreadNotificationCount() async throws -> Int { try await inner.unreadNotificationCount() }
    func notifications(includeRead: Bool, includeSnoozed: Bool, first: Int?) async throws -> [PolarisNotification] {
        try await inner.notifications(includeRead: includeRead, includeSnoozed: includeSnoozed, first: first)
    }
    func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults {
        try await inner.search(query: query, teamId: teamId, first: first)
    }

    func createIssue(_ draft: IssueDraft) async throws -> PolarisCore.Issue { try await inner.createIssue(draft) }
    func updateIssue(_ change: IssueChange) async throws -> PolarisCore.Issue { try await inner.updateIssue(change) }
    func createComment(issueId: String, body: String, opId: String) async throws -> PolarisCore.Comment {
        try await inner.createComment(issueId: issueId, body: body, opId: opId)
    }
    func archiveIssue(id: String, archived: Bool, opId: String) async throws {
        try await inner.archiveIssue(id: id, archived: archived, opId: opId)
    }
    func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification {
        try await inner.markNotificationRead(id: id, read: read)
    }
    func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification {
        try await inner.snoozeNotification(id: id, until: until)
    }
    func deleteNotification(id: String) async throws { try await inner.deleteNotification(id: id) }
}
