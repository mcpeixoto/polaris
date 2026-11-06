import Foundation
import Testing
@testable import PolarisCore

/// The daily anonymous ping: what it carries, when, and that "off" means off.
@Suite("Anonymous usage metrics")
struct MetricsTests {
    /// A fresh suite per test, past the connect screen, so nothing touches the real defaults.
    private func defaults(onboarded: Bool = true) -> UserDefaults {
        let name = "polaris.tests.metrics.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        suite.removePersistentDomain(forName: name)
        if onboarded { ServerPreference.save(ServerPreference.hostedCloudOrigin, defaults: suite) }
        return suite
    }

    private let monday = Date(timeIntervalSince1970: 1_793_000_000)

    private func pending(_ counter: Metrics.Counter, _ store: UserDefaults) -> Int {
        store.integer(forKey: Metrics.Keys.pending(counter))
    }

    @Test("counts add up until a ping lands, and only what it covered is taken off")
    func countsAddUpUntilSent() throws {
        let store = defaults()
        Metrics.count(.sessions, defaults: store)
        Metrics.count(.sessions, defaults: store)
        Metrics.count(.issuesCreated, defaults: store)
        let due = try #require(Metrics.due(now: monday, defaults: store))
        #expect(due.counts == ["sessions": 2, "issues_created": 1, "comments_posted": 0])

        // A comment posted while the ping is in flight waits for tomorrow.
        Metrics.count(.commentsPosted, defaults: store)
        Metrics.sent(due, now: monday, defaults: store)
        #expect(pending(.sessions, store) == 0)
        #expect(pending(.issuesCreated, store) == 0)
        #expect(pending(.commentsPosted, store) == 1)
    }

    @Test("at most once per UTC day, with the same id the next day")
    func oncePerUTCDay() throws {
        let store = defaults()
        let due = try #require(Metrics.due(now: monday, defaults: store))
        Metrics.sent(due, now: monday, defaults: store)
        #expect(Metrics.due(now: monday.addingTimeInterval(3600), defaults: store) == nil)
        let tomorrow = try #require(Metrics.due(now: monday.addingTimeInterval(86_400), defaults: store))
        #expect(tomorrow.id == due.id, "the same install keeps its id")
        #expect(tomorrow.counts.values.allSatisfy { $0 == 0 }, "an idle day still counts the install")
    }

    @Test("off sends nothing, counts nothing, and forgets the id")
    func offSendsNothingAndForgets() throws {
        let store = defaults()
        Metrics.count(.issuesCreated, defaults: store)
        _ = Metrics.due(now: monday, defaults: store)
        #expect(store.string(forKey: Metrics.Keys.id) != nil)

        store.set(false, forKey: Metrics.Keys.share)
        Metrics.count(.issuesCreated, defaults: store)
        #expect(Metrics.due(now: monday, defaults: store) == nil)
        #expect(store.string(forKey: Metrics.Keys.id) == nil)
        #expect(pending(.issuesCreated, store) == 0)

        store.set(true, forKey: Metrics.Keys.share)
        let again = try #require(Metrics.due(now: monday, defaults: store))
        #expect(again.counts["issues_created"] == 0, "nothing counted while off is sent later")
    }

    @Test("nothing before the connect screen has been passed")
    func nothingBeforeOnboarding() {
        #expect(Metrics.due(now: monday, defaults: defaults(onboarded: false)) == nil)
    }

    @Test("its own id, never the client id the server sees with every write")
    func ownID() throws {
        let store = defaults()
        let id = try #require(Metrics.due(now: monday, defaults: store)).id
        #expect(UUID(uuidString: id) != nil)
        #expect(id != ClientIdentity.current(defaults: store))
    }

    @Test("counts are capped at the server's limit")
    func capped() throws {
        let store = defaults()
        store.set(Metrics.maxCount + 50, forKey: Metrics.Keys.pending(.sessions))
        Metrics.count(.sessions, defaults: store)
        #expect(try #require(Metrics.due(now: monday, defaults: store)).counts["sessions"] == Metrics.maxCount)
    }

