import SwiftUI
import PolarisCore
import BackgroundTasks

/// Owns the optional `AppModel` for this process: nil until a server origin is known.
///
/// The environment is a fixed `let` on `AppModel` / `LivePolarisClient`, so changing server
/// means throwing the model away and building a new one — the closest iOS equivalent of
/// desktop recreating the window.
@MainActor
@Observable
final class AppSession {
    private(set) var model: AppModel?

    init() {
        // Each UI-test launch starts without a leftover origin from a prior run, so fixture
        // suites stay deterministic and `-polaris-force-connect` can actually show connect.
        if LaunchOptions.usesFixtures {
            ServerPreference.clear()
        }
        if let environment = PolarisEnvironment.resolveCurrent() {
            adopt(Self.makeModel(environment: environment))
        }
    }

    /// Persist the origin, build a client for it, and hand the shell a fresh model.
    func connect(to origin: URL) {
        ServerPreference.save(origin)
        let environment = PolarisEnvironment.from(
            persistedOrigin: origin,
            syncHubURL: LaunchOptions.syncHubURL
        )
        adopt(Self.makeModel(environment: environment))
    }

    /// Clear the remembered origin and return to the connect flow. Signs out first so the
    /// previous host's cookies and cache do not bleed into the next pick.
    func changeServer() async {
        if let model {
            await model.signOut()
        }
        ServerPreference.clear()
        self.model = nil
        BackgroundRefresh.detach()
    }

    private func adopt(_ model: AppModel) {
        self.model = model
        if !LaunchOptions.usesFixtures {
            BackgroundRefresh.attach(model: model)
        }
    }

    private static func makeModel(environment: PolarisEnvironment) -> AppModel {
        AppModel(
            environment: environment,
            api: LaunchOptions.usesFixtures
                ? FixturePolarisClient(
                    signedIn: !LaunchOptions.startsSignedOut,
                    hasWorkspace: !LaunchOptions.startsWithoutWorkspace
                )
                : nil,
            cache: LaunchOptions.usesFixtures
                ? InMemoryIssueCache()
                : FileIssueCache(),
            socketConnector: LaunchOptions.usesFixtures ? nil : URLSessionSyncConnector()
        )
    }
}

extension PolarisEnvironment {
    /// Resolve from launch args + persistence. Nil means show the connect UI.
    static func resolveCurrent() -> PolarisEnvironment? {
        EnvironmentResolution(
            persistedOrigin: ServerPreference.load(),
            forcedServer: LaunchOptions.serverURL,
            forcedHosted: LaunchOptions.forcesHosted,
            forceConnect: LaunchOptions.forceConnect,
            usesFixtures: LaunchOptions.usesFixtures,
            syncHubURL: LaunchOptions.syncHubURL
        ).resolve()
    }
}
