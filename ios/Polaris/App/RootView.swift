import SwiftUI
import PolarisCore

struct RootView: View {
    @Environment(AppModel.self) private var model
    /// A device setting, not a workspace one: it must survive sign-out and be readable before
    /// there is a session to read it from.
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .system

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            switch model.phase {
            case .launching:
                LoadingView(label: String(localized: "Opening Polaris"))
            case .signedOut(let error):
                WelcomeView(error: error)
            case .needsWorkspace:
                NavigationStack { CreateWorkspaceView() }
            case .ready(let viewer):
                SignedInShell(viewer: viewer)
            }
        }
        // Was pinned to `.dark`. Two costs: the web client ships light, dark and system, so
        // the two clients disagreed about what Polaris looks like; and LaunchBackground's
        // light appearance was pure white, so every cold start on a phone in Light mode
        // flashed white and snapped to a near-black app. Both are fixed — the palette is
        // semantic now (Theme/Palette) and the launch colour follows it.
        .preferredColorScheme(appearance.colorScheme)
        // One curve for the whole shell, so a sign-in does not cut to the issue list.
        .animation(Theme.easing(0.4), value: model.phase)
    }
}

/// The four places a signed-in reader can be.
///
/// `docs/01-features/19-clients-sync-preferences.md` names five tabs — Home, Inbox, Create,
/// Search, Settings. Create is the one deliberate divergence: it is a sheet from the list's
/// toolbar rather than a tab, because a tab that opens a modal and never shows a screen of its
/// own is a tab you cannot go back to.
enum AppSection: String, CaseIterable, Identifiable {
    case inbox
    case myIssues
    case search
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .inbox: String(localized: "Inbox")
        case .myIssues: String(localized: "My Issues")
        case .search: String(localized: "Search")
        case .settings: String(localized: "Settings")
        }
    }

    var symbolName: String {
        switch self {
        case .inbox: "tray"
        case .myIssues: "checklist"
        case .search: "magnifyingglass"
        case .settings: "gearshape"
        }
    }
}

/// Tabs on a phone, a sidebar and a detail column on an iPad.
///
/// `TARGETED_DEVICE_FAMILY` has included iPad since the first build and nothing was designed
/// for it: a 1024pt-wide issue row holding a 40-character title is what an unconstrained
/// `TabView` of `NavigationStack`s produces. Regular width gets the split view the platform
/// expects, and every screen additionally caps itself with `.readableColumn()`.
struct SignedInShell: View {
    let viewer: Viewer
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    @State private var section: AppSection? = .myIssues
    @State private var isComposing = false

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                splitView
            } else {
                tabs
            }
        }
        .tint(Theme.accentBright)
        .sheet(isPresented: $isComposing) { ComposeIssueView() }
        // This client holds no replica and opens no socket; coming back to the foreground is
        // the moment its data is most likely to be stale, so that is when it checks. The check
        // is one cheap query and refetches nothing unless the workspace actually moved.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await model.issues.refreshIfStale()
                await model.inbox.refreshBadge()
            }
        }
        // The freshness poll `IssuesStore.refreshIfStale` documented and nothing ever ran.
        // Without it the app is entirely static while open — leave it an hour and it still
        // shows the list it launched with. One `syncVersion` query per tick, and a refetch
        // only when the number moved.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                await model.issues.refreshIfStale()
                await model.inbox.refreshBadge()
            }
        }
    }

    private var tabs: some View {
        TabView(selection: Binding(get: { section ?? .myIssues }, set: { section = $0 })) {
            ForEach(AppSection.allCases) { item in
                PolarisNavigation { screen(item) }
                    .tabItem { SwiftUI.Label(item.title, systemImage: item.symbolName) }
                    .badge(item == .inbox ? model.inbox.unreadCount : 0)
                    .tag(item)
                    .accessibilityIdentifier("tab.\(item.rawValue)")
            }
        }
    }

    private var splitView: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $section) { item in
                SwiftUI.Label(item.title, systemImage: item.symbolName)
                    .badge(item == .inbox ? model.inbox.unreadCount : 0)
                    .tag(item)
            }
            .navigationTitle(viewer.workspace.name)
            .toolbar {
                ToolbarItem(placement: .primaryAction) { composeButton }
            }
        } detail: {
            PolarisNavigation { screen(section ?? .myIssues) }
        }
    }

    private var composeButton: some View {
        Button { isComposing = true } label: {
            Image(systemName: "square.and.pencil")
        }
        .accessibilityLabel(Text("New issue"))
        .accessibilityIdentifier("issues.compose")
    }

    @ViewBuilder
    private func screen(_ section: AppSection) -> some View {
        switch section {
        case .inbox: InboxView()
        case .myIssues: MyIssuesView(isComposing: $isComposing)
        case .search: SearchView()
        case .settings: SettingsView(viewer: viewer)
        }
    }
}

/// The navigation stack every screen is pushed into, and the one place issue and team
/// destinations are declared.
///
/// Screens are content only — none of them wraps itself in a `NavigationStack` — so the same
/// view renders as a tab on a phone and as the detail column of a split view on an iPad
/// without knowing which it is in. Rows push values (`NavigationLink(value:)`) rather than
/// views, which is also what lets a deep link one day set a path rather than reconstruct a
/// view hierarchy.
struct PolarisNavigation<Content: View>: View {
    @ViewBuilder var content: () -> Content
    /// Declared here because both ends of the zoom transition have to name the same one, and
    /// this is the nearest ancestor of both the row and the screen it opens.
    @Namespace private var issueTransition

    var body: some View {
        NavigationStack {
            content()
                .navigationDestination(for: Issue.self) { issue in
                    IssueDetailView(issue: issue)
                        .issueTransitionDestination(issue.id, in: issueTransition)
                }
                .navigationDestination(for: Team.self) { TeamIssuesView(team: $0) }
        }
        .environment(\.issueTransitionNamespace, issueTransition)
    }
}
