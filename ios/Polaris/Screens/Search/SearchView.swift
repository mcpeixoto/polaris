import SwiftUI
import PolarisCore

/// Search, over the server's own `search` query.
///
/// Nothing in the app was `.searchable` before this, though the schema has had `search` since
/// the first milestone and the web client uses it. Client-side filtering of the loaded list
/// would have been cheaper and would also have been a different feature: it can only find the
/// forty issues assigned to you, and it cannot look inside a description.
///
/// The team chips and the two quick filters narrow the query on the server, through the
/// filter grammar the web client uses (`IssueFilter`), so the count the caption reports is
/// the count of what matched, not of what the phone kept.
struct SearchView: View {
    @Environment(AppModel.self) private var model
    /// For `polaris://search?q=…` only: the link selects this tab and parks its query, and
    /// this screen is the one place that takes it.
    @Environment(DeepLinkRouter.self) private var router
    @State private var session: SearchStore?
    @State private var text = ""
    @State private var teamId: String?
    @State private var assignedToMe = false
    @State private var openOnly = false
    /// No `UserDefaults` in the fixture app, for the reason `InMemoryIssueCache` exists.
    @State private var recents = RecentSearches(defaults: LaunchOptions.usesFixtures ? nil : .standard)

    private var teams: [Team] { model.workspaceData.teams.value ?? [] }

    /// The filter AST for the quick filters, or nil when neither is on — an empty `and` is a
    /// clause the server would have to evaluate for nothing.
    private var filter: JSONValue? {
        var nodes: [JSONValue] = []
        if assignedToMe, let me = model.currentUser { nodes.append(IssueFilter.assignedTo(me.id)) }
        if openOnly { nodes.append(IssueFilter.openOnly) }
        return nodes.isEmpty ? nil : IssueFilter.and(nodes)
    }

