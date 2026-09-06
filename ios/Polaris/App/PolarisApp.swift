import SwiftUI
import PolarisCore

@main
struct PolarisApp: App {
    @State private var model: AppModel

    init() {
        let model = AppModel(
            environment: .current,
            api: LaunchOptions.usesFixtures
                ? FixturePolarisClient(
                    signedIn: !LaunchOptions.startsSignedOut,
                    hasWorkspace: !LaunchOptions.startsWithoutWorkspace
                )
                : nil,
            // The fixture app gets an in-memory cache: a UI test run must not leave a real one on
            // disk for the next run to hydrate from, which would make every test depend on the
            // order the previous ones happened to finish in.
            cache: LaunchOptions.usesFixtures
                ? InMemoryIssueCache()
                : FileIssueCache(),
            // No socket under fixtures. The fixture client's socket address is a real
            // `ws://localhost`, and a UI test that dials it depends on what else is running.
            socketConnector: LaunchOptions.usesFixtures ? nil : URLSessionSyncConnector()
        )
        _model = State(initialValue: model)
        // Before the app finishes launching, which is what BGTaskScheduler requires of a
        // registration. Skipped under fixtures with the rest of the badge machinery.
        if !LaunchOptions.usesFixtures {
            BackgroundRefresh.register(model: model)
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.start() }
        }
    }
}

extension PolarisEnvironment {
    /// A debug build talks to a `make dev` stack on the same machine; a release build talks to
    /// the hosted instance. `-polaris-hosted` forces the hosted one from the scheme, so the
    /// production path can be exercised from Xcode without editing code.
    ///
    /// This is a launch argument rather than a build flag on purpose: a build flag would make
    /// the two paths different binaries, and the one that ships would be the one never run.
    static var current: PolarisEnvironment {
        let base: PolarisEnvironment
        if LaunchOptions.forcesHosted {
            base = .hosted
        } else {
            #if DEBUG
            base = .localDevelopment
            #else
            base = .hosted
            #endif
        }
        guard let hub = LaunchOptions.syncHubURL else { return base }
        return PolarisEnvironment(
            apiBaseURL: base.apiBaseURL, allowsDevSession: base.allowsDevSession, syncHubURL: hub
        )
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

    /// Forces the hosted backend from a Debug build, so the production path can be exercised
    /// without editing code.
    static var forcesHosted: Bool { arguments.contains("-polaris-hosted") }

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
