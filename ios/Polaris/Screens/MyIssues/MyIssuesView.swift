import SwiftUI
import PolarisCore

/// Home: what is assigned to you, and the way in to every team's list.
///
/// Content only — the navigation stack, and the issue and team destinations, belong to
/// `PolarisNavigation` so this same view is a tab on a phone and a detail column on an iPad.
/// The bar is the system's, inline, with the two actions as plain toolbar glyphs.
struct MyIssuesView: View {
    @Environment(AppModel.self) private var model
    /// Owned by the shell, because the compose sheet is reachable from the iPad sidebar too.
    @Binding var isComposing: Bool

    var body: some View {
        VStack(spacing: 0) {
            // One line under the bar: the teams on the left, the count on the right.
            HStack(spacing: Theme.Space.md) {
                teamsStrip
                statusLine
            }
            .padding(.horizontal, Theme.Space.lg)
            .padding(.vertical, Theme.Space.sm)
            .readableColumn()
            HairlineDivider()
            content
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("My Issues"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                filterMenu
                Button { isComposing = true } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel(Text("New issue"))
                .accessibilityIdentifier("issues.compose")
            }
        }
    }

    /// How much is open, and whether the list is current.
    private var statusLine: some View {
        HStack(spacing: Theme.Space.sm) {
            Spacer(minLength: 0)
            Text(openCountLabel)
                .font(PolarisText.caption.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .accessibilityAddTraits(.isHeader)
            if model.issues.issues.value != nil, let stale = model.issues.lastRefreshError {
                // The poll failed while a list was on screen. The list stays — blanking what
                // somebody is reading is worse — but it is no longer current, and saying
                // nothing is how a dead session becomes an app that quietly stops updating.
                Text(verbatim: "·").foregroundStyle(Theme.textTertiary)
                Text(stale.isRetryable
                     ? String(localized: "Not up to date")
                     : String(localized: "Refresh failed"))
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.warn)
            }
            if model.issues.isShowingCachedIssues {
                // Said, not hidden. This list came off disk because the first request has
                // not answered yet; claiming it is live would be a lie the reader acts on.
                Text(verbatim: "·").foregroundStyle(Theme.textTertiary)
                Text("Saved copy")
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.warn)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    /// The line says how much work is open, or what went wrong.
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
        }
        .accessibilityLabel(Text("Filter"))
        .accessibilityIdentifier("issues.filter")
    }

    /// Teams, as a row of small pills into each team's own list.
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
                            HStack(spacing: Theme.Space.xs + 2) {
                                Circle()
                                    .fill(Theme.hex(team.color))
                                    .frame(width: 7, height: 7)
                                Text(team.key)
                                    .font(.system(.footnote).weight(.medium))
                                    .foregroundStyle(Theme.textPrimary)
                            }
                            .padding(.horizontal, Theme.Space.sm + 2)
                            .frame(minHeight: 28)
                            .background(Theme.raised)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel(Text("\(team.name) issues"))
                        .accessibilityIdentifier("team.chip.\(team.key)")
                    }
                }
            }
            .scrollIndicators(.hidden)
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
                .padding(.top, Theme.Space.xxxl)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.issues.load() }

        case .loaded(let issues):
            // Flat, in priority order — Linear's own default for My Issues. Status groups
            // are for a team's list, where the question is "where is everything", not "what
            // do I do next".
            IssueListView(
                issues: issues,
                pendingIDs: model.issues.pendingIssueIDs,
                grouping: .none,
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

/// One team's issues — the other end of the pills above — grouped by status.
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
            .readableColumn()

        case .loaded(let issues):
            IssueListView(
                issues: issues,
                grouping: .status,
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
