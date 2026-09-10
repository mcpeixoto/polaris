import SwiftUI
import PolarisCore

/// One cycle: when it runs, how far it is, and the issues in it grouped by status.
///
/// Its own `CycleStore` rather than the team's, because a cycle can be reached from an
/// issue's property pill as well as from the team, and the first of those has no team list
/// behind it.
struct CycleDetailView: View {
    @Environment(AppModel.self) private var model
    @State private var store: CycleStore?
    @State private var writeError: PolarisError?
    @State private var pendingIDs: Set<String> = []

    private let seed: Cycle

    init(cycle: Cycle) {
        self.seed = cycle
    }

    var body: some View {
        VStack(spacing: 0) {
            if let store {
                header(store: store)
                    .readableColumn()
                HairlineDivider()
                list(store: store)
            } else {
                LoadingView(label: String(localized: "Loading cycle"))
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Cycle \(seed.number)"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if store == nil {
                let created = CycleStore(api: model.api, cycle: seed)
                model.adopt(&created.onUnauthorized)
                store = created
            }
            await store?.load()
        }
    }

    private func header(store: CycleStore) -> some View {
        let cycle = store.cycle.value ?? seed
        let progress = store.progress
        return VStack(alignment: .leading, spacing: Theme.Space.sm) {
            HStack(spacing: Theme.Space.sm) {
                CycleRing(percent: progress.percent, size: 18)
                Text(cycle.displayName)
                    .font(PolarisText.issueTitle)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: Theme.Space.sm)
                Text(timing(store: store, cycle: cycle))
                    .font(PolarisText.caption)
                    .foregroundStyle(cycle.isActive() ? Theme.accentBright : Theme.textSecondary)
                    .accessibilityIdentifier("cycle.timing")
            }
            if let description = cycle.description, !description.isEmpty {
                Text(description)
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
            HStack(spacing: Theme.Space.sm) {
                WorkProgressBar(progress: progress)
                Text("\(progress.percent)%")
                    .font(PolarisText.rowMeta)
                    .foregroundStyle(Theme.textSecondary)
            }
            HStack(spacing: Theme.Space.xs + 2) {
                Text(PlanningDates.range(cycle.startsAt, cycle.endsAt))
                Text(verbatim: "·")
                Text("\(progress.completed) of \(progress.total) done")
                if progress.started > 0 {
                    Text(verbatim: "·")
                    Text("\(progress.started) started")
                }
            }
            .font(PolarisText.captionSmall.monospacedDigit())
            .foregroundStyle(Theme.textTertiary)
            if let writeError {
                InlineErrorLabel(text: writeError.displayMessage)
            }
        }
        .padding(.horizontal, Theme.Space.lg)
        .padding(.vertical, Theme.Space.md)
    }

    /// The store's count for a running cycle — the one the header is about — and the
    /// bucketing helper's words for every other case.
    private func timing(store: CycleStore, cycle: Cycle) -> String {
        guard cycle.isActive() else { return CycleBuckets.timing(cycle) }
        return CycleBuckets.daysLeft(store.daysRemaining())
    }

    @ViewBuilder
    private func list(store: CycleStore) -> some View {
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
            ScrollView {
                EmptyStateView(
                    symbol: "tray",
                    title: String(localized: "Nothing in this cycle"),
                    message: String(localized: "No issue has been scheduled into it yet.")
                )
                .padding(.top, Theme.Space.xxl)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await store.load() }

        case .loaded(let issues):
            IssueListView(
                issues: issues,
                pendingIDs: pendingIDs,
                grouping: .status,
                statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                ensureStates: { await model.workspaceData.ensureStates(forTeam: $0.team.id) },
                setState: { issue, state in
                    Task { await setState(issue, to: state, store: store) }
                }
            )
            .readableColumn()
            .refreshable { await store.load() }
        }
    }

    /// The cycle store has no optimistic write of its own, so the row shows a spinner until
    /// the server answers and the answer is merged into both this list and My Issues.
    private func setState(_ issue: Issue, to state: WorkflowState, store: CycleStore) async {
        writeError = nil
        pendingIDs.insert(issue.id)
        defer { pendingIDs.remove(issue.id) }
        do {
            let updated = try await model.api.updateIssue(IssueChange(id: issue.id, stateId: state.id))
            store.merge(updated)
            model.issues.merge(updated)
        } catch {
            writeError = PolarisError.mapped(error)
        }
    }
}
