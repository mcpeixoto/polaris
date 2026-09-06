import Foundation
import Testing
@testable import PolarisCore

// The socket's logic — what goes on the wire, what is made of what comes back, how fast it
// retries, how many refetches a burst of deltas turns into — is tested here with no server
// and no network. The transport is a protocol, and the one below is scripted.

// MARK: - Frame codec

@Suite("SyncFrameCodec")
struct SyncFrameCodecTests {
    @Test("hello declares signalOnly and a zero clientSchema")
    func helloShape() throws {
        let data = SyncFrameCodec.hello(
            token: "tok", workspaceId: "ws-1", clientId: "client-1", resume: 42
        )
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect(object["t"] as? String == "hello")
        #expect(object["token"] as? String == "tok")
        #expect(object["workspace"] as? String == "ws-1")
        #expect(object["clientId"] as? String == "client-1")
        #expect(object["resume"] as? Int == 42)
        // The two fields the server's handshake keys on for a thin client: the flag that
        // exempts it from the schema check, and the schema it therefore does not claim.
        #expect(object["signalOnly"] as? Bool == true)
        #expect(object["clientSchema"] as? Int == 0)
    }

    @Test("ping is the bare frame the server expects")
    func ping() throws {
        let object = try #require(JSONSerialization.jsonObject(with: SyncFrameCodec.ping()) as? [String: Any])
        #expect(object.count == 1)
        #expect(object["t"] as? String == "ping")
    }

    @Test("decodes each server frame the client acts on")
    func decodesKnownFrames() {
        #expect(
            SyncFrameCodec.decode(#"{"t":"ready","version":148213,"serverTime":"2026-09-06T10:00:00Z","heartbeat":30}"#)
                == .ready(version: 148_213, heartbeat: 30)
        )
        #expect(
            SyncFrameCodec.decode(#"{"t":"delta","from":148213,"to":148219,"changes":[{"v":148214,"type":"issue","id":"x","op":"upsert","actor":{"type":"user"}}]}"#)
                == .delta(from: 148_213, to: 148_219)
        )
        #expect(
            SyncFrameCodec.decode(#"{"t":"resync","reason":"gap_too_large","retryAfterMs":1200}"#)
                == .resync(reason: "gap_too_large", retryAfterMs: 1200)
        )
        #expect(SyncFrameCodec.decode(#"{"t":"pong","serverTime":"2026-09-06T10:00:00Z"}"#) == .pong)
        #expect(
            SyncFrameCodec.decode(#"{"t":"error","code":"UNAUTHENTICATED","message":"invalid or expired token"}"#)
                == .error(code: "UNAUTHENTICATED", message: "invalid or expired token")
        )
    }

    @Test("a frame type it does not know is unknown, not an error")
    func unknownType() {
        #expect(SyncFrameCodec.decode(#"{"t":"ack","ops":[],"version":3}"#) == .unknown(type: "ack"))
    }

    @Test("malformed input decodes to nil rather than trapping")
    func malformed() {
        #expect(SyncFrameCodec.decode("not json") == nil)
        #expect(SyncFrameCodec.decode("[]") == nil)
        #expect(SyncFrameCodec.decode("42") == nil)
        #expect(SyncFrameCodec.decode(#"{"version":1}"#) == nil)
        #expect(SyncFrameCodec.decode(#"{"t":"delta","from":"a"}"#) == nil)
        #expect(SyncFrameCodec.decode(#"{"t":"ready"}"#) == nil)
        #expect(SyncFrameCodec.decode(Data()) == nil)
    }

    @Test("a ready without a heartbeat is still a ready")
    func readyWithoutHeartbeat() {
        #expect(SyncFrameCodec.decode(#"{"t":"ready","version":7}"#) == .ready(version: 7, heartbeat: 0))
        #expect(SyncSocket.clampHeartbeat(0) == 5)
        #expect(SyncSocket.clampHeartbeat(30) == 30)
        #expect(SyncSocket.clampHeartbeat(10_000) == 300)
    }
}

// MARK: - Backoff

