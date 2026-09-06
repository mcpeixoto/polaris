import SwiftUI
import PolarisCore

struct RootView: View {
    @Environment(AppModel.self) private var model
    /// A device setting, not a workspace one: it must survive sign-out and be readable before
    /// there is a session to read it from.
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .system
    /// Lives here, above the phase switch, so a link that arrives on the welcome screen is
    /// still queued when the shell finally appears.
    @State private var router = DeepLinkRouter()

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
        .environment(router)
        // `polaris://` links, and universal links on the SwiftUI lifecycle. Both land here
        // whatever screen is up; the router holds them until there is a shell to open them in.
        .onOpenURL { url in router.open(url) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { router.open(url) }
        }
        .task {
            // A UI test cannot tap a link in another app, so it hands the URL over on the
            // command line instead and the app treats it exactly like one that arrived late.
            if let url = LaunchOptions.openURL { router.open(url) }
        }
        .onChange(of: model.phase) { _, phase in
            // A signed-out icon still showing "3" is three notifications for an account this
            // phone no longer holds a session for.
            guard case .signedOut = phase, !LaunchOptions.usesFixtures else { return }
            Task { await AppBadge.set(0) }
        }
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
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    @State private var section: AppSection? = .myIssues
    @State private var isComposing = false
    /// One navigation path per tab, owned here rather than inside each stack, so a deep link
    /// can push onto the tab it selects. A stack that owns its own path is a stack nothing
    /// outside it can navigate.
    @State private var paths: [AppSection: NavigationPath] = [:]
    /// A link that named something that is not there. Said once, in an alert, because a tap
    /// on a link that does nothing at all is indistinguishable from an app that is broken.
    @State private var linkFailure: PolarisError?

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
        // The connectivity pill floats over whichever stack is up. It is about the connection,
        // not about a screen, so it is drawn once here rather than once per tab.
        .overlay(alignment: .top) { ConnectionBanner() }
        .animation(Theme.easing(0.25), value: model.realtime.isDegraded)
        .alert(
            String(localized: "Couldn't open that link"),
            isPresented: Binding(get: { linkFailure != nil }, set: { if !$0 { linkFailure = nil } }),
            presenting: linkFailure
        ) { _ in
            Button(String(localized: "OK"), role: .cancel) {}
        } message: { failure in
            Text(failure.displayMessage)
        }
        // The coordinator owns freshness — the socket while it can be had, the poll while it
        // cannot — and it runs only while the app is in front. Telling it about the scene is
        // the shell's whole part in it.
        .onAppear {
            model.realtime.setForeground(scenePhase == .active)
            applyPendingLinks()
        }
        .onChange(of: scenePhase) { _, phase in
            model.realtime.setForeground(phase == .active)
            if phase == .background, !LaunchOptions.usesFixtures {
                BackgroundRefresh.schedule()
            }
        }
        .onChange(of: router.pending.count) { _, count in
            if count > 0 { applyPendingLinks() }
        }
        // The icon badge mirrors the tab badge, whichever path moved it — a signal, a poll,
        // a swipe in the inbox. Not under fixtures: the permission prompt would sit over
        // every UI test as a springboard alert.
        .task {
            guard !LaunchOptions.usesFixtures else { return }
            await AppBadge.requestPermissionIfNeeded()
            await AppBadge.set(model.inbox.unreadCount)
        }
        .onChange(of: model.inbox.unreadCount) { _, count in
            guard !LaunchOptions.usesFixtures else { return }
            Task { await AppBadge.set(count) }
        }
    }

    private func path(for section: AppSection) -> Binding<NavigationPath> {
        Binding(
            get: { paths[section] ?? NavigationPath() },
            set: { paths[section] = $0 }
        )
    }

    // MARK: - Deep links

    private func applyPendingLinks() {
        let links = router.drain()
        guard !links.isEmpty else { return }
        Task {
            // The shell animates in over 0.4s (`RootView`), and an alert presented while its
            // presenter is still transitioning is dropped without a word — the push survives
            // it, the "couldn't open that link" alert did not. Half a second after a tap is
            // imperceptible; a link that silently does nothing is not.
            try? await Task.sleep(for: .milliseconds(500))
            for link in links { await apply(link) }
        }
    }

    /// Selects the tab a link names and pushes what it points at.
    ///
    /// An issue is pushed onto the tab that is already up — the reader was somewhere, and a
    /// back swipe should return them there. A team, the inbox and the search screen are
    /// places of their own, so those select their tab and clear whatever was on it.
    private func apply(_ link: DeepLink) async {
        switch link {
        case .inbox:
            select(.inbox)
        case .myIssues:
            select(.myIssues)
        case .search(let query):
            router.pendingSearchQuery = query
            select(.search)
        case .issue(let reference):
            do {
                push(try await resolve(reference))
            } catch {
                linkFailure = PolarisError.mapped(error)
            }
        case .team(let key, _):
            // The page — triage, cycles, projects — is dropped for now: the team hub is the
            // destination `PolarisNavigation` declares, and it opens on its issues.
            guard let team = await resolveTeam(key: key) else {
                linkFailure = .notFound
                return
            }
            select(.myIssues)
            push(team)
        case .projects:
            // No projects list on this client yet; the nearest place is the issue list, where
            // the team pills are.
            select(.myIssues)
        case .project(let id):
            do {
                if let cached = model.workspaceData.projects.value?.first(where: { $0.id == id }) {
                    push(cached)
                } else {
                    push(try await model.api.project(id: id))
                }
            } catch {
                linkFailure = PolarisError.mapped(error)
            }
        }
    }

    private func select(_ target: AppSection) {
        section = target
        paths[target] = NavigationPath()
    }

    private func push<Value: Hashable>(_ value: Value) {
        let target = section ?? .myIssues
        var path = paths[target] ?? NavigationPath()
        path.append(value)
        paths[target] = path
    }

    private func resolve(_ reference: DeepLink.IssueReference) async throws -> Issue {
        switch reference {
        case .identifier(let identifier): try await model.api.issueByIdentifier(identifier)
        case .id(let id): try await model.api.issue(id: id)
        }
    }

    /// The store first, the network second: the shell appears before `workspaceData` has
    /// answered, so a link that launched the app usually arrives while the teams are still
    /// loading.
    private func resolveTeam(key: String) async -> Team? {
        if let team = model.workspaceData.teams.value?.first(where: { $0.key == key }) {
            return team
        }
        return (try? await model.api.teams())?.first { $0.key == key }
    }

    private var tabs: some View {
        TabView(selection: Binding(get: { section ?? .myIssues }, set: { section = $0 })) {
            ForEach(AppSection.allCases) { item in
                PolarisNavigation(path: path(for: item)) { screen(item) }
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
                    .foregroundStyle(Theme.textPrimary)
                    .badge(item == .inbox ? model.inbox.unreadCount : 0)
                    .tag(item)
                    .accessibilityIdentifier("sidebar.\(item.rawValue)")
            }
            .listStyle(.sidebar)
            // The sidebar is a surface one step up from the page, as it is on the web, and
            // the system's own grouped grey is not a token.
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .navigationTitle(viewer.workspace.name)
            .toolbar {
                ToolbarItem(placement: .primaryAction) { composeButton }
            }
        } detail: {
            PolarisNavigation(path: path(for: section ?? .myIssues)) { screen(section ?? .myIssues) }
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
/// views, which is what lets a deep link push onto `path` rather than reconstruct a view
/// hierarchy. The path is the shell's, not this stack's, for exactly that reason.
struct PolarisNavigation<Content: View>: View {
    @Binding var path: NavigationPath
    @ViewBuilder var content: () -> Content
    /// Declared here because both ends of the zoom transition have to name the same one, and
    /// this is the nearest ancestor of both the row and the screen it opens.
    @Namespace private var issueTransition

    var body: some View {
        NavigationStack(path: $path) {
            content()
                .navigationDestination(for: Issue.self) { issue in
                    IssueDetailView(issue: issue)
                        .issueTransitionDestination(issue.id, in: issueTransition)
                }
                .navigationDestination(for: Team.self) { TeamHubView(team: $0) }
                .navigationDestination(for: Project.self) { ProjectDetailView(project: $0) }
                .navigationDestination(for: Cycle.self) { CycleDetailView(cycle: $0) }
                .navigationDestination(for: TeamListRoute.self) { route in
                    switch route {
                    case .issues(let team, let kind): TeamIssuesView(team: team, kind: kind)
                    case .triage(let team): TriageView(team: team)
                    case .cycles(let team): CyclesView(team: team)
                    case .projects(let team): ProjectsView(team: team)
                    }
                }
        }
        .environment(\.issueTransitionNamespace, issueTransition)
    }
}
