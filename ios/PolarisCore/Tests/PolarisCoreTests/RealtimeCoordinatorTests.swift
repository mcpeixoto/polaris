import Foundation
import Testing
@testable import PolarisCore

// The coordinator's rules — signal means refetch, background means stop, poll only while the
// socket is down — driven through the same scripted transport SyncSocketTests uses. Nothing
// here touches the network.

/// Counts what the coordinator asked of the app.
@MainActor
final class HookLog {
    var refreshed: [Int] = []
    var polls = 0
    var version: Int? = 5
    var pollFailure: PolarisError?
    var refreshFailure: PolarisError?

    var hooks: RealtimeCoordinator.Hooks {
        RealtimeCoordinator.Hooks(
            lastSeenVersion: { [weak self] in self?.version },
            refresh: { [weak self] version in
                self?.refreshed.append(version)
                return self?.refreshFailure
            },
            poll: { [weak self] in
                self?.polls += 1
                return self?.pollFailure
            }
        )
    }
}

@MainActor
private func waitUntil(
    _ timeout: Duration = .seconds(2),
    _ condition: @MainActor () -> Bool
) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
}

@Suite("RealtimeCoordinator")
@MainActor
struct RealtimeCoordinatorTests {
    private func makeCoordinator(
        connector: (any SyncConnecting)?,
        pollInterval: Duration = .seconds(10)
    ) -> RealtimeCoordinator {
        RealtimeCoordinator(
            api: FixturePolarisClient(),
            connector: connector,
            pollInterval: pollInterval,
            clientId: "0192a0b0-0000-7000-8000-000000000001"
        )
    }

    @Test("a delta frame refreshes the app and bumps changeVersion")
    func deltaRefreshes() async throws {
        let connector = FakeConnector()
        let log = HookLog()
        let coordinator = makeCoordinator(connector: connector)
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)
        coordinator.setForeground(true)

        let conn = try #require(await connector.waitForConnections(1))
        #expect(await conn.waitForSent(1))
        let hello = helloObject(conn.sentFrames[0])
        #expect(hello["workspace"] as? String == "ws-1")
        #expect(hello["clientId"] as? String == coordinator.clientId)
        #expect(hello["resume"] as? Int == 5)
        #expect(hello["signalOnly"] as? Bool == true)

        conn.push(#"{"t":"ready","version":5,"heartbeat":30}"#)
        #expect(await waitUntil { coordinator.isSocketConnected })
        // Where we already were: nothing to fetch.
        #expect(log.refreshed.isEmpty)
        #expect(coordinator.changeVersion == 0)

        conn.push(#"{"t":"delta","from":5,"to":9,"changes":[]}"#)
        #expect(await waitUntil { log.refreshed == [9] })
        #expect(coordinator.changeVersion == 1)
        #expect(coordinator.signalCount == 1)

        coordinator.detach()
    }

    @Test("moving to the background closes the socket and stops the poll")
    func backgroundStops() async throws {
        let connector = FakeConnector()
        let log = HookLog()
        let coordinator = makeCoordinator(connector: connector, pollInterval: .milliseconds(30))
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)
        coordinator.setForeground(true)

        let conn = try #require(await connector.waitForConnections(1))
        conn.push(#"{"t":"ready","version":5,"heartbeat":30}"#)
        #expect(await waitUntil { coordinator.isSocketConnected })

        coordinator.setForeground(false)
        #expect(await waitUntil { conn.isClosed })
        #expect(coordinator.isSocketConnected == false)

        let pollsAtBackground = log.polls
        try await Task.sleep(for: .milliseconds(150))
        #expect(log.polls == pollsAtBackground, "nothing polls from the background")
        // A signal from the closed connection must not reach the app either.
        #expect(log.refreshed.isEmpty)

        // Coming back opens a fresh connection resuming from the held version.
        coordinator.setForeground(true)
        let second = try #require(await connector.waitForConnections(2))
        #expect(await second.waitForSent(1))
        #expect(helloObject(second.sentFrames[0])["resume"] as? Int == 5)
        coordinator.detach()
    }

    @Test("polls only while the socket is down")
    func pollsOnlyWhenDisconnected() async throws {
        let connector = FakeConnector()
        let log = HookLog()
        let coordinator = makeCoordinator(connector: connector, pollInterval: .milliseconds(30))
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)
        coordinator.setForeground(true)

        // Disconnected: the timer polls.
        #expect(await waitUntil { log.polls >= 2 })

        let conn = try #require(await connector.waitForConnections(1))
        conn.push(#"{"t":"ready","version":5,"heartbeat":30}"#)
        #expect(await waitUntil { coordinator.isSocketConnected })
        // Allow a tick already in flight to land before counting.
        try await Task.sleep(for: .milliseconds(40))
        let pollsWhileConnected = log.polls
        try await Task.sleep(for: .milliseconds(150))
        #expect(log.polls == pollsWhileConnected, "a socket that is up makes the poll redundant")

        // The connection drops: polling resumes, starting with one immediate check.
        conn.drop()
        #expect(await waitUntil { !coordinator.isSocketConnected })
        #expect(await waitUntil { log.polls > pollsWhileConnected + 1 })
        coordinator.detach()
    }

    @Test("with no connector there is never a socket, and the poll runs every tick")
    func noConnectorPollsOnly() async throws {
        let log = HookLog()
        let coordinator = makeCoordinator(connector: nil, pollInterval: .milliseconds(30))
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)
        coordinator.setForeground(true)
        #expect(await waitUntil { log.polls >= 3 })
        #expect(coordinator.isSocketConnected == false)
        coordinator.detach()
    }

