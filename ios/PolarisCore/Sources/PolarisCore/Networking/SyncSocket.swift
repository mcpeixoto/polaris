import Foundation

// The sync socket, used as a doorbell.
//
// The web client holds a replica and applies every delta it receives. This client holds no
// replica (see README, "Architecture: no replica, no socket") and never will: it opens the
// same socket with `signalOnly: true`, which exempts it from the server's client-schema check
// because there are no local rows a mismatch could corrupt, and it reads a `delta` frame as
// nothing more than "something you can see moved to version N — go and fetch it". Payloads are
// not sent to a signal-only session and would not be read if they were.
//
// What that buys over the thirty-second `viewer.syncVersion` poll is latency: a change made on
// the web shows up on the phone in the time it takes to run one query, not on the next tick.
// What it costs is one long-lived connection per foreground app, which the server already
// budgets for.

// MARK: - Frames

/// A frame from the server, reduced to what a signal-only client acts on. Shapes follow
/// `services/internal/syncsrv/protocol.go`; anything that file does not define decodes as
/// `.unknown` so a newer server never disconnects an older app.
public enum SyncFrame: Sendable, Equatable {
    case ready(version: Int, heartbeat: Int)
    case delta(from: Int, to: Int)
    case resync(reason: String, retryAfterMs: Int)
    case pong
    case error(code: String, message: String)
    case unknown(type: String)
}

/// Encoding and decoding of the wire frames, kept free of any I/O so it can be tested with
/// nothing but strings.
public enum SyncFrameCodec {
    /// The one schema number a client with no store can honestly declare. The server ignores
    /// it when `signalOnly` is set; it is sent so the field is present and the intent is
    /// visible in a packet capture.
    public static let clientSchema = 0

    /// The first frame on every connection.
    public static func hello(
        token: String, workspaceId: String, clientId: String, resume: Int
    ) -> Data {
        let frame = HelloFrame(
            t: "hello", token: token, workspace: workspaceId, resume: resume,
            clientSchema: clientSchema, clientId: clientId, signalOnly: true
        )
        // Encoding a struct of strings, ints and a bool cannot fail; the fallback exists so a
        // `try` does not leak into every caller for a case that never happens.
        return (try? JSONEncoder().encode(frame)) ?? Data("{\"t\":\"hello\"}".utf8)
    }

    public static func ping() -> Data { Data("{\"t\":\"ping\"}".utf8) }

    /// Returns nil for anything that is not a JSON object with a string `t`, and `.unknown` for
    /// a `t` this client does not know. Neither is an error: a malformed frame is the server's
    /// problem to have, and the worst a client should do about it is ignore it.
    public static func decode(_ data: Data) -> SyncFrame? {
        let decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        switch envelope.t {
        case "ready":
            guard let frame = try? decoder.decode(ReadyFrame.self, from: data) else { return nil }
            return .ready(version: frame.version, heartbeat: frame.heartbeat ?? 0)
        case "delta":
            guard let frame = try? decoder.decode(DeltaFrame.self, from: data) else { return nil }
            return .delta(from: frame.from, to: frame.to)
        case "resync":
            guard let frame = try? decoder.decode(ResyncFrame.self, from: data) else { return nil }
            return .resync(reason: frame.reason ?? "", retryAfterMs: frame.retryAfterMs ?? 0)
        case "pong":
            return .pong
        case "error":
            guard let frame = try? decoder.decode(ErrorFrame.self, from: data) else { return nil }
            return .error(code: frame.code ?? "", message: frame.message ?? "")
        default:
            return .unknown(type: envelope.t)
        }
    }

    public static func decode(_ text: String) -> SyncFrame? { decode(Data(text.utf8)) }

    private struct HelloFrame: Encodable {
        let t: String
        let token: String
        let workspace: String
        let resume: Int
        let clientSchema: Int
        let clientId: String
        let signalOnly: Bool
    }

