import Foundation
import Testing
@testable import PolarisCore

/// `LivePolarisClient` had no tests at all, which is where two of the sharper bugs lived: a
/// top-level JSON fragment that killed the process rather than throwing, and a comment
/// operation id minted inside the transport so that no two attempts at the same comment
/// shared one.
///
/// A `URLProtocol` stub makes all of it testable host-side, with no server and no simulator —
/// the same trade `FixturePolarisClient` makes for the stores.

/// Answers requests from a script the test sets up. Registered per-`URLSession` through a
/// custom configuration rather than globally, so two tests cannot see each other's routes.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    /// Path suffix -> what to answer with. `nonisolated(unsafe)` with a lock rather than an
    /// actor: `URLProtocol` is a synchronous UIKit-era API and cannot await anything.
    nonisolated(unsafe) private static var routes: [String: (status: Int, headers: [String: String], body: String)] = [:]
    nonisolated(unsafe) private static var recordedBodies: [String: Data] = [:]
    private static let lock = NSLock()

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        routes = [:]
        recordedBodies = [:]
    }

    static func route(
        _ pathSuffix: String,
        status: Int = 200,
        headers: [String: String] = [:],
        body: String
    ) {
        lock.lock(); defer { lock.unlock() }
        routes[pathSuffix] = (status, headers, body)
    }

    /// The body the client actually sent, so a test can assert what went on the wire.
    static func sentBody(for pathSuffix: String) -> [String: Any]? {
        lock.lock(); defer { lock.unlock() }
        guard let data = recordedBodies[pathSuffix] else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private static func match(_ url: URL?) -> (String, (status: Int, headers: [String: String], body: String))? {
        guard let path = url?.path else { return nil }
        lock.lock(); defer { lock.unlock() }
        for (suffix, response) in routes where path.hasSuffix(suffix) {
            return (suffix, response)
        }
        return nil
    }

    private static func record(_ suffix: String, _ request: URLRequest) {
        // URLSession moves `httpBody` into `httpBodyStream` by the time a protocol sees the
        // request, so reading `httpBody` here returns nil and the assertion would silently
        // test nothing.
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var collected = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                collected.append(contentsOf: buffer[0..<read])
            }
            data = collected
        }
        guard let data else { return }
        lock.lock(); defer { lock.unlock() }
        recordedBodies[suffix] = data
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let (suffix, answer) = StubURLProtocol.match(request.url) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        StubURLProtocol.record(suffix, request)
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://example.invalid")!,
            statusCode: answer.status,
            httpVersion: "HTTP/1.1",
            headerFields: answer.headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(answer.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Suite("Live client wire behaviour", .serialized)
struct LiveClientTests {
    private static let environment = PolarisEnvironment(
        apiBaseURL: URL(string: "https://polaris.test")!,
        allowsDevSession: false
    )

    /// A session, so `validToken()` succeeds and every GraphQL call gets as far as the
    /// document it is actually about.
    private static let sessionJSON = """
    {"accessToken":"tok","expiresIn":900,"accountId":"a1",
     "workspaces":[{"id":"w1","name":"Test","urlKey":"test","plan":"free"}]}
    """

    private func client() -> (LivePolarisClient, URLSession) {
        StubURLProtocol.reset()
        StubURLProtocol.route("/auth/refresh", body: Self.sessionJSON)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        // The ephemeral configuration brings its own cookie store, private to this session —
        // which is what makes the sign-out test safe to run beside anything else.
        let session = URLSession(configuration: configuration)
        return (LivePolarisClient(environment: Self.environment, urlSession: session), session)
    }

    /// The crash this suite exists for.
    ///
    /// `unreadNotificationCount` is the one operation whose `data.<field>` is a bare Int, and
    /// `JSONSerialization.data(withJSONObject:)` raises `NSInvalidArgumentException` for a
    /// top-level fragment — an Objective-C exception Swift cannot catch. Before
    /// `.fragmentsAllowed` this line killed the process instead of throwing.
    @Test("a scalar GraphQL field decodes instead of trapping")
    func scalarField() async throws {
        let (api, _) = client()
        StubURLProtocol.route("/graphql", body: #"{"data":{"unreadNotificationCount":7}}"#)
        let count = try await api.unreadNotificationCount()
        #expect(count == 7)
    }

    @Test("a GraphQL errors array becomes a typed error, not a success")
    func graphQLErrors() async throws {
        let (api, _) = client()
        StubURLProtocol.route("/graphql", body: """
        {"errors":[{"message":"Title is required","extensions":{"code":"VALIDATION","field":"title"}}]}
        """)
        await #expect(throws: PolarisError.validation(message: "Title is required", field: "title")) {
            try await api.myIssues(includeCompleted: false)
        }
    }

    @Test("a 401 carries the server's own sentence")
    func unauthorizedKeepsMessage() async throws {
        StubURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let api = LivePolarisClient(environment: Self.environment, urlSession: session)
        StubURLProtocol.route(
            "/auth/login", status: 401,
            body: #"{"error":{"message":"incorrect email or password"}}"#
        )
        await #expect(throws: PolarisError.unauthorized("incorrect email or password")) {
            try await api.signIn(email: "a@b.c", password: "wrong")
        }
    }

    @Test("a 429 keeps Retry-After as a duration")
    func rateLimited() async throws {
        let (api, _) = client()
        StubURLProtocol.route("/graphql", status: 429, headers: ["Retry-After": "30"], body: "{}")
        await #expect(throws: PolarisError.rateLimited(retryAfter: 30)) {
            try await api.syncVersion()
        }
    }

    @Test("a null nullable field is not-found rather than a decoding failure")
    func nullFieldIsNotFound() async throws {
        let (api, _) = client()
        StubURLProtocol.route("/graphql", body: #"{"data":{"issue":null}}"#)
        await #expect(throws: PolarisError.notFound) {
            try await api.issue(id: "gone")
        }
    }

    /// The idempotency fix. The caller's `opId` has to reach the wire unchanged, because that
    /// is the whole mechanism by which a retried comment is recognised as the same comment.
    @Test("a comment sends the caller's opId, not one minted in the transport")
    func commentCarriesCallerOpId() async throws {
        let (api, _) = client()
        StubURLProtocol.route("/graphql", body: """
        {"data":{"createComment":{"version":2,"comment":{"id":"c1","body":"hi",
         "actor":{"type":"USER","id":"u1"},"editedAt":null,"createdAt":"2026-08-25T10:00:00Z"}}}}
        """)
        _ = try await api.createComment(issueId: "i1", body: "hi", opId: "op-42")

        let sent = try #require(StubURLProtocol.sentBody(for: "/graphql"))
        let variables = try #require(sent["variables"] as? [String: Any])
        #expect(variables["opId"] as? String == "op-42")
    }

    /// Signing out offline used to leave the refresh cookie in place, so the next launch
    /// restored the session and signed the user back in — on a device they had just handed
    /// back.
    @Test("a failed logout still clears the refresh cookie, and says it failed")
    func signOutClearsCookiesEvenWhenLogoutFails() async throws {
        let (api, session) = client()
        let storage = try #require(session.configuration.httpCookieStorage)
        let cookie = try #require(HTTPCookie(properties: [
            .domain: "polaris.test",
            .path: "/",
            .name: "polaris_refresh",
            .value: "still-live",
        ]))
        storage.setCookie(cookie)
        #expect(storage.cookies?.isEmpty == false)

        StubURLProtocol.route("/auth/logout", status: 500, body: #"{"error":{"message":"nope"}}"#)
        let failure = await api.signOut()

        #expect(failure == .server(status: 500, message: "nope"))
        #expect(storage.cookies?.isEmpty != false, "the refresh cookie survived a sign-out")
    }

    /// RFC 6265, not `hasSuffix`. The obvious test — localhost — passes either way; the hosted
    /// build is the one where a cookie set on `.peixotolabs.com` has to be matched for a
    /// request to `polaris.peixotolabs.com`.
    @Test("cookie domains match the way the RFC says, including the leading-dot form")
    func cookieDomainMatching() {
        #expect(LivePolarisClient.cookie("localhost", covers: "localhost"))
        #expect(LivePolarisClient.cookie(".peixotolabs.com", covers: "polaris.peixotolabs.com"))
        #expect(LivePolarisClient.cookie("polaris.peixotolabs.com", covers: "polaris.peixotolabs.com"))
        #expect(!LivePolarisClient.cookie("evil.com", covers: "polaris.peixotolabs.com"))
        #expect(!LivePolarisClient.cookie("peixotolabs.com.evil.com", covers: "polaris.peixotolabs.com"))
    }

    @Test("a snooze deadline goes out as UTC RFC3339")
    func snoozeEncodesTime() async throws {
        let (api, _) = client()
        StubURLProtocol.route("/graphql", body: """
        {"data":{"snoozeNotification":{"version":3,"notification":{"id":"n1","type":"MENTION",
         "issueId":null,"commentId":null,"actor":{"type":"USER","id":"u1"},"count":1,
         "readAt":null,"snoozedUntil":"2026-09-01T00:00:00Z","createdAt":"2026-08-25T10:00:00Z",
         "issue":null}}}}
        """)
        _ = try await api.snoozeNotification(
            id: "n1", until: Date(timeIntervalSince1970: 1_788_220_800)
        )
        let sent = try #require(StubURLProtocol.sentBody(for: "/graphql"))
        let variables = try #require(sent["variables"] as? [String: Any])
        let until = try #require(variables["until"] as? String)
        #expect(until.hasSuffix("Z"))
        #expect(PolarisJSON.parseRFC3339(until) == Date(timeIntervalSince1970: 1_788_220_800))
    }
}