    @Test("detach forgets the session: no socket, no poll, no refresh from a late frame")
    func detachForgets() async throws {
        let connector = FakeConnector()
        let log = HookLog()
        let coordinator = makeCoordinator(connector: connector, pollInterval: .milliseconds(30))
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)
        coordinator.setForeground(true)
        let conn = try #require(await connector.waitForConnections(1))
        conn.push(#"{"t":"ready","version":5,"heartbeat":30}"#)
        #expect(await waitUntil { coordinator.isSocketConnected })

        coordinator.detach()
        #expect(coordinator.workspaceId == nil)
        #expect(await waitUntil { conn.isClosed })
        let polls = log.polls
        conn.push(#"{"t":"delta","from":5,"to":9,"changes":[]}"#)
        try await Task.sleep(for: .milliseconds(120))
        #expect(log.refreshed.isEmpty)
        #expect(log.polls == polls)
        #expect(connector.connections.count == 1, "a detached coordinator does not reconnect")
    }

    @Test("a workspace switch closes the old socket and opens one for the new workspace")
    func reattachSwitchesWorkspace() async throws {
        let connector = FakeConnector()
        let log = HookLog()
        let coordinator = makeCoordinator(connector: connector)
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)
        coordinator.setForeground(true)
        let first = try #require(await connector.waitForConnections(1))

        coordinator.attach(workspaceId: "ws-2", hooks: log.hooks)
        #expect(await waitUntil { first.isClosed })
        let second = try #require(await connector.waitForConnections(2))
        #expect(await second.waitForSent(1))
        #expect(helloObject(second.sentFrames[0])["workspace"] as? String == "ws-2")
        coordinator.detach()
    }

    @Test("a retryable read failure is degraded; anything else, or a success, is not")
    func degraded() async throws {
        let log = HookLog()
        let coordinator = makeCoordinator(connector: nil, pollInterval: .milliseconds(20))
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)

        log.pollFailure = .offline
        coordinator.setForeground(true)
        #expect(await waitUntil { coordinator.isDegraded })
        #expect(coordinator.lastFailure == .offline)

        log.pollFailure = nil
        #expect(await waitUntil { !coordinator.isDegraded })

        // A refused read is a sentence for the screen it happened on, not a connectivity pill.
        log.pollFailure = .forbidden
        #expect(await waitUntil { coordinator.lastFailure == .forbidden })
        #expect(coordinator.isDegraded == false)
        coordinator.detach()
    }

    @Test("the socket connecting clears a stale failure")
    func connectClearsFailure() async throws {
        let connector = FakeConnector()
        let log = HookLog()
        let coordinator = makeCoordinator(connector: connector, pollInterval: .milliseconds(20))
        coordinator.attach(workspaceId: "ws-1", hooks: log.hooks)
        log.pollFailure = .timedOut
        coordinator.setForeground(true)
        #expect(await waitUntil { coordinator.isDegraded })

        log.pollFailure = nil
        let conn = try #require(await connector.waitForConnections(1))
        conn.push(#"{"t":"ready","version":5,"heartbeat":30}"#)
        #expect(await waitUntil { coordinator.isSocketConnected })
        #expect(await waitUntil { !coordinator.isDegraded })
        coordinator.detach()
    }
}