    private struct Envelope: Decodable { let t: String }
    private struct ReadyFrame: Decodable {
        let version: Int
        let heartbeat: Int?
    }
    private struct DeltaFrame: Decodable {
        let from: Int
        let to: Int
    }
    private struct ResyncFrame: Decodable {
        let reason: String?
        let retryAfterMs: Int?
    }
    private struct ErrorFrame: Decodable {
        let code: String?
        let message: String?
    }
}

// MARK: - Backoff

/// Exponential reconnect delay with jitter.
///
/// The interesting failure is the server restarting: without jitter every phone reconnects on
/// the same second and the process that just came up falls over again. The cap is a minute
/// rather than the web client's thirty seconds because a phone that has lost the network for
/// a while is usually on a train, and hammering it does not make the tunnel shorter.
public struct ReconnectBackoff: Sendable {
    public var floor: TimeInterval
    public var cap: TimeInterval
    public private(set) var attempt: Int = 0

    public init(floor: TimeInterval = 1, cap: TimeInterval = 60) {
        self.floor = floor
        self.cap = cap
    }

    /// The un-jittered delay for the n-th consecutive failure: floor doubling up to cap.
    public func base(forAttempt n: Int) -> TimeInterval {
        let doubled = floor * pow(2, Double(max(0, n)))
        return min(cap, doubled)
    }

    /// The next delay to sleep, and advances the schedule. `random` is injectable so a test can
    /// pin the jitter; production takes the system generator.
    public mutating func next(
        random: (ClosedRange<Double>) -> Double = { Double.random(in: $0) }
    ) -> TimeInterval {
        let base = base(forAttempt: attempt)
        attempt += 1
        // ±25%, clamped to the schedule's bounds so jitter can neither go under the floor on
        // the first retry nor over the cap on the last.
        let jittered = base * random(0.75...1.25)
        return min(cap, max(floor, jittered))
    }

    /// Called once a connection has completed its handshake: the next failure starts over.
    public mutating func reset() { attempt = 0 }
}

// MARK: - Coalescing

/// At most one callback per window, latest version wins.
///
/// A single web edit fans out as several deltas — the issue, its activity row, the inbox
/// notification — and each would otherwise be a refetch of its own. The first signal in a
/// quiet period fires immediately, so a lone change is not delayed; anything that follows
/// within the window folds into one trailing callback carrying the highest version seen.
public actor SignalCoalescer {
    private let window: Duration
    private let deliver: @Sendable (Int) async -> Void
    private var pending: Int?
    private var lastFired: ContinuousClock.Instant?
    private var trailing: Task<Void, Never>?

    public init(window: Duration, deliver: @escaping @Sendable (Int) async -> Void) {
        self.window = window
        self.deliver = deliver
    }

    public func signal(_ version: Int) {
        pending = max(pending ?? version, version)
        if trailing != nil { return }

        let now = ContinuousClock.now
        if let lastFired, now - lastFired < window {
            let remaining = window - (now - lastFired)
            trailing = Task { [weak self] in
                try? await Task.sleep(for: remaining)
                guard !Task.isCancelled else { return }
                await self?.fire()
            }
            return
        }
        fire()
    }

    /// Drops anything queued. A stopped socket must not wake the app with a stale refetch a
    /// few hundred milliseconds after the screen went away.
    public func cancel() {
        trailing?.cancel()
        trailing = nil
        pending = nil
    }

    private func fire() {
        trailing = nil
        guard let version = pending else { return }
        pending = nil
        lastFired = ContinuousClock.now
        let deliver = deliver
        Task { await deliver(version) }
    }
}

// MARK: - Transport

/// One open WebSocket. The real one wraps `URLSessionWebSocketTask`; tests script a fake.
public protocol SyncConnection: Sendable {
    func send(_ data: Data) async throws
    /// Waits for the next frame. Throws when the socket has closed for any reason.
    func receive() async throws -> Data
    func close()
}

/// Opens connections. A factory rather than a connection, because every reconnect is a new
/// task with a fresh token.
public protocol SyncConnecting: Sendable {
    func open(_ url: URL) async throws -> any SyncConnection
}