@Suite("ReconnectBackoff")
struct ReconnectBackoffTests {
    @Test("doubles from one second and caps at sixty")
    func schedule() {
        let backoff = ReconnectBackoff()
        let bases = (0..<8).map { backoff.base(forAttempt: $0) }
        #expect(bases == [1, 2, 4, 8, 16, 32, 60, 60])
    }

    @Test("jitter stays within a quarter of the base and inside the bounds")
    func jitterBounds() {
        var low = ReconnectBackoff()
        var high = ReconnectBackoff()
        for attempt in 0..<8 {
            let base = low.base(forAttempt: attempt)
            let lowest = low.next { $0.lowerBound }
            let highest = high.next { $0.upperBound }
            #expect(lowest == max(1, base * 0.75))
            #expect(highest == min(60, base * 1.25))
            #expect(lowest >= 1)
            #expect(highest <= 60)
        }
    }

    @Test("a successful handshake starts the schedule over")
    func reset() {
        var backoff = ReconnectBackoff()
        _ = backoff.next { $0.lowerBound }
        _ = backoff.next { $0.lowerBound }
        _ = backoff.next { $0.lowerBound }
        #expect(backoff.attempt == 3)
        backoff.reset()
        #expect(backoff.next { $0.upperBound } == 1.25)
    }

    @Test("uses the system generator by default and stays in range")
    func defaultRandom() {
        var backoff = ReconnectBackoff()
        for _ in 0..<50 {
            let delay = backoff.next()
            #expect(delay >= 1 && delay <= 60)
        }
    }
}

// MARK: - Coalescing

/// Collects what the coalescer delivered, in order.
actor SignalLog {
    private(set) var versions: [Int] = []
    func record(_ version: Int) { versions.append(version) }
}

@Suite("SignalCoalescer")
struct SignalCoalescerTests {
    @Test("a lone signal is delivered at once")
    func lone() async throws {
        let log = SignalLog()
        let coalescer = SignalCoalescer(window: .milliseconds(200)) { await log.record($0) }
        await coalescer.signal(10)
        try await Task.sleep(for: .milliseconds(50))
        #expect(await log.versions == [10])
    }

    @Test("a burst becomes one leading and one trailing callback carrying the highest version")
    func burst() async throws {
        let log = SignalLog()
        let coalescer = SignalCoalescer(window: .milliseconds(200)) { await log.record($0) }
        for version in 1...10 {
            await coalescer.signal(version)
        }
        try await Task.sleep(for: .milliseconds(50))
        #expect(await log.versions == [1])
        try await Task.sleep(for: .milliseconds(300))
        #expect(await log.versions == [1, 10])
    }

    @Test("an out-of-order version never lowers what is delivered")
    func neverLowers() async throws {
        let log = SignalLog()
        let coalescer = SignalCoalescer(window: .milliseconds(200)) { await log.record($0) }
        await coalescer.signal(5)
        await coalescer.signal(9)
        await coalescer.signal(7)
        try await Task.sleep(for: .milliseconds(350))
        #expect(await log.versions == [5, 9])
    }

    @Test("cancel drops a queued trailing callback")
    func cancel() async throws {
        let log = SignalLog()
        let coalescer = SignalCoalescer(window: .milliseconds(200)) { await log.record($0) }
        await coalescer.signal(1)
        await coalescer.signal(2)
        await coalescer.cancel()
        try await Task.sleep(for: .milliseconds(350))
        #expect(await log.versions == [1])
    }

    @Test("a signal after the window has passed fires immediately again")
    func afterWindow() async throws {
        let log = SignalLog()
        let coalescer = SignalCoalescer(window: .milliseconds(100)) { await log.record($0) }
        await coalescer.signal(1)
        try await Task.sleep(for: .milliseconds(200))
        await coalescer.signal(2)
        try await Task.sleep(for: .milliseconds(50))
        #expect(await log.versions == [1, 2])
    }
}

// MARK: - Fake transport

