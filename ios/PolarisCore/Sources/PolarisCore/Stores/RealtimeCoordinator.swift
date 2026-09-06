import Foundation
import Observation
import os

/// Keeps the app's data current while it is in front: a signal-only sync socket when one can
/// be had, and the thirty-second `syncVersion` poll when it cannot.
///
/// The two are alternatives, not a pair. The socket delivers "something moved to version N"
/// within a round trip of the change; the poll asks the same question every thirty seconds.
/// Running both at once would be a query every thirty seconds for information the socket has
/// already delivered, so the poll ticks only while the socket is down — which is also the only
/// time it has anything to add.
///
/// Owned by `AppModel`, which points it at a workspace after sign-in and away from one on
/// sign-out. The shell tells it when the app is in front; nothing runs while it is not,
/// because a socket held open from the background is a socket iOS closes for us a few
/// seconds later, and a poll from the background is a request whose answer nobody sees.
@MainActor
@Observable
public final class RealtimeCoordinator {
    /// What the coordinator does to the rest of the app. Closures rather than a reference to
    /// `AppModel`, so this file does not know about the stores and the tests do not need a
    /// model to drive it.
    public struct Hooks: Sendable {
        /// The version the issue list last observed — the point a reconnect resumes from.
        public var lastSeenVersion: @MainActor @Sendable () -> Int?
        /// A signal arrived: something visible moved to this version. Refetch, and return the
        /// read failure if there was one.
        public var refresh: @MainActor @Sendable (Int) async -> PolarisError?
        /// A poll tick while the socket is down. Check `syncVersion`, refetch if it moved, and
        /// return the read failure if there was one.
        public var poll: @MainActor @Sendable () async -> PolarisError?

        public init(
            lastSeenVersion: @escaping @MainActor @Sendable () -> Int?,
            refresh: @escaping @MainActor @Sendable (Int) async -> PolarisError?,
            poll: @escaping @MainActor @Sendable () async -> PolarisError?
        ) {
            self.lastSeenVersion = lastSeenVersion
            self.refresh = refresh
            self.poll = poll
        }
    }

    /// True between the socket's handshake and its next disconnect. While true, the poll is
    /// idle. Always false when no connector was given — the fixture app — and the poll then
    /// runs every tick, exactly as it did before the socket existed.
    public private(set) var isSocketConnected = false
    /// Bumped once per signal, before the refetch it triggers. A screen holding its own store
    /// — the detail screen, a team's list — reloads on `.onChange` of this rather than being
    /// told individually, so a screen the coordinator has never heard of still updates.
    public private(set) var changeVersion = 0
    /// The last read that failed, from either path. The shell shows an indicator while this
    /// is retryable and nothing while it is not: a 403 is a sentence for the screen it
    /// happened on, not a connectivity pill.
    public private(set) var lastFailure: PolarisError?
    /// Whether the connectivity indicator should show.
    public var isDegraded: Bool { lastFailure?.isRetryable == true }
    public private(set) var isForeground = false
    public private(set) var workspaceId: String?
    /// A UUID, because the server decodes the hello's `clientId` as one and a hello it cannot
    /// decode is a connection that never says `ready`. Per process: a signal-only session
    /// keeps nothing a later launch could resume, so there is nothing for it to identify.
    public let clientId: String

    /// How many poll ticks actually polled, and how many signals arrived. For tests, and for
    /// a debug screen if one is ever wanted.
    public private(set) var pollCount = 0
    public private(set) var signalCount = 0

    private let api: any PolarisAPI
    private let connector: (any SyncConnecting)?
    private let pollInterval: Duration
    private var hooks: Hooks?
    private var socket: SyncSocket?
    private var pollTask: Task<Void, Never>?
    private let log = Logger(subsystem: "com.peixotolabs.polaris", category: "sync")