/// The production transport.
///
/// No `Origin` header is sent, and none is needed: the server's origin check exists for
/// browsers, where a page on another site could open a socket carrying the visitor's cookies.
/// A request with no `Origin` at all is accepted, and pinned so by
/// `TestSync_AnUpgradeWithNoOriginHeaderIsAccepted` on the server.
public struct URLSessionSyncConnector: SyncConnecting {
    private let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func open(_ url: URL) async throws -> any SyncConnection {
        let task = session.webSocketTask(with: url)
        task.resume()
        return URLSessionSyncConnection(task: task)
    }
}

/// `URLSessionTask` is thread-safe by contract and `@unchecked Sendable` on Apple platforms;
/// this wrapper adds nothing mutable, so the same claim holds for it.
private final class URLSessionSyncConnection: SyncConnection, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    init(task: URLSessionWebSocketTask) { self.task = task }

    func send(_ data: Data) async throws {
        // Text, not binary: the server reads every frame as JSON and the web client sends
        // text, so a binary frame would be the one thing on this socket nobody has tested.
        guard let text = String(data: data, encoding: .utf8) else { return }
        try await task.send(.string(text))
    }

    func receive() async throws -> Data {
        switch try await task.receive() {
        case .string(let text): return Data(text.utf8)
        case .data(let data): return data
        @unknown default: return Data()
        }
    }

    func close() { task.cancel(with: .normalClosure, reason: nil) }
}

// MARK: - Socket

public enum SyncSocketError: Error, Sendable, Equatable {
    /// The first frame after `hello` was not `ready`. An `error` frame's code is carried so
    /// the log says why the server said no.
    case refused(code: String, message: String)
    case unexpectedFirstFrame
    /// Nothing heard for two heartbeat intervals. The connection is half-open: a NAT idle
    /// timeout, a proxy that dropped the stream without a FIN, a resume from sleep.
    case heartbeatTimeout
}