    /// Anyone adding a field has to change this test, on purpose: the privacy policy lists
    /// exactly these.
    @Test("the payload carries exactly the contract's keys, and valid ones")
    func payloadKeys() throws {
        let payload = try #require(Metrics.due(now: monday, defaults: defaults()))
        let json = try #require(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
        )
        #expect(Set(json.keys) == ["app", "id", "platform", "version", "build", "os", "locale", "counts"])
        #expect(json["app"] as? String == "polaris")
        let counts = try #require(json["counts"] as? [String: Int])
        #expect(Set(counts.keys) == ["sessions", "issues_created", "comments_posted"])
        let field = try Regex("^[A-Za-z0-9._-]{1,32}$")
        for key in ["version", "build", "os", "locale"] {
            let value = try #require(json[key] as? String)
            #expect(value.wholeMatch(of: field) != nil, "\(key)=\(value)")
        }
        let counter = try Regex("^[a-z][a-z0-9_]{0,31}$")
        #expect(counts.keys.allSatisfy { $0.wholeMatch(of: counter) != nil })
    }

    @Test("the endpoint comes from the Info.plist, and tests and fixtures never send")
    func endpoint() {
        let url = "https://example.workers.dev/v1/ping"
        #expect(Metrics.endpoint(env: [:], arguments: [], plist: nil) == nil, "forks send nothing")
        #expect(Metrics.endpoint(env: [:], arguments: [], plist: "") == nil)
        #expect(Metrics.endpoint(env: [:], arguments: [], plist: url)?.absoluteString == url)
        #expect(Metrics.endpoint(env: [:], arguments: ["-polaris-fixtures"], plist: url) == nil)
        #expect(Metrics.endpoint(env: ["XCTestConfigurationFilePath": "/x"], arguments: [], plist: url) == nil)
        #expect(Metrics.endpoint(
            env: ["POLARIS_METRICS_URL": "http://localhost:8787/v1/ping"], arguments: ["-polaris-fixtures"], plist: url
        )?.absoluteString == "http://localhost:8787/v1/ping")
    }

    @Test("locale is language and region only")
    func locale() {
        #expect(Metrics.locale(Locale(identifier: "pt_PT@calendar=japanese;numbers=arab")) == "pt-PT")
        #expect(Metrics.locale(Locale(identifier: "en")) == "en")
    }

    @Test("the day is the UTC day")
    func dayIsUTC() {
        #expect(Metrics.day(Date(timeIntervalSince1970: 0)) == "1970-01-01")
        #expect(Metrics.day(Date(timeIntervalSince1970: 86_399)) == "1970-01-01")
        #expect(Metrics.day(Date(timeIntervalSince1970: 86_400)) == "1970-01-02")
    }

    @Test("the live client counts a comment the server accepted, and only when asked to")
    func liveClientCountsComments() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MetricsStubProtocol.self]
        let session = URLSession(configuration: configuration)
        let environment = PolarisEnvironment(apiBaseURL: URL(string: "https://metrics.test")!, allowsDevSession: false)

        let seen = CounterLog()
        let api = LivePolarisClient(environment: environment, urlSession: session, onUsage: { seen.append($0) })
        _ = try await api.createComment(issueId: "i1", body: "hi", opId: "op-1")
        #expect(seen.all == [.commentsPosted])

        // Every test and the fixture app build the client without one: nothing is counted,
        // and nothing reaches the real defaults.
        let quiet = LivePolarisClient(environment: environment, urlSession: session)
        _ = try await quiet.createComment(issueId: "i1", body: "hi", opId: "op-2")
        #expect(seen.all == [.commentsPosted])
    }
}

private final class CounterLog: @unchecked Sendable {
    private let lock = NSLock()
    private var counters: [Metrics.Counter] = []
    func append(_ c: Metrics.Counter) { lock.lock(); counters.append(c); lock.unlock() }
    var all: [Metrics.Counter] { lock.lock(); defer { lock.unlock() }; return counters }
}

/// Its own stub rather than `StubURLProtocol`, whose routes are global and owned by a
/// serialized suite this one would race.
private final class MetricsStubProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "metrics.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let body: String
        if request.url?.path.hasSuffix("/auth/refresh") == true {
            body = #"{"accessToken":"tok","expiresIn":900,"accountId":"a1","workspaces":[{"id":"w1","name":"Test","urlKey":"test","plan":"free"}]}"#
        } else {
            body = #"{"data":{"createComment":{"version":2,"comment":{"id":"c1","body":"hi","actor":{"type":"USER","id":"u1"},"editedAt":null,"createdAt":"2026-08-25T10:00:00Z"}}}}"#
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}