    /// - Parameters:
    ///   - connector: Opens sockets. Nil means never open one — the fixture app passes nil so
    ///     a UI test run stays hermetic, and `FixturePolarisClient.syncSocketURL()` is a real
    ///     `ws://localhost` address that would otherwise be dialled.
    ///   - pollInterval: Thirty seconds in the app; milliseconds in a test.
    public init(
        api: any PolarisAPI,
        connector: (any SyncConnecting)?,
        pollInterval: Duration = .seconds(30),
        clientId: String = UUID().uuidString.lowercased()
    ) {
        self.api = api
        self.connector = connector
        self.pollInterval = pollInterval
        self.clientId = clientId
    }

    /// Points the coordinator at a workspace. Called after the viewer loads and again on a
    /// workspace switch; a socket open to the workspace being left is closed first, because
    /// its signals would refetch the new workspace's stores for the old one's changes.
    public func attach(workspaceId: String, hooks: Hooks) {
        tearDown()
        self.workspaceId = workspaceId
        self.hooks = hooks
        lastFailure = nil
        reconcile()
    }

    /// Sign-out. Closes the socket, stops the poll and forgets the hooks, which hold the
    /// stores of the session that just ended.
    public func detach() {
        tearDown()
        workspaceId = nil
        hooks = nil
        lastFailure = nil
    }

    /// The shell's scene phase. `.active` starts everything, anything else stops it.
    public func setForeground(_ isForeground: Bool) {
        guard isForeground != self.isForeground else { return }
        self.isForeground = isForeground
        reconcile()
    }

    /// Starts or stops the socket and the poll to match "attached and in front".
    private func reconcile() {
        guard isForeground, let workspaceId, hooks != nil else {
            tearDown()
            return
        }
        if socket == nil, let connector {
            let api = api
            let socket = SyncSocket(
                url: api.syncSocketURL(),
                workspaceId: workspaceId,
                clientId: clientId,
                tokenProvider: { try await api.accessToken() },
                versionProvider: { [weak self] in await self?.hooks?.lastSeenVersion() },
                onSignal: { [weak self] version in await self?.handleSignal(version) },
                onConnectionChange: { [weak self] connected in
                    await self?.handleConnectionChange(connected)
                },
                connector: connector
            )
            self.socket = socket
            log.info("sync socket starting for workspace \(workspaceId, privacy: .public)")
            Task { await socket.start() }
        }
        if pollTask == nil {
            let interval = pollInterval
            pollTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: interval)
                    guard !Task.isCancelled else { return }
                    await self?.tick()
                }
            }
        }
    }

    private func tearDown() {
        pollTask?.cancel()
        pollTask = nil
        if let socket {
            self.socket = nil
            log.info("sync socket stopping")
            Task { await socket.stop() }
        }
        isSocketConnected = false
    }

    private func handleSignal(_ version: Int) async {
        guard let hooks, isForeground else { return }
        signalCount += 1
        changeVersion += 1
        log.debug("signal: workspace moved to version \(version)")
        lastFailure = await hooks.refresh(version)
    }

    private func handleConnectionChange(_ connected: Bool) async {
        // A late "disconnected" from a socket that was already torn down must not restart
        // anything; only the socket this coordinator currently holds gets a say.
        guard socket != nil else { return }
        isSocketConnected = connected
        if connected {
            log.info("sync socket ready")
            // The transport is back. Whatever failed last was most likely the network, and
            // the next read will say so again if it was not.
            lastFailure = nil
        } else {
            log.notice("sync socket disconnected; polling until it returns")
            // Ask straight away rather than waiting up to thirty seconds: this is the moment
            // the list is most likely to be behind, and the poll is the one that says why.
            await tick()
        }
    }

    /// One poll tick. Skipped while the socket is connected, because the socket has already
    /// said everything a `syncVersion` query could.
    func tick() async {
        guard isForeground, let hooks, !isSocketConnected else { return }
        pollCount += 1
        lastFailure = await hooks.poll()
    }
}
