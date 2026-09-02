import SwiftUI
import PolarisCore

/// Search, over the server's own `search` query.
///
/// Nothing in the app was `.searchable` before this, though the schema has had `search` since
/// the first milestone and the web client uses it. Client-side filtering of the loaded list
/// would have been cheaper and would also have been a different feature: it can only find the
/// forty issues assigned to you, and it cannot look inside a description.
///
/// Debouncing and the stale-response guard live in `SearchStore`, not here — a `.searchable`
/// field fires on every keystroke, and the answer to "pol" can arrive after the answer to
/// "polaris".
struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var store: SearchStore?
    @State private var text = ""

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let store {
                content(store: store)
            } else {
                LoadingView(label: String(localized: "Opening search"))
            }
        }
        .navigationTitle(Text("Search"))
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .searchable(
            text: $text,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text("Search issues")
        )
        .onChange(of: text) { _, updated in store?.query(updated) }
        .onSubmit(of: .search) {
            Task { await store?.submit(text) }
        }
        .task {
            guard store == nil else { return }
            let created = SearchStore(api: model.api)
            model.adopt(&created.onUnauthorized)
            store = created
        }
    }

    @ViewBuilder
    private func content(store: SearchStore) -> some View {
        switch store.results {
        case .idle:
            EmptyStateView(
                symbol: "magnifyingglass",
                title: String(localized: "Search this workspace"),
                message: String(localized: "Looks inside issue titles and descriptions, across every team you can see.")
            )
            .padding(Theme.Space.xl)
            .readableColumn()

        case .loading:
            VStack {
                SkeletonIssueList()
                Spacer(minLength: 0)
            }
            .padding(.top, Theme.Space.sm)
            .readableColumn()

        case .failed(let error):
            ErrorStateView(error: error) {
                Task { await store.submit(store.lastQuery) }
            }
            .readableColumn()

        case .loaded(let results) where results.issues.isEmpty:
            EmptyStateView(
                symbol: "questionmark.folder",
                title: String(localized: "No matches"),
                message: String(localized: "Nothing matched “\(store.lastQuery)”. Try fewer words, or a different team's vocabulary.")
            )
            .padding(Theme.Space.xl)
            .readableColumn()

        case .loaded(let results):
            VStack(spacing: 0) {
                if results.issueCount > results.issues.count {
                    // The server caps the response; saying so is the difference between "these
                    // are the matches" and "these are the first forty".
                    MonoEyebrow(
                        text: String(localized: "Showing \(results.issues.count) of \(results.issueCount)")
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Space.xl)
                    .padding(.bottom, Theme.Space.sm)
                    .readableColumn()
                }
                IssueListView(
                    issues: results.issues,
                    statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                    // Routed through the shared issue store, so a result row that is also in
                    // My Issues does not end up with two different statuses in two lists.
                    setState: { issue, state in
                        Task { await model.issues.setState(issueID: issue.id, to: state) }
                    }
                )
                .readableColumn()
            }
        }
    }
}
