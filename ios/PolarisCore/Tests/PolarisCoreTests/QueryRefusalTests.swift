import Foundation
import Testing
@testable import PolarisCore

/// What the app does with the two refusals that used to be indistinguishable.
///
/// The inbox showed "Too many requests. Try again shortly." on every launch, in production,
/// for everyone. No rate limit was involved and no 429 was ever sent: the `Notifications`
/// query asked for `first: 100`, scored 17,700 points against the API's 10,000-point
/// per-query ceiling, and was refused before it executed — inside an HTTP 200, carrying
/// `extensions.code = RATELIMITED`, which is what this client had been told to render as a
/// rate limit. The app then offered a Retry button for a query that could never succeed.
///
/// Two things had to be true for that sentence to appear, and both are pinned here: the
/// server's code has to distinguish the permanent refusal from the temporary one, and when
/// the refusal really is a rate limit the client has to use the backoff the server sent
/// rather than discarding it and guessing.
/// A stub of this suite's own, rather than `LiveClientTests`'s.
///
/// `URLProtocol` subclasses answer from static state — there is no per-instance seam to inject
/// through — so two suites sharing one class share one routing table. Swift Testing runs
/// suites in parallel, and the first version of this file borrowed that class and produced a
/// beautiful three-way collision: this suite's rate-limit body answered a test in the other
/// one, and `reset()` here wiped routes a test there was about to use. `.serialized` does not
/// help, because it orders tests WITHIN a suite and not between suites. A second class costs
/// twenty lines and shares nothing.
final class RefusalStubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) private static var routes: [String: (status: Int, body: String)] = [:]
    private static let lock = NSLock()

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        routes = [:]
    }

    static func route(_ pathSuffix: String, status: Int = 200, body: String) {
        lock.lock(); defer { lock.unlock() }
        routes[pathSuffix] = (status, body)
    }

    private static func match(_ url: URL?) -> (status: Int, body: String)? {
        guard let path = url?.path else { return nil }
        lock.lock(); defer { lock.unlock() }
        return routes.first { path.hasSuffix($0.key) }?.value
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        guard let answer = Self.match(request.url) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://example.invalid")!,
            statusCode: answer.status,
            httpVersion: "HTTP/1.1",
            headerFields: [:]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(answer.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

@Suite("Refusals the inbox used to confuse", .serialized)
struct QueryRefusalTests {
    private static let environment = PolarisEnvironment(
        apiBaseURL: URL(string: "https://polaris.test")!,
        allowsDevSession: false
    )

    private static let sessionJSON = """
    {"accessToken":"tok","expiresIn":900,"accountId":"a1",
     "workspaces":[{"id":"w1","name":"Test","urlKey":"test","plan":"free"}]}
    """

    private func client() -> LivePolarisClient {
        RefusalStubProtocol.reset()
        RefusalStubProtocol.route("/auth/refresh", body: Self.sessionJSON)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RefusalStubProtocol.self]
        return LivePolarisClient(
            environment: Self.environment, urlSession: URLSession(configuration: configuration)
        )
    }

    /// The bug, from the wire in.
    ///
    /// Status 200, because gqlgen maps a code to a non-200 status only for codes registered
    /// with it and this one is not — so the transport's 429 branch is never reached and
    /// `extensions.code` is the only thing that can tell these apart.
    @Test("a query over the complexity ceiling is not a rate limit")
    func queryTooComplex() async throws {
        let api = client()
        RefusalStubProtocol.route("/graphql", status: 200, body: #"""
        {"errors":[{"message":"this query is too expensive to run","extensions":
        {"code":"QUERY_TOO_COMPLEX","complexity":17700,"limit":10000}}],"data":null}
        """#)
        await #expect(throws: PolarisError.queryTooComplex) {
            try await api.notifications()
        }
    }

    /// The half of the bug the user actually read.
    ///
    /// `.rateLimited` invites a retry and offers a button; this refusal is permanent, so it
    /// must do neither. Asserted on the two properties every screen renders through —
    /// `StateViews` reads exactly these — rather than on any one screen.
    @Test("the ceiling refusal neither invites a retry nor offers a button")
    func queryTooComplexIsTerminal() {
        #expect(PolarisError.queryTooComplex.isRetryable == false)
        #expect(PolarisError.rateLimited(retryAfter: nil).isRetryable == true)
        #expect(!PolarisError.queryTooComplex.displayMessage.isEmpty)
        #expect(!PolarisError.queryTooComplex.displayMessage.lowercased().contains("too many requests"))
    }

    /// A real rate limit, and the number the server sent with it.
    ///
    /// The server has always put `retryAfter` in the extensions of a GraphQL rate limit;
    /// `mapGraphQLError` hardcoded nil and threw it away, so the app said "try again shortly"
    /// where it could have said "try again in 30s". The 429 transport branch already read the
    /// `Retry-After` header — this is the same fact arriving in the body instead.
    @Test("a rate limit in the body keeps the server's backoff")
    func rateLimitKeepsRetryAfter() async throws {
        let api = client()
        RefusalStubProtocol.route("/graphql", status: 200, body: #"""
        {"errors":[{"message":"query complexity budget exhausted","extensions":
        {"code":"RATELIMITED","retryAfter":30}}],"data":null}
        """#)
        await #expect(throws: PolarisError.rateLimited(retryAfter: 30)) {
            try await api.syncVersion()
        }
    }

    /// A rate limit with no hint is still a rate limit, and still says so without a number.
    @Test("a rate limit with no backoff is unchanged")
    func rateLimitWithoutRetryAfter() async throws {
        let api = client()
        RefusalStubProtocol.route("/graphql", status: 200, body: #"""
        {"errors":[{"message":"too many requests","extensions":{"code":"RATELIMITED"}}],"data":null}
        """#)
        await #expect(throws: PolarisError.rateLimited(retryAfter: nil)) {
            try await api.syncVersion()
        }
    }

    /// The page size the inbox asks for, pinned against the cliff it fell off.
    ///
    /// `Notifications` costs roughly `1.6n² + 17n` points — quadratic, because `IssueFields`
    /// carries `labels`, an unpaginated list that inherits the page size — so 73 is served at
    /// 9,768 points and 74 is refused at 10,020. There is nothing at the call site to suggest
    /// that, which is why the number lives in `PageSize` and why
    /// `services/internal/complexity/ios_queries_test.go` scores every document against it.
    @Test("the inbox page size stays well under the ceiling")
    func inboxPageSizeHasHeadroom() {
        #expect(PageSize.inbox <= 73, "above 73 the inbox query is refused outright")
        #expect(PageSize.inbox <= 60, "keep real headroom: the cost is quadratic in this number")
    }
}
