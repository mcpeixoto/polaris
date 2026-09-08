import Foundation
import Testing
@testable import PolarisCore

@Suite("Server preference")
struct ServerPreferenceTests {
    private func defaults() -> UserDefaults {
        let name = "polaris.tests.server.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        suite.removePersistentDomain(forName: name)
        return suite
    }

    @Test("persisted origin round-trips through UserDefaults")
    func roundTrip() {
        let store = defaults()
        let origin = URL(string: "https://polaris.acme.com")!
        ServerPreference.save(origin, defaults: store)
        #expect(ServerPreference.load(defaults: store) == origin)
        ServerPreference.clear(defaults: store)
        #expect(ServerPreference.load(defaults: store) == nil)
    }

    @Test("normalise defaults to https and strips path")
    func normaliseHTTPS() {
        #expect(ServerPreference.normaliseServerURL("polaris.acme.com") == .success(URL(string: "https://polaris.acme.com")!))
        #expect(ServerPreference.normaliseServerURL("https://polaris.acme.com/login?x=1") == .success(URL(string: "https://polaris.acme.com")!))
    }

    @Test("plain http is only for loopback")
    func httpLoopbackOnly() {
        #expect(ServerPreference.normaliseServerURL("http://localhost:8088") == .success(URL(string: "http://localhost:8088")!))
        #expect(ServerPreference.normaliseServerURL("http://127.0.0.1:8088") == .success(URL(string: "http://127.0.0.1:8088")!))
        #expect(ServerPreference.normaliseServerURL("http://polaris.acme.com") == .failure(.httpNotLoopback))
        #expect(ServerPreference.normaliseServerURL("") == .failure(.empty))
        #expect(ServerPreference.normaliseServerURL("not a url") == .failure(.invalid))
    }

    @Test("dev session is allowed only on loopback origins")
    func allowsDevSessionLoopbackOnly() {
        let cloud = PolarisEnvironment.from(persistedOrigin: ServerPreference.hostedCloudOrigin)
        #expect(cloud.allowsDevSession == false)
        #expect(cloud.apiBaseURL == ServerPreference.hostedCloudOrigin)

        let local = PolarisEnvironment.from(persistedOrigin: URL(string: "http://localhost:8088")!)
        #expect(local.allowsDevSession == true)

        let selfHost = PolarisEnvironment.from(persistedOrigin: URL(string: "https://tracker.example")!)
        #expect(selfHost.allowsDevSession == false)
        #expect(selfHost.syncHubURL == nil)
        #expect(selfHost.syncSocketURL.absoluteString == "wss://tracker.example/sync")
    }
}

@Suite("Environment resolution")
struct EnvironmentResolutionTests {
    @Test("persisted origin wins over hosted launch flag")
    func persistedWins() {
        let origin = URL(string: "https://self.example")!
        let env = EnvironmentResolution(
            persistedOrigin: origin,
            forcedHosted: true
        ).resolve()
        #expect(env?.apiBaseURL == origin)
        #expect(env?.allowsDevSession == false)
    }

    @Test("launch-arg server wins over persistence")
    func forcedServerWins() {
        let forced = URL(string: "https://forced.example")!
        let persisted = URL(string: "https://persisted.example")!
        let env = EnvironmentResolution(
            persistedOrigin: persisted,
            forcedServer: forced
        ).resolve()
        #expect(env?.apiBaseURL == forced)
    }

    @Test("hosted flag settles without a pick")
    func hostedFlag() {
        let env = EnvironmentResolution(forcedHosted: true).resolve()
        #expect(env == .hosted)
    }

    @Test("no pick and no fixtures means show connect")
    func showConnect() {
        #expect(EnvironmentResolution().resolve() == nil)
    }

    @Test("fixtures settle to local development without persisting a pick")
    func fixturesHarness() {
        let env = EnvironmentResolution(usesFixtures: true).resolve()
        #expect(env == .localDevelopment)
    }

    @Test("force-connect shows connect even under fixtures")
    func forceConnect() {
        #expect(EnvironmentResolution(forceConnect: true, usesFixtures: true).resolve() == nil)
    }

    @Test("sync hub override attaches to a resolved environment")
    func syncHubOverride() {
        let hub = URL(string: "ws://localhost:8091/sync")!
        let env = EnvironmentResolution(
            forcedHosted: true,
            syncHubURL: hub
        ).resolve()
        #expect(env?.apiBaseURL == PolarisEnvironment.hosted.apiBaseURL)
        #expect(env?.syncHubURL == hub)
    }

    @Test("cloud origin matches the web hosted constant")
    func cloudOriginLiteral() {
        #expect(ServerPreference.hostedCloudOrigin.absoluteString == "https://polaris.peixotolabs.com")
        #expect(PolarisEnvironment.hosted.apiBaseURL == ServerPreference.hostedCloudOrigin)
    }
}
