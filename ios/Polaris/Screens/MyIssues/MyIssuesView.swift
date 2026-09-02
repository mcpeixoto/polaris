import SwiftUI
import PolarisCore

/// Home: what is assigned to you, and the way in to every team's list.
///
/// Content only — the navigation stack, and the issue and team destinations, belong to
/// `PolarisNavigation` so this same view is a tab on a phone and a detail column on an iPad.
struct MyIssuesView: View {
    @Environment(AppModel.self) private var model
    /// Owned by the shell, because the compose sheet is reachable from the iPad sidebar too.
    @Binding var isComposing: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, Theme.Space.xl)
                .padding(.top, Theme.Space.sm)
                .readableColumn()
            teamsStrip
            content
        }
        .background(Theme.background.ignoresSafeArea())
        // Every screen draws its own header, so the system bar would only add a second,
        // emptier one above it.
        .toolbar(.hidden, for: .navigationBar)
    }

    /// Eyebrow over title, with the trailing actions as tinted circles — the same shape on
    /// every screen, so the eye learns where to look once.
    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: Theme.Space.sm) {
                MonoEyebrow(text: openCountLabel)
                if model.issues.issues.value != nil, let stale = model.issues.lastRefreshError {
                    // The poll failed while a list was on screen. The list stays — blanking
                    // what somebody is reading is worse — but it is no longer current, and
                    // saying nothing is how a dead session becomes an app that quietly stops
                    // updating.
                    MonoEyebrow(
                        text: stale.isRetryable
                            ? String(localized: "Not up to date")
                            : String(localized: "Refresh failed"),
                        color: Theme.warn
                    )
                }
                if model.issues.isShowingCachedIssues {
                    // Said, not hidden. This list came off disk because the first request has
                    // not answered yet; claiming it is live would be a lie the reader acts on.
                    MonoEyebrow(text: String(localized: "Saved copy"), color: Theme.warn)
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .center) {
                Text("My Issues")
                    .displayFont(30, weight: .bold)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                filterMenu
                Button { isComposing = true } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.accentBright)
                        .frame(width: 38, height: 38)
                        .background(Theme.accentTint)
                        .clipShape(Circle())
                        .hitTarget()
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(Text("New issue"))
                .accessibilityIdentifier("issues.compose")
            }
        }
    }

    /// The eyebrow says how much work is open, or what went wrong.
    ///
    /// It used to print "Offline" for every failure — a 403, a decoding failure and a rate
    /// limit all read as a lost connection, while the body below correctly printed a different
    /// sentence. Two statements about the same failure, on the same screen, disagreeing.
    private var openCountLabel: String {
        if case .failed(let error) = model.issues.issues {
            return error.isRetryable
                ? String(localized: "Can't reach Polaris")
                : String(localized: "Error")
        }
        guard let issues = model.issues.issues.value else { return String(localized: "Loading") }
        let open = issues.filter { $0.state.category.isOpen }.count
        return String(localized: "\(open) open")
    }

    private var filterMenu: some View {
        Menu {
            Toggle(
                isOn: Binding(
                    get: { model.issues.includeCompleted },
                    set: { newValue in
                        Task { await model.issues.setIncludeCompleted(newValue) }
                    }
                )
            ) {
                Text("Show completed")
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 38, height: 38)
                .background(Theme.chipInactive)
                .clipShape(Circle())
                .hitTarget()
        }
        .accessibilityLabel(Text("Filter"))
        .accessibilityIdentifier("issues.filter")
    }

    /// Teams, as a row of chips into each team's own list.
    ///
    /// `PolarisAPI.issues(teamId:)` was implemented on both clients and reachable from no
    /// screen at all; the only list in the app was "assigned to me". The spec's Home tab is a
    /// hierarchy over teams, and this is its first rung.
    @ViewBuilder
    private var teamsStrip: some View {
        if let teams = model.workspaceData.teams.value, !teams.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: Theme.Space.sm) {
                    ForEach(teams) { team in
                        NavigationLink(value: team) {
                            HStack(spacing: Theme.Space.xs) {
                                Circle()
                                    .fill(Theme.hex(team.color))
                                    .frame(width: 6, height: 6)
                                Text(team.key)
                                    .monoFont(11, weight: .medium)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            .padding(.horizontal, Theme.Space.md)
                            .padding(.vertical, Theme.Space.sm)
                            .background(Capsule().fill(Theme.chipInactive))
                            .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel(Text("\(team.name) issues"))
                        .accessibilityIdentifier("team.chip.\(team.key)")
                    }
                }
                .padding(.horizontal, Theme.Space.xl)
                .padding(.vertical, Theme.Space.md)
            }
            .scrollIndicators(.hidden)
            .readableColumn()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.issues.issues {
        case .idle, .loading:
            // Skeleton rows rather than a centred spinner: the layout the reader is about to
            // get is already on screen, so nothing jumps when the answer arrives.
            SkeletonIssueList()
                .readableColumn()
                .padding(.top, Theme.Space.sm)
            Spacer(minLength: 0)

        case .failed(let error):
            ErrorStateView(error: error) {
                Task { await model.issues.load() }
            }
            .readableColumn()

        case .loaded(let issues) where issues.isEmpty:
            ScrollView {
                // Two different empties. With completed work hidden the list may not be empty
                // at all, so claiming "nothing assigned" would be false; with the filter
                // already on, pointing at the filter would be useless.
                EmptyStateView(
                    symbol: model.issues.includeCompleted ? "tray" : "checkmark.circle",
                    title: model.issues.includeCompleted
                        ? String(localized: "Nothing assigned to you")
                        : String(localized: "Nothing open"),
                    message: model.issues.includeCompleted
                        ? String(localized: "No issues are assigned to you in this workspace yet.")
                        : String(localized: "Nothing open is assigned to you. Anything you have finished is hidden — show completed from the filter above."),
                    actionTitle: String(localized: "New issue"),
                    action: { isComposing = true }
                )
                .padding(.horizontal, Theme.Space.xl)
                .padding(.top, Theme.Space.md)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.issues.load() }

        case .loaded(let issues):
            IssueListView(
                issues: issues,
                pendingIDs: model.issues.pendingIssueIDs,
                statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                setState: { issue, state in
                    Task { await model.issues.setState(issueID: issue.id, to: state) }
                }
            )
            .readableColumn()
            .refreshable { await model.issues.load() }
        }
    }
}