/// A scripted connection: the test pushes frames in, the socket's sends are recorded.
final class FakeConnection: SyncConnection, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [Data] = []
    private var continuation: AsyncStream<Data>.Continuation
    private let incoming: AsyncStream<Data>
    private var iterator: AsyncStream<Data>.Iterator
    private var closed = false

    init() {
        var captured: AsyncStream<Data>.Continuation!
        incoming = AsyncStream { captured = $0 }
        continuation = captured
        iterator = incoming.makeAsyncIterator()
    }

    func send(_ data: Data) async throws {
        lock.withLock { sent.append(data) }
    }

    func receive() async throws -> Data {
        // The iterator is only ever advanced by the socket's single read loop.
        var iterator = lock.withLock { self.iterator }
        if let next = await iterator.next() {
            lock.withLock { self.iterator = iterator }
            return next
        }
        throw FakeConnectionError.closed
    }

    func close() {
        lock.lock(); defer { lock.unlock() }
        closed = true
        continuation.finish()
    }

    // Test-side controls.
    func push(_ text: String) { continuation.yield(Data(text.utf8)) }
    func drop() { continuation.finish() }
    var sentFrames: [Data] { lock.withLock { sent } }
    var isClosed: Bool { lock.withLock { closed } }

    /// Waits until the socket has sent `count` frames, so a test does not race the actor.
    func waitForSent(_ count: Int, timeout: Duration = .seconds(2)) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if sentFrames.count >= count { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return false
    }
}

enum FakeConnectionError: Error { case closed }

/// Hands out fake connections in order and remembers every open.
final class FakeConnector: SyncConnecting, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [FakeConnection] = []
    private var urls: [URL] = []

    func open(_ url: URL) async throws -> any SyncConnection {
        let conn = FakeConnection()
        lock.withLock {
            opened.append(conn)
            urls.append(url)
        }
        return conn
    }

    var connections: [FakeConnection] { lock.withLock { opened } }
    var openedURLs: [URL] { lock.withLock { urls } }

    func waitForConnections(_ count: Int, timeout: Duration = .seconds(2)) async -> FakeConnection? {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            let all = connections
            if all.count >= count { return all[count - 1] }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return nil
    }
}

/// Counts token mints, so a test can show every reconnect asked for a fresh one.
actor TokenCounter {
    private(set) var mints = 0
    func mint() -> String {
        mints += 1
        return "token-\(mints)"
    }
}

func helloObject(_ data: Data) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
}

// MARK: - Socket

@Suite("SyncSocket")
struct SyncSocketTests {
    let url = URL(string: "wss://polaris.example.com/sync")!

    private func makeSocket(
        connector: FakeConnector,
        tokens: TokenCounter,
        held: Int?,
        log: SignalLog
    ) -> SyncSocket {
        SyncSocket(
            url: url,
            workspaceId: "ws-1",
            clientId: "client-1",
            tokenProvider: { await tokens.mint() },
            versionProvider: { held },
            onSignal: { await log.record($0) },
            connector: connector,
            backoff: ReconnectBackoff(floor: 0.01, cap: 0.05),
            coalesceWindow: .milliseconds(20)
        )
    }

