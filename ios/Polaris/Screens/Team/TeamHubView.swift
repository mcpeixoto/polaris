import SwiftUI
import PolarisCore

/// A team, the way Linear's phone app opens one: who it is, the four places under it, the
/// cycle running now, and its issues.
///
/// The summary is fixed above the list rather than scrolling with it. The rows into Triage,
/// Cycles and Projects are the reason somebody opened the team, and a list that scrolls them
/// off the top on the first flick turns the hub back into the plain list it replaced. The
/// list under it is every issue the team has, grouped by status, so the team's shape is
/// visible without a second tap.
struct TeamHubView: View {
    let team: Team
    @Environment(AppModel.self) private var model
    @State private var store: TeamWorkStore?
    @State private var favoriteToggles = 0

    var body: some View {
        VStack(spacing: 0) {
            if let store {
                summary(store: store)
                    .readableColumn()
                HairlineDivider()
                list(store: store)
            } else {
                LoadingView(label: String(localized: "Loading \(team.name)"))
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(team.name)
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.impact(weight: .light), trigger: favoriteToggles)
        .task {
            if store == nil { store = TeamWorkStores.shared.store(for: team, model: model) }
            await store?.load()
        }
    }

    // MARK: - Summary

    private func summary(store: TeamWorkStore) -> some View {
        VStack(spacing: 0) {
            header(store: store)
            rows(store: store)
            if team.cyclesEnabled, let cycle = store.activeCycle() {
                activeCycleCard(cycle, store: store)
            }
            if let error = model.workspaceData.favoriteError {
                InlineErrorLabel(text: error.displayMessage)
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.bottom, Theme.Space.sm)
            }
        }
    }

    private func header(store: TeamWorkStore) -> some View {
        HStack(spacing: Theme.Space.sm + 2) {
            TeamIconView(team: team, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(team.name)
                    .font(PolarisText.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(openCountLine(store: store))
                    .font(PolarisText.caption.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("team.hub.open")
            }
            Spacer(minLength: Theme.Space.sm)
            favoriteButton
        }
        .padding(.horizontal, Theme.Space.lg)
        .padding(.vertical, Theme.Space.sm)
    }

    /// "ENG · 3 open", or what stands in for the count until there is one.
    private func openCountLine(store: TeamWorkStore) -> String {
        switch store.issues {
        case .idle, .loading:
            return "\(team.key) · \(String(localized: "Loading"))"
        case .failed:
            return "\(team.key) · \(String(localized: "Can't load issues"))"
        case .loaded(let issues):
            let open = issues.filter { $0.state.category.isOpen }.count
            return "\(team.key) · \(String(localized: "\(open) open"))"
        }
    }

    private var isFavorite: Bool {
        model.workspaceData.isFavorite(kind: .team, targetId: team.id)
    }

    private var favoriteButton: some View {
        Button {
            favoriteToggles += 1
            Task { await model.workspaceData.toggleFavorite(kind: .team, targetId: team.id) }
        } label: {
            Image(systemName: isFavorite ? "star.fill" : "star")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(isFavorite ? Theme.gold : Theme.textTertiary)
                .hitTarget()
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(isFavorite
            ? Text("Remove \(team.name) from favorites")
            : Text("Add \(team.name) to favorites"))
        .accessibilityIdentifier("team.favorite")
    }

    // MARK: - Rows

    private func rows(store: TeamWorkStore) -> some View {
        VStack(spacing: 0) {
            HairlineDivider()
            hubRow(
                .issues(team, .active),
                symbol: "circle.lefthalf.filled",
                title: String(localized: "Issues"),
                detail: store.issues.value.map { _ in "\(store.active.count)" },
                identifier: "team.hub.issues"
            )
            if team.triageEnabled {
                HairlineDivider().padding(.leading, Theme.Space.lg)
                hubRow(
                    .triage(team),
                    symbol: "tray",
                    title: String(localized: "Triage"),
                    badge: store.triage.count,
                    identifier: "team.hub.triage"
                )
            }
            if team.cyclesEnabled {
                HairlineDivider().padding(.leading, Theme.Space.lg)
                hubRow(
                    .cycles(team),
                    symbol: "arrow.trianglehead.2.clockwise.rotate.90",
                    title: String(localized: "Cycles"),
                    detail: store.activeCycle().map {
                        "\($0.displayName) · \(CycleBuckets.timing($0))"
                    },
                    identifier: "team.hub.cycles"
                )
            }
            HairlineDivider().padding(.leading, Theme.Space.lg)
            hubRow(
                .projects(team),
                symbol: "hexagon",
                title: String(localized: "Projects"),
                detail: model.workspaceData.projects.value.map {
                    _ in "\(model.workspaceData.projects(forTeam: team.id).count)"
                },
                identifier: "team.hub.projects"
            )
        }
    }

    /// One way in: a glyph, the name, and on the right what the reader will find there.
    private func hubRow(
        _ route: TeamListRoute,
        symbol: String,
        title: String,
        detail: String? = nil,
        badge: Int? = nil,
        identifier: String
    ) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: Theme.Space.sm + 2) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 20)
                    .accessibilityHidden(true)
                Text(title)
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textPrimary)
                Spacer(minLength: Theme.Space.sm)
                if let detail {
                    Text(detail)
                        .font(PolarisText.rowMeta)
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                }
                if let badge, badge > 0 {
                    CountBadge(count: badge)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, Theme.Space.lg)
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(identifier)
    }

    // MARK: - Active cycle

    private func activeCycleCard(_ cycle: Cycle, store: TeamWorkStore) -> some View {
        let progress = WorkProgress(issues: store.issues(inCycle: cycle.id))
        return NavigationLink(value: cycle) {
            Card {
                VStack(alignment: .leading, spacing: Theme.Space.xs + 2) {
                    HStack(spacing: Theme.Space.sm) {
                        CycleRing(percent: progress.percent)
                        Text(cycle.displayName)
                            .font(PolarisText.rowTitle)
                            .foregroundStyle(Theme.textPrimary)
                        Text(verbatim: "·").foregroundStyle(Theme.textTertiary)
                        Text(CycleBuckets.timing(cycle))
                            .font(PolarisText.caption)
                            .foregroundStyle(Theme.textSecondary)
                        Spacer(minLength: Theme.Space.sm)
                        Text("\(progress.percent)%")
                            .font(PolarisText.rowMeta)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    WorkProgressBar(progress: progress)
                    HStack {
                        Text(PlanningDates.range(cycle.startsAt, cycle.endsAt))
                            .font(PolarisText.captionSmall.monospacedDigit())
                            .foregroundStyle(Theme.textTertiary)
                        Spacer(minLength: Theme.Space.sm)
                        Text("\(progress.completed) of \(progress.total) done")
                            .font(PolarisText.captionSmall.monospacedDigit())
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                .padding(Theme.Space.md)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .padding(.horizontal, Theme.Space.lg)
        .padding(.top, Theme.Space.xs)
        .padding(.bottom, Theme.Space.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(
            "Active cycle, \(cycle.displayName), \(CycleBuckets.timing(cycle)), \(progress.percent) percent complete"
        ))
        .accessibilityIdentifier("team.hub.activeCycle")
    }

    // MARK: - List

    @ViewBuilder
    private func list(store: TeamWorkStore) -> some View {
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
                    title: String(localized: "No issues"),
                    message: String(localized: "\(team.name) has nothing open or closed yet.")
                )
                .padding(.top, Theme.Space.xxl)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await store.load() }

        case .loaded(let issues):
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
                    issues: issues,
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
