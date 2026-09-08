import SwiftUI
import PolarisCore

@main
struct PolarisApp: App {
    @State private var session = AppSession()

    init() {
        // Before the app finishes launching, which is what BGTaskScheduler requires of a
        // registration. Skipped under fixtures with the rest of the badge machinery.
        if !LaunchOptions.usesFixtures {
            BackgroundRefresh.register()
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let model = session.model {
                    RootView()
                        .environment(model)
                        .environment(session)
                        .task(id: ObjectIdentifier(model)) { await model.start() }
                } else {
                    ConnectServerView { origin in
                        session.connect(to: origin)
                    }
                }
            }
        }
    }
}

/// Launch-argument switches.
///
/// Arguments rather than build flags, deliberately: a build flag makes the fixture path and
/// the shipping path different binaries, and the one that ships is then the one nobody ran.
/// These are reachable only by passing the argument, so a release build behaves normally
/// unless something explicitly asks otherwise.
enum LaunchOptions {
    private static var arguments: [String] { ProcessInfo.processInfo.arguments }

    /// Runs the whole app against `FixturePolarisClient` — in-memory issues, comments, teams
    /// and people, with no server anywhere. This is what makes the signed-in screens testable
    /// on a machine with no backend, which is otherwise impossible: every screen past the
    /// welcome page needs a session.
    static var usesFixtures: Bool { arguments.contains("-polaris-fixtures") }

    /// Starts the fixture client signed OUT, so the welcome, sign-in, sign-up and
    /// create-workspace screens are reachable without a server.
    ///
    /// `-polaris-fixtures` alone signs straight in and lands on the issue list, which left
    /// every auth screen exactly as untestable as before — the gap `-polaris-fixtures` was
    /// added to close, still open on the half of the app a new user meets first.
    static var startsSignedOut: Bool { arguments.contains("-polaris-signed-out") }

    /// Starts signed in but belonging to no workspace, which is the state every first
    /// registration lands in and the only way to reach CreateWorkspaceView.
    static var startsWithoutWorkspace: Bool { arguments.contains("-polaris-no-workspace") }

    /// Forces the hosted backend, so the production path can be exercised without a pick
    /// and without editing code.
    static var forcesHosted: Bool { arguments.contains("-polaris-hosted") }

    /// Forces the connect UI even under fixtures, so Onboarding QA can cover the first-run
    /// screens without a real network.
    static var forceConnect: Bool { arguments.contains("-polaris-force-connect") }

    /// `-polaris-server https://example.com` settles the origin from the scheme without
    /// writing UserDefaults — for developers and UI tests that need a known host.
    static var serverURL: URL? {
        guard let index = arguments.firstIndex(of: "-polaris-server"),
              arguments.indices.contains(index + 1)
        else { return nil }
        if case .success(let url) = ServerPreference.normaliseServerURL(arguments[index + 1]) {
            return url
        }
        return URL(string: arguments[index + 1])
    }

    /// `-polaris-sync-hub ws://localhost:8091/sync` points the socket at a hub other than the
    /// environment's. A `make dev` stack reuses whatever already owns :8089, which can be a
    /// build from another checkout that predates the server change this client relies on;
    /// a worktree's own hub runs on another port (see the second-stack notes) and this is how
    /// the app reaches it. The API stays where it was — only the socket moves.
    static var syncHubURL: URL? {
        guard let index = arguments.firstIndex(of: "-polaris-sync-hub"),
              arguments.indices.contains(index + 1)
        else { return nil }
        return URL(string: arguments[index + 1])
    }

    /// A link to open once the shell is up, as if it had arrived from another app:
    /// `-polaris-open-url polaris://issue/ENG-1`. For UI tests, which cannot tap a link in
    /// Messages; the app applies it through the same router a real one goes through.
    static var openURL: URL? {
        guard let index = arguments.firstIndex(of: "-polaris-open-url"),
              arguments.indices.contains(index + 1)
        else { return nil }
        return URL(string: arguments[index + 1])
    }
}
