import SwiftUI
import PolarisCore

/// A team's cycles: the one running, the ones queued, the ones done, each with how far
/// along it is. Progress is computed here from the team's own list — there is no cycle
/// issue query, which is the trade `TeamWorkStore`'s header explains.
struct CyclesView: View {
    let team: Team
    @Environment(AppModel.self) private var model
    @State private var store: TeamWorkStore?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let store {
                content(store: store)
            } else {
                LoadingView(label: String(localized: "Loading cycles"))
            }
        }
        .navigationTitle(Text("Cycles"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if store == nil { store = TeamWorkStores.shared.store(for: team, model: model) }
            await store?.load()
        }
    }

    @ViewBuilder
    private func content(store: TeamWorkStore) -> some View {
        switch store.cycles {
        case .idle, .loading:
            LoadingView(label: String(localized: "Loading cycles"))

        case .failed(let error):
            ErrorStateView(error: error) { Task { await store.load() } }
                .readableColumn()

        case .loaded(let cycles) where cycles.isEmpty:
            ScrollView {
                EmptyStateView(
                    symbol: "arrow.trianglehead.2.clockwise.rotate.90",
                    title: String(localized: "No cycles"),
                    message: String(localized: "\(team.name) runs cycles, but none have been created yet.")
                )
                .padding(.top, Theme.Space.xxxl)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await store.load() }

        case .loaded(let cycles):
            let buckets = CycleBuckets.bucket(cycles)
            List {
                section(String(localized: "Active"), buckets.active, store: store)
                section(String(localized: "Upcoming"), buckets.upcoming, store: store)
                section(String(localized: "Past"), buckets.past, store: store)
            }
            .listStyle(.plain)
            .listSectionSeparator(.hidden)
            .listSectionSpacing(0)
            .contentMargins(.top, 0, for: .scrollContent)
            .scrollContentBackground(.hidden)
            .scrollIndicators(.hidden)
            .readableColumn()
            .refreshable { await store.load() }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ cycles: [Cycle], store: TeamWorkStore) -> some View {
        if !cycles.isEmpty {
            Section {
                ForEach(cycles) { cycle in
                    CycleRow(cycle: cycle, progress: WorkProgress(issues: store.issues(inCycle: cycle.id)))
                        // On the row, and before the link goes behind it: applied after, the
                        // identifier lands on the hidden link too and a query finds two.
                        .accessibilityIdentifier("cycle.row.\(cycle.id)")
                        .background(NavigationLink(value: cycle) { EmptyView() }.opacity(0))
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Theme.hairline)
                        .listRowInsets(EdgeInsets(
                            top: 0, leading: Theme.Space.lg,
                            bottom: 0, trailing: Theme.Space.lg
                        ))
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                }
            } header: {
                PlanningSectionHeader(title: title, count: cycles.count, identifier: "cycles.section.\(title)")
            }
        }
    }
}

/// One cycle on two and a half lines: its name and count, its bar, its dates and how long
/// it has left.
struct CycleRow: View {
    let cycle: Cycle
    let progress: WorkProgress

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs + 2) {
            HStack(spacing: Theme.Space.sm) {
                CycleRing(percent: progress.percent)
                Text(cycle.displayName)
                    .font(PolarisText.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if !cycle.name.isEmpty {
                    Text("Cycle \(cycle.number)")
                        .font(PolarisText.rowMeta)
                        .foregroundStyle(Theme.textTertiary)
                }
                Spacer(minLength: Theme.Space.sm)
                Text(progress.total == 1 ? String(localized: "1 issue") : String(localized: "\(progress.total) issues"))
                    .font(PolarisText.rowMeta)
                    .foregroundStyle(Theme.textSecondary)
            }
            WorkProgressBar(progress: progress)
            HStack {
                Text(PlanningDates.range(cycle.startsAt, cycle.endsAt))
                    .font(PolarisText.captionSmall.monospacedDigit())
                    .foregroundStyle(Theme.textTertiary)
                Spacer(minLength: Theme.Space.sm)
                Text(CycleBuckets.timing(cycle))
                    .font(PolarisText.captionSmall)
                    .foregroundStyle(cycle.isActive() ? Theme.accentBright : Theme.textTertiary)
            }
        }
        .padding(.vertical, Theme.Space.sm + 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(
            "\(cycle.displayName), \(CycleBuckets.timing(cycle)), \(progress.total) issues, \(progress.percent) percent complete"
        ))
        .accessibilityAddTraits(.isButton)
    }
}