    var body: some View {
        VStack(spacing: 0) {
            filterRow
                .readableColumn()
            HairlineDivider()
            ZStack {
                Theme.background.ignoresSafeArea()
                if let session {
                    content(session: session)
                } else {
                    LoadingView(label: String(localized: "Opening search"))
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Search"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
            text: $text,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text("Search issues")
        )
        .onChange(of: text) { _, updated in session?.query(updated, teamId: teamId, filter: filter) }
        // A changed chip re-runs the query at once: the reader is looking at results and
        // just said they want different ones.
        .onChange(of: teamId) { _, _ in resubmit() }
        .onChange(of: assignedToMe) { _, _ in resubmit() }
        .onChange(of: openOnly) { _, _ in resubmit() }
        .onSubmit(of: .search) { submit(text) }
        // Results are a query answered at a moment in time, so a signal re-runs the last one
        // rather than leaving a list somebody is reading two edits behind.
        .refreshOnRealtime { await session?.refresh(teamId: teamId, filter: filter) }
        .task {
            if session == nil {
                let created = SearchStore(api: model.api)
                model.adopt(&created.onUnauthorized)
                // A result row's status change is written here, and the confirmed issue goes
                // back out to every other list holding the same row.
                model.adoptIssueWrites(created)
                session = created
            }
            runPendingLinkQuery()
        }
        // A second link while the tab is already up: the screen is on screen, so nothing else
        // would notice the query change.
        .onChange(of: router.pendingSearchQuery) { _, _ in runPendingLinkQuery() }
    }

    /// Takes the query a `search` deep link parked, if there is one, and runs it.
    ///
    /// Taken rather than read: the router is left clean, so the next link is a change the
    /// screen can see, and coming back to this tab later does not re-run a search from a link
    /// tapped an hour ago.
    private func runPendingLinkQuery() {
        guard let query = router.takePendingSearchQuery() else { return }
        text = query
        submit(query)
    }

    /// Which team, and the two quick filters, as one row of chips under the field.
    private var filterRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Theme.Space.sm) {
                chip(String(localized: "All teams"), isOn: teamId == nil, identifier: "search.team.all") {
                    teamId = nil
                }
                ForEach(teams) { team in
                    chip(team.key, isOn: teamId == team.id, identifier: "search.team.\(team.key)", dot: Theme.hex(team.color)) {
                        teamId = teamId == team.id ? nil : team.id
                    }
                }
                Rectangle()
                    .fill(Theme.border)
                    .frame(width: 1, height: 16)
                chip(String(localized: "Assigned to me"), isOn: assignedToMe, identifier: "search.assignedToMe") {
                    assignedToMe.toggle()
                }
                chip(String(localized: "Open only"), isOn: openOnly, identifier: "search.openOnly") {
                    openOnly.toggle()
                }
            }
            .padding(.horizontal, Theme.Space.lg)
            .padding(.vertical, Theme.Space.sm)
        }
        .scrollIndicators(.hidden)
    }

    private func chip(
        _ title: String,
        isOn: Bool,
        identifier: String,
        dot: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: Theme.Space.xs + 2) {
                if let dot {
                    Circle().fill(dot).frame(width: 7, height: 7)
                }
                Text(title)
                    .font(.system(.footnote).weight(.medium))
                    .foregroundStyle(isOn ? Theme.accentBright : Theme.textSecondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, Theme.Space.sm + 2)
            .frame(minHeight: 28)
            .background(isOn ? Theme.accentTint : Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(isOn ? Theme.accent : Theme.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder
    private func content(session: SearchStore) -> some View {
        switch session.results {
        case .idle:
            if recents.items.isEmpty {
                EmptyStateView(
                    symbol: "magnifyingglass",
                    title: String(localized: "Search this workspace"),
                    message: String(localized: "Looks inside issue titles and descriptions, across every team you can see.")
                )
                .readableColumn()
            } else {
                recentList
                    .readableColumn()
            }

        case .loading:
            VStack {
                SkeletonIssueList()
                Spacer(minLength: 0)
            }
            .readableColumn()

        case .failed(let error):
            ErrorStateView(error: error) {
                submit(session.lastQuery)
            }
            .readableColumn()

        case .loaded(let results) where results.issues.isEmpty:
            EmptyStateView(
                symbol: "questionmark.folder",
                title: String(localized: "No matches"),
                message: String(localized: "Nothing matched “\(session.lastQuery)”. Try fewer words, or a different team's vocabulary.")
            )
            .readableColumn()

        case .loaded(let results):
            VStack(spacing: 0) {
                // How many matched, and — because the server caps the response — how many of
                // them are here. "Showing 40 of 400" is the difference between "these are the
                // matches" and "these are the first forty".
                Text(countCaption(results))
                    .font(PolarisText.caption.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.vertical, Theme.Space.sm)
                    .readableColumn()
                    .accessibilityIdentifier("search.count")
                // A refused status change, said out loud. The row rolling back on its own
                // reads as a tap that missed.
                if let error = session.writeError {
                    InlineErrorLabel(text: error.displayMessage)
                        .padding(.horizontal, Theme.Space.lg)
                        .padding(.bottom, Theme.Space.sm)
                        .readableColumn()
                }
                IssueListView(
                    issues: results.issues,
                    pendingIDs: session.pendingIssueIDs,
                    grouping: .status,
                    statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                    ensureStates: { await model.workspaceData.ensureStates(forTeam: $0.team.id) },
                    // To the store that holds this row. It went to `model.issues` before,
                    // which holds the reader's own issues and almost never a search result —
                    // so the write was dropped by a guard and the tap did nothing at all.
                    setState: { issue, state in
                        Task { await session.setState(issueID: issue.id, to: state) }
                    }
                )
                .readableColumn()
            }
        }
    }

    /// What was searched for lately, each a tap from being searched for again.
    private var recentList: some View {
        List {
            Section {
                ForEach(recents.items, id: \.self) { query in
                    Button {
                        text = query
                        submit(query)
                    } label: {
                        HStack(spacing: Theme.Space.sm + 2) {
                            Image(systemName: "clock.arrow.circlepath")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textTertiary)
                            Text(query)
                                .font(PolarisText.rowTitle)
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Theme.hairline)
                    .listRowInsets(EdgeInsets(top: 0, leading: Theme.Space.lg, bottom: 0, trailing: Theme.Space.lg))
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            recents.remove(query)
                        } label: {
                            SwiftUI.Label("Remove", systemImage: "trash")
                        }
                    }
                    .accessibilityIdentifier("search.recent.\(query)")
                }
            } header: {
                HStack {
                    Text("Recent")
                        .font(PolarisText.sectionTitle)
                        .foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 0)
                    Button {
                        withAnimation(Theme.easing(0.25)) { recents.clear() }
                    } label: {
                        Text("Clear")
                            .font(PolarisText.caption)
                            .foregroundStyle(Theme.accentBright)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("search.recentClear")
                }
                .padding(.horizontal, Theme.Space.lg)
                .frame(minHeight: 30)
                .background(Theme.raised)
                .textCase(nil)
                .listRowInsets(EdgeInsets())
            }
        }
        .listStyle(.plain)
        .listSectionSeparator(.hidden)
        .listSectionSpacing(0)
        .contentMargins(.top, 0, for: .scrollContent)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
        .environment(\.defaultMinListRowHeight, Theme.rowHeight)
    }

    private func countCaption(_ results: SearchResults) -> String {
        if results.issueCount > results.issues.count {
            return String(localized: "Showing \(results.issues.count) of \(results.issueCount)")
        }
        return results.issueCount == 1
            ? String(localized: "1 result")
            : String(localized: "\(results.issueCount) results")
    }

    /// The return key, a recent row, and the retry button. A search the reader asked for by
    /// name is one worth remembering; the debounced keystroke ones are not.
    private func submit(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        recents.remember(trimmed)
        Task { await session?.submit(trimmed, teamId: teamId, filter: filter) }
    }

    private func resubmit() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Task { await session?.submit(trimmed, teamId: teamId, filter: filter) }
    }
}