/// One team's issues — the other end of the chips above.
struct TeamIssuesView: View {
    let team: Team
    @Environment(AppModel.self) private var model
    @State private var store: TeamIssuesStore?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let store {
                content(store: store)
            } else {
                LoadingView(label: String(localized: "Loading issues"))
            }
        }
        .navigationTitle(team.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            if store == nil {
                let created = TeamIssuesStore(api: model.api, team: team)
                model.adopt(&created.onUnauthorized)
                store = created
            }
            await store?.load()
        }
    }

    @ViewBuilder
    private func content(store: TeamIssuesStore) -> some View {
        switch store.issues {
        case .idle, .loading:
            VStack {
                SkeletonIssueList()
                Spacer(minLength: 0)
            }
            .readableColumn()

        case .failed(let error):
            ErrorStateView(error: error) { Task { await store.load() } }
                .readableColumn()

        case .loaded(let issues) where issues.isEmpty:
            EmptyStateView(
                symbol: "tray",
                title: String(localized: "No issues"),
                message: String(localized: "This team has nothing open or closed yet.")
            )
            .padding(Theme.Space.xl)
            .readableColumn()

        case .loaded(let issues):
            IssueListView(
                issues: issues,
                statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                setState: { issue, state in
                    Task { await store.setState(issueID: issue.id, to: state) }
                }
            )
            .readableColumn()
            .refreshable { await store.load() }
        }
    }
}