/// A signal-only sync session that stays connected for as long as it is started.
///
/// Reconnects on its own with backoff, minting a fresh token for every attempt because access
/// tokens live fifteen minutes and a phone can easily be offline for longer. Resumes from
/// whatever version the app last saw so a reconnect after backgrounding replays what was
/// missed as one signal rather than losing it.
public actor SyncSocket {
    public let url: URL
    public let workspaceId: String
    public let clientId: String

    /// True between a successful handshake and the next disconnect. For an indicator, not for
    /// logic: the app polls regardless, so a false here means "slower", never "broken".
    public private(set) var isConnected = false

    private let tokenProvider: @Sendable () async throws -> String
    private let versionProvider: @Sendable () async -> Int?
    /// Told every time `isConnected` flips, so an owner can stop polling while the socket is
    /// up and show something while it is down without reading an actor property on a timer.
    private let onConnectionChange: (@Sendable (Bool) async -> Void)?
    private let connector: any SyncConnecting
    private let coalescer: SignalCoalescer
    private var backoff: ReconnectBackoff

    private var runTask: Task<Void, Never>?
    private var connection: (any SyncConnection)?
    /// The highest version the server has told us about on this or any earlier connection,
    /// so a `resync` can still hand the app a number to fetch against.
    private var lastServerVersion = 0
    private var lastHeard = ContinuousClock.now

    /// Bounds on the heartbeat the server asks for. The number arrives in a frame, and a
    /// frame is not a promise: a `heartbeat: 0` would ping in a tight loop.
    static let heartbeatBounds: ClosedRange<Int> = 5...300

    public init(
        url: URL,
        workspaceId: String,
        clientId: String,
        tokenProvider: @escaping @Sendable () async throws -> String,
        versionProvider: @escaping @Sendable () async -> Int?,
        onSignal: @escaping @Sendable (Int) async -> Void,
        onConnectionChange: (@Sendable (Bool) async -> Void)? = nil,
        connector: any SyncConnecting = URLSessionSyncConnector(),
        backoff: ReconnectBackoff = ReconnectBackoff(),
        coalesceWindow: Duration = .milliseconds(500)
    ) {
        self.url = url
        self.workspaceId = workspaceId
        self.clientId = clientId
        self.tokenProvider = tokenProvider
        self.versionProvider = versionProvider
        self.onConnectionChange = onConnectionChange
        self.connector = connector
        self.backoff = backoff
        self.coalescer = SignalCoalescer(window: coalesceWindow, deliver: onSignal)
    }

    /// Opens the socket and keeps it open. Calling it on a running socket does nothing.
    public func start() {
        guard runTask == nil else { return }
        runTask = Task { [weak self] in
            await self?.run()
        }
    }

    /// Closes the socket and cancels any pending reconnect and any queued signal.
    public func stop() {
        runTask?.cancel()
        runTask = nil
        connection?.close()
        connection = nil
        setConnected(false)
        Task { await coalescer.cancel() }
    }

    private func setConnected(_ connected: Bool) {
        guard connected != isConnected else { return }
        isConnected = connected
        guard let onConnectionChange else { return }
        Task { await onConnectionChange(connected) }
    }

    private func run() async {
        while !Task.isCancelled {
            do {
                try await serveOneConnection()
            } catch {
                // Every path out of a connection lands here: a refused hello, a dropped
                // network, an `error` frame, a missed heartbeat. They are all answered the
                // same way, by trying again later.
            }
            connection?.close()
            connection = nil
            setConnected(false)
            if Task.isCancelled { return }

            let delay = backoff.next()
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
        }
    }

    private func serveOneConnection() async throws {
        let token = try await tokenProvider()
        let resume = await versionProvider() ?? 0
        let conn = try await connector.open(url)
        connection = conn
        try Task.checkCancellation()

        try await conn.send(SyncFrameCodec.hello(
            token: token, workspaceId: workspaceId, clientId: clientId, resume: max(0, resume)
        ))

        let heartbeat: Int
        switch SyncFrameCodec.decode(try await conn.receive()) {
        case .ready(let version, let serverHeartbeat):
            heartbeat = Self.clampHeartbeat(serverHeartbeat)
            // The server is ahead of what the app holds: the workspace moved while the socket
            // was down. That is a signal like any other, and the one a reconnect after
            // backgrounding exists to deliver.
            if version > resume { await noteVersion(version) }
        case .error(let code, let message):
            throw SyncSocketError.refused(code: code, message: message)
        default:
            throw SyncSocketError.unexpectedFirstFrame
        }

        setConnected(true)
        backoff.reset()
        lastHeard = ContinuousClock.now

        let pinger = Task { [weak self] in
            await self?.heartbeatLoop(on: conn, every: heartbeat)
        }
        defer { pinger.cancel() }

        while !Task.isCancelled {
            let data = try await conn.receive()
            lastHeard = ContinuousClock.now
            switch SyncFrameCodec.decode(data) {
            case .delta(_, let to):
                await noteVersion(to)
            case .resync:
                // The app refetches everything on any signal, so a resync — which for a
                // replica means "throw it all away" — is just a signal here.
                await coalescer.signal(lastServerVersion)
            case .error(let code, let message):
                throw SyncSocketError.refused(code: code, message: message)
            case .ready, .pong, .unknown, .none:
                continue
            }
        }
    }

    private func noteVersion(_ version: Int) async {
        lastServerVersion = max(lastServerVersion, version)
        await coalescer.signal(version)
    }

    /// Sends a ping every `interval` seconds and gives up on the connection when two of them
    /// pass with nothing heard back. Closing the task makes the read loop's `receive` throw,
    /// which is what puts the socket onto the reconnect path.
    private func heartbeatLoop(on conn: any SyncConnection, every interval: Int) async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(interval))
            } catch {
                return
            }
            if ContinuousClock.now - lastHeard > .seconds(2 * interval) {
                conn.close()
                return
            }
            do {
                try await conn.send(SyncFrameCodec.ping())
            } catch {
                conn.close()
                return
            }
        }
    }

    static func clampHeartbeat(_ seconds: Int) -> Int {
        min(heartbeatBounds.upperBound, max(heartbeatBounds.lowerBound, seconds))
    }
}
