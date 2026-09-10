import SwiftUI
import PolarisCore

/// One team's issues, cut three ways: what is being worked on, what is waiting, everything.
///
/// The cut is a segmented control under the bar rather than three screens, because the
/// question it answers — "is that in the backlog or not?" — is asked by flicking between them.
/// Each cut is a view over the one list the store holds, so switching costs no request.
struct TeamIssuesView: View {
    let team: Team
    @Environment(AppModel.self) private var model
    @State private var store: TeamWorkStore?
    @State private var kind: TeamListKind
    @State private var isComposing = false

    init(team: Team, kind: TeamListKind = .active) {
        self.team = team
        _kind = State(initialValue: kind)
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker(String(localized: "Show"), selection: $kind) {
                ForEach(TeamListKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Theme.Space.lg)
            .padding(.vertical, Theme.Space.sm)
            .readableColumn()
            .accessibilityIdentifier("team.issues.kind")
            HairlineDivider()
            if let store {
                content(store: store)
            } else {
                VStack {
                    SkeletonIssueList()
                    Spacer(minLength: 0)
                }
                .readableColumn()
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("\(team.key) issues"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { isComposing = true } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel(Text("New issue"))
                .accessibilityIdentifier("team.compose")
            }
        }
        .sheet(isPresented: $isComposing) { ComposeIssueView() }
        .task {
            if store == nil { store = TeamWorkStores.shared.store(for: team, model: model) }
            await store?.load()
        }
    }

    private func issues(in store: TeamWorkStore) -> [Issue] {
        switch kind {
        case .active: store.active
        case .backlog: store.backlog
        case .all: store.all
        }
    }

    @ViewBuilder
    private func content(store: TeamWorkStore) -> some View {
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

        case .loaded:
            let list = issues(in: store)
            if list.isEmpty {
                ScrollView {
                    emptyState
                        .padding(.top, Theme.Space.xxxl)
                        .readableColumn()
                }
                .scrollIndicators(.hidden)
                .refreshable { await store.load() }
            } else {
                VStack(spacing: 0) {
                    // A refused status change, said out loud. The row rolling back on its own
                    // reads as a tap that missed.
                    if let error = store.writeError {
                        InlineErrorLabel(text: error.displayMessage)
                            .padding(.horizontal, Theme.Space.lg)
                            .padding(.bottom, Theme.Space.sm)
                            .readableColumn()
                    }
                    IssueListView(
                        issues: list,
                        grouping: .status,
                        statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                        ensureStates: { await model.workspaceData.ensureStates(forTeam: $0.team.id) },
                        setState: { issue, state in
                            Task { await store.setState(issueID: issue.id, to: state) }
                        }
                    )
                    .readableColumn()
                    .refreshable { await store.load() }
                }
            }
        }
    }

    /// Three different empties, because "nothing active" on a team with a full backlog is not
    /// the same fact as "no issues at all".
    private var emptyState: some View {
        switch kind {
        case .active:
            EmptyStateView(
                symbol: "circle.lefthalf.filled",
                title: String(localized: "Nothing active"),
                message: String(localized: "No issue on \(team.name) is started or waiting to start. The backlog may still have work in it."),
                actionTitle: String(localized: "New issue"),
                action: { isComposing = true }
            )
        case .backlog:
            EmptyStateView(
                symbol: "circle.dotted",
                title: String(localized: "Backlog is empty"),
                message: String(localized: "Nothing on \(team.name) is parked in the backlog."),
                actionTitle: String(localized: "New issue"),
                action: { isComposing = true }
            )
        case .all:
            EmptyStateView(
                symbol: "tray",
                title: String(localized: "No issues"),
                message: String(localized: "\(team.name) has nothing open or closed yet."),
                actionTitle: String(localized: "New issue"),
                action: { isComposing = true }
            )
        }
    }
}