// MARK: - Through the model

@Suite("AppModel realtime wiring")
@MainActor
struct AppModelRealtimeTests {
    @Test("sign-in attaches the socket to the viewer's workspace; sign-out closes it")
    func signInAttachesSignOutDetaches() async throws {
        let connector = FakeConnector()
        let model = AppModel(
            environment: .localDevelopment,
            api: FixturePolarisClient(),
            socketConnector: connector,
            pollInterval: .seconds(10)
        )
        await model.start()
        guard case .ready(let viewer) = model.phase else {
            Issue.record("fixture sign-in did not reach ready: \(model.phase)")
            return
        }
        #expect(model.realtime.workspaceId == viewer.workspace.id)
        // Not before the shell says the app is in front.
        #expect(connector.connections.isEmpty)

        model.realtime.setForeground(true)
        let conn = try #require(await connector.waitForConnections(1))
        #expect(await conn.waitForSent(1))
        let hello = helloObject(conn.sentFrames[0])
        #expect(hello["workspace"] as? String == viewer.workspace.id)
        #expect(hello["token"] as? String == "fixture")
        // The resume point is what the first load observed, not zero.
        #expect(hello["resume"] as? Int == model.issues.lastSeenVersion)
        #expect(UUID(uuidString: hello["clientId"] as? String ?? "") != nil,
                "the server decodes clientId as a UUID")

        await model.signOut()
        #expect(model.realtime.workspaceId == nil)
        #expect(await waitUntil { conn.isClosed })
    }

    @Test("a signal reloads the issue list and the badge")
    func signalReloads() async throws {
        let connector = FakeConnector()
        let model = AppModel(
            environment: .localDevelopment,
            api: FixturePolarisClient(),
            socketConnector: connector,
            pollInterval: .seconds(10)
        )
        await model.start()
        model.realtime.setForeground(true)
        let conn = try #require(await connector.waitForConnections(1))
        let seen = try #require(model.issues.lastSeenVersion)
        conn.push(#"{"t":"ready","version":\#(seen),"heartbeat":30}"#)
        #expect(await waitUntil { model.realtime.isSocketConnected })

        // Something the list does not yet show.
        _ = try await model.api.createIssue(IssueDraft(teamId: "t1", title: "Arrived over the wire"))
        let before = model.issues.issues.value?.count ?? 0
        conn.push(#"{"t":"delta","from":\#(seen),"to":\#(seen + 1),"changes":[]}"#)
        #expect(await waitUntil { (model.issues.issues.value?.count ?? 0) > before })
        #expect(model.realtime.changeVersion == 1)
        await model.signOut()
    }
}

// MARK: - Where the socket dials

@Suite("Sync hub address")
struct SyncHubAddressTests {
    /// The socket dialled `ws://localhost:8088/sync` — the API's port, where `/sync` is a 404
    /// — and never reached `ready` against a `make dev` stack. The hub is its own process
    /// on :8089 there; behind the production proxy it is `/sync` on the API origin.
    @Test("a make dev stack's hub is on its own port; the hosted one is behind the proxy")
    func devHubPort() {
        #expect(LivePolarisClient(environment: .localDevelopment).syncSocketURL().absoluteString
            == "ws://localhost:8089/sync")
        #expect(LivePolarisClient(environment: .hosted).syncSocketURL().absoluteString
            == "wss://polaris.peixotolabs.com/sync")
        #expect(PolarisEnvironment.hosted.syncHubURL == nil)
        // The derived address is unchanged: it is what the proxy path relies on.
        #expect(PolarisEnvironment.localDevelopment.syncSocketURL.absoluteString == "ws://localhost:8088/sync")
    }
}