    @Test("sends a signal-only hello resuming from the held version, then signals on delta")
    func helloThenDelta() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: 100, log: log)

        await socket.start()
        let conn = try #require(await connector.waitForConnections(1))
        #expect(connector.openedURLs == [url])
        #expect(await conn.waitForSent(1))

        let hello = helloObject(conn.sentFrames[0])
        #expect(hello["t"] as? String == "hello")
        #expect(hello["token"] as? String == "token-1")
        #expect(hello["workspace"] as? String == "ws-1")
        #expect(hello["clientId"] as? String == "client-1")
        #expect(hello["resume"] as? Int == 100)
        #expect(hello["signalOnly"] as? Bool == true)
        #expect(hello["clientSchema"] as? Int == 0)

        #expect(await socket.isConnected == false)
        conn.push(#"{"t":"ready","version":100,"serverTime":"2026-09-06T10:00:00Z","heartbeat":30}"#)
        try await Task.sleep(for: .milliseconds(50))
        #expect(await socket.isConnected == true)
        // The server was where we were: nothing to fetch yet.
        #expect(await log.versions == [])

        conn.push(#"{"t":"delta","from":100,"to":103,"changes":[]}"#)
        try await Task.sleep(for: .milliseconds(50))
        #expect(await log.versions == [103])

        await socket.stop()
        #expect(conn.isClosed)
        #expect(await socket.isConnected == false)
    }

    @Test("a ready ahead of the held version is itself a signal")
    func readyAhead() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: 100, log: log)

        await socket.start()
        let conn = try #require(await connector.waitForConnections(1))
        conn.push(#"{"t":"ready","version":150,"serverTime":"2026-09-06T10:00:00Z","heartbeat":30}"#)
        try await Task.sleep(for: .milliseconds(50))
        #expect(await log.versions == [150])
        await socket.stop()
    }

    @Test("an unknown held version resumes from zero")
    func unknownVersion() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: nil, log: log)

        await socket.start()
        let conn = try #require(await connector.waitForConnections(1))
        #expect(await conn.waitForSent(1))
        #expect(helloObject(conn.sentFrames[0])["resume"] as? Int == 0)
        await socket.stop()
    }

    @Test("resync, pong and unknown frames do not disconnect; resync signals")
    func housekeepingFrames() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: 0, log: log)

        await socket.start()
        let conn = try #require(await connector.waitForConnections(1))
        conn.push(#"{"t":"ready","version":0,"serverTime":"2026-09-06T10:00:00Z","heartbeat":30}"#)
        conn.push(#"{"t":"pong","serverTime":"2026-09-06T10:00:00Z"}"#)
        conn.push(#"{"t":"ack","ops":[]}"#)
        conn.push("not json at all")
        conn.push(#"{"t":"resync","reason":"permissions_changed","retryAfterMs":10}"#)
        try await Task.sleep(for: .milliseconds(80))

        #expect(await socket.isConnected == true)
        #expect(connector.connections.count == 1)
        #expect(await log.versions == [0])
        await socket.stop()
    }

    @Test("an error frame reconnects with a fresh token")
    func errorReconnects() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: 0, log: log)

        await socket.start()
        let first = try #require(await connector.waitForConnections(1))
        first.push(#"{"t":"error","code":"UNAUTHENTICATED","message":"invalid or expired token"}"#)

        let second = try #require(await connector.waitForConnections(2))
        #expect(first.isClosed)
        #expect(await second.waitForSent(1))
        // Tokens live fifteen minutes; the one that was refused is never retried.
        #expect(helloObject(second.sentFrames[0])["token"] as? String == "token-2")
        #expect(await tokens.mints == 2)
        await socket.stop()
    }

    @Test("a dropped connection reconnects and resumes")
    func dropReconnects() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: 7, log: log)

        await socket.start()
        let first = try #require(await connector.waitForConnections(1))
        first.push(#"{"t":"ready","version":7,"serverTime":"2026-09-06T10:00:00Z","heartbeat":30}"#)
        try await Task.sleep(for: .milliseconds(30))
        #expect(await socket.isConnected == true)

        first.drop()
        let second = try #require(await connector.waitForConnections(2))
        #expect(await second.waitForSent(1))
        #expect(helloObject(second.sentFrames[0])["resume"] as? Int == 7)
        await socket.stop()
    }

    @Test("stop cancels a pending reconnect")
    func stopCancelsReconnect() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: 0, log: log)

        await socket.start()
        let first = try #require(await connector.waitForConnections(1))
        first.drop()
        await socket.stop()
        try await Task.sleep(for: .milliseconds(150))
        #expect(connector.connections.count == 1)
        #expect(await socket.isConnected == false)
    }

    @Test("start twice opens one connection")
    func startIsIdempotent() async throws {
        let connector = FakeConnector()
        let tokens = TokenCounter()
        let log = SignalLog()
        let socket = makeSocket(connector: connector, tokens: tokens, held: 0, log: log)

        await socket.start()
        await socket.start()
        _ = await connector.waitForConnections(1)
        try await Task.sleep(for: .milliseconds(50))
        #expect(connector.connections.count == 1)
        await socket.stop()
    }
}
