import SwiftUI
import PolarisCore

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            switch model.phase {
            case .launching:
                LoadingView(label: "Opening Polaris")
            case .signedOut(let error):
                WelcomeView(error: error)
            case .needsWorkspace:
                NavigationStack { CreateWorkspaceView() }
            case .ready(let viewer):
                MainTabView(viewer: viewer)
            }
        }
        .preferredColorScheme(.dark)
        // One curve for the whole shell, so a sign-in does not cut to the issue list.
        .animation(Theme.easing(0.4), value: model.phase)
    }
}

struct MainTabView: View {
    let viewer: Viewer
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            MyIssuesView()
                .tabItem { SwiftUI.Label("Issues", systemImage: "checklist") }
                .tag("issues")

            SettingsView(viewer: viewer)
                .tabItem { SwiftUI.Label("Settings", systemImage: "gearshape") }
                .tag("settings")
        }
        .tint(Theme.accentBright)
        // This client holds no replica and opens no socket; coming back to the foreground is
        // the moment its data is most likely to be stale, so that is when it checks. The check
        // is one cheap query and refetches nothing unless the workspace actually moved.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await model.issues.refreshIfStale() }
        }
    }
}
