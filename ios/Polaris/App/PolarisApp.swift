import SwiftUI
import PolarisCore

@main
struct PolarisApp: App {
    @State private var model = AppModel(environment: .current)

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
        if ProcessInfo.processInfo.arguments.contains("-polaris-hosted") { return .hosted }
        #if DEBUG
        return .localDevelopment
        #else
        return .hosted
        #endif
    }
}
