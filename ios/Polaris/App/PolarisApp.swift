import SwiftUI
import PolarisCore

@main
struct PolarisApp: App {
    @State private var model = AppModel(
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
            : FileIssueCache()
    )

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
        if LaunchOptions.forcesHosted { return .hosted }
        #if DEBUG
        return .localDevelopment
        #else
        return .hosted
        #endif
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
}
