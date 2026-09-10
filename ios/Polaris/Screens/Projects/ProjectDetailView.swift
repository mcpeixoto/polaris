import SwiftUI
import PolarisCore

/// One project: what it is, who and when, how far along, its milestones, and the issues in
/// it grouped by status — gathered from every team it spans, which is what `ProjectStore`
/// does behind the list.
///
/// The header is fixed over the list and kept short for it: a summary clipped to three
/// lines, one row of pills, the bar, and the first three milestones. A header that grows
/// with the project pushes the list — the part that changes daily — off the screen.
struct ProjectDetailView: View {
    @Environment(AppModel.self) private var model
    @State private var store: ProjectStore?
    @State private var writeError: PolarisError?
    @State private var pendingIDs: Set<String> = []

    private let seed: Project
    /// How many milestones the header shows before it says "and N more".
    private static let milestonesShown = 3

    init(project: Project) {
        self.seed = project
    }

    var body: some View {
        VStack(spacing: 0) {
            if let store {
                header(store: store)
                    .readableColumn()
                HairlineDivider()
                list(store: store)
            } else {
                LoadingView(label: String(localized: "Loading project"))
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(seed.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if store == nil {
                let created = ProjectStore(api: model.api, project: seed)
                model.adopt(&created.onUnauthorized)
                // A status set on the detail screen this list opens, or on any other list
                // holding the same row, lands here too.
                model.observeIssueWrites(created)
                store = created
            }
            await store?.load()
        }
        // Same trade as the cycle screen: a row waiting on the server must not be reloaded
        // back to the status it is being moved off.
        .refreshOnRealtime(isSuspended: !pendingIDs.isEmpty) { await store?.load() }
    }

    // MARK: - Header

    private func header(store: ProjectStore) -> some View {
        let project = store.project.value ?? seed
        return VStack(alignment: .leading, spacing: Theme.Space.sm + 2) {
            HStack(spacing: Theme.Space.sm + 2) {
                ProjectIconView(project: project, size: 24)
                Text(project.name)
                    .font(PolarisText.issueTitle)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 0)
            }
            if let summary = project.summary, !summary.isEmpty {
                Text(summary)
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            properties(project)
            progress(store: store)
            milestones(project)
            if let writeError {
                InlineErrorLabel(text: writeError.displayMessage)
            }
        }
        .padding(.horizontal, Theme.Space.lg)
        .padding(.vertical, Theme.Space.md)
    }

    /// Status, lead, dates and teams as one row of pills that scrolls sideways. The issue
    /// detail wraps its pills, but it sits in a scroll view; this header is fixed over a
    /// list and a row that grows downward would push the list off the screen.
    private func properties(_ project: Project) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: Theme.Space.sm) {
                propertyChips(project)
            }
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
    }

    @ViewBuilder
    private func propertyChips(_ project: Project) -> some View {
        PropertyChip(text: project.status.name) {
            Image(systemName: project.status.category.symbolName)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.hex(project.status.color))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Status, \(project.status.name)"))
        .accessibilityIdentifier("project.status")

        PropertyChip(
            text: project.lead?.displayName ?? String(localized: "No lead"),
            tint: project.lead == nil ? Theme.textSecondary : Theme.textPrimary
        ) {
            AvatarView(user: project.lead, size: 16)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Lead, \(project.lead?.displayName ?? String(localized: "none"))"))
        .accessibilityIdentifier("project.lead")

        if let span = PlanningDates.span(start: project.startDate, target: project.targetDate) {
            PropertyChip(text: span) {
                Image(systemName: "calendar")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Dates, \(span)"))
            .accessibilityIdentifier("project.dates")
        }

        ForEach(project.teams) { team in
            PropertyChip(text: team.key, tint: Theme.textSecondary) {
                Circle()
                    .fill(Theme.hex(team.color))
                    .frame(width: 8, height: 8)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Team, \(team.name)"))
        }
    }

    private func progress(store: ProjectStore) -> some View {
        let progress = store.progress
        return VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(spacing: Theme.Space.sm) {
                WorkProgressBar(progress: progress)
                Text("\(progress.percent)%")
                    .font(PolarisText.rowMeta)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("project.percent")
            }
            Text(progressLine(progress, loaded: store.issues.value != nil))
                .font(PolarisText.captionSmall.monospacedDigit())
                .foregroundStyle(Theme.textTertiary)
        }
    }

    private func progressLine(_ progress: WorkProgress, loaded: Bool) -> String {
        guard loaded else { return String(localized: "Counting issues") }
        var parts = [String(localized: "\(progress.completed) of \(progress.total) done")]
        if progress.started > 0 { parts.append(String(localized: "\(progress.started) started")) }
        if progress.canceled > 0 { parts.append(String(localized: "\(progress.canceled) canceled")) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func milestones(_ project: Project) -> some View {
        if !project.milestones.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                SectionLabel(text: String(localized: "Milestones"))
                ForEach(project.milestones.prefix(Self.milestonesShown)) { milestone in
                    HStack(spacing: Theme.Space.sm) {
                        Image(systemName: "flag")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textTertiary)
                            .frame(width: 14)
                            .accessibilityHidden(true)
                        Text(milestone.name)
                            .font(PolarisText.caption)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: Theme.Space.sm)
                        if let date = milestone.targetDate,
                           let due = DueDateFormat.present(date) {
                            Text(due.text)
                                .font(PolarisText.captionSmall.monospacedDigit())
                                .foregroundStyle(due.isOverdue ? Theme.danger : Theme.textTertiary)
                        }
                    }
                    .frame(minHeight: 24)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("project.milestone.\(milestone.id)")
                }
                if project.milestones.count > Self.milestonesShown {
                    Text("and \(project.milestones.count - Self.milestonesShown) more")
                        .font(PolarisText.captionSmall)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.leading, 14 + Theme.Space.sm)
                }
            }
        }
    }

    // MARK: - List

    @ViewBuilder
    private func list(store: ProjectStore) -> some View {
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
                    title: String(localized: "No issues yet"),
                    message: String(localized: "Nothing has been added to this project.")
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

    /// The project store has no optimistic write of its own, so the row shows a spinner
    /// until the server answers and the answer is merged into both this list and My Issues.
    private func setState(_ issue: Issue, to state: WorkflowState, store: ProjectStore) async {
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
