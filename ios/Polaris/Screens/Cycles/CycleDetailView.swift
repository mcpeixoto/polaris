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
    /// The schema's defaults: a cycle's issues have always been grouped by status.
    @State private var display = ListDisplay()
    @State private var isEditing = false
    @State private var isConfirmingStart = false

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
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                DisplayOptionsMenu(display: $display, identifier: "cycle.display")
                FavoriteButton(
                    kind: .cycle,
                    targetId: seed.id,
                    name: seed.displayName,
                    identifier: "cycle.favorite"
                )
                menu
            }
        }
        .sheet(isPresented: $isEditing) {
            if let store {
                let current = store.cycle.value ?? seed
                CycleEditView(cycle: current) { change in
                    guard await store.update(change) != nil else { return store.writeError }
                    propagate(store)
                    return nil
                }
            }
        }
        // A confirmation, because `startCycleToday` is the one irreversible thing on this
        // screen: the schema says so, and there is no mutation that puts the dates back.
        .confirmationDialog(
            "Start this cycle today?",
            isPresented: $isConfirmingStart,
            titleVisibility: .visible
        ) {
            Button("Start today") {
                Task {
                    guard let store, await store.startToday() != nil else { return }
                    propagate(store)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It will run from today, for as long as it was scheduled for. This cannot be undone.")
        }
        .task {
            if store == nil {
                let created = CycleStore(api: model.api, cycle: seed)
                model.adopt(&created.onUnauthorized)
                // A status set on the detail screen this list opens, or on any other list
                // holding the same row, lands here too.
                model.observeIssueWrites(created)
                store = created
            }
            await store?.load()
        }
        // The cycle store has no optimistic write, so a row mid-change is showing a spinner
        // over the old status; a reload would land the old status as if it were news.
        .refreshOnRealtime(isSuspended: !pendingIDs.isEmpty) { await store?.load() }
    }

    /// Everything that can be done to the cycle rather than to its list.
    ///
    /// "Start today" is offered only while the cycle is upcoming: the mutation pulls *the next
    /// upcoming cycle* forward, so on a running or finished one it is an action that can only
    /// be refused. A menu item that always fails is worse than no menu item.
    private var menu: some View {
        let current = store?.cycle.value ?? seed
        return Menu {
            Button {
                isEditing = true
            } label: {
                Label("Edit cycle", systemImage: "pencil")
            }
            .accessibilityIdentifier("cycle.edit")

            if current.isUpcoming() {
                Button {
                    isConfirmingStart = true
                } label: {
                    Label("Start today", systemImage: "play.circle")
                }
                .accessibilityIdentifier("cycle.startToday")
            }
        } label: {
            Image(systemName: "ellipsis")
        }
        .tint(Theme.textSecondary)
        .accessibilityLabel(Text("Cycle actions"))
        .accessibilityIdentifier("cycle.menu")
    }

    /// The edited cycle into the team's own list, which the cycles screen behind this one is
    /// holding and does not refetch on the way back.
    private func propagate(_ store: CycleStore) {
        guard let updated = store.cycle.value else { return }
        TeamWorkStores.shared.apply(updated)
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
                display: display,
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
            model.issueDidChange(updated, from: store)
        } catch {
            writeError = PolarisError.mapped(error)
        }
    }
}
