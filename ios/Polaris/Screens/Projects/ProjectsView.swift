import SwiftUI
import PolarisCore

/// Projects — the workspace's, or one team's share of them.
///
/// Rows come from `WorkspaceDataStore`, which already holds every project: a second fetch
/// for a list the app loaded at sign-in would be a request for nothing. Progress is not on
/// the row — computing it means fetching every team's issues per project, and forty rows
/// doing that at once is a screen that never settles. It is on the detail, one tap away.
struct ProjectsView: View {
    /// Nil is the workspace-wide list.
    let team: Team?
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            content
        }
        .navigationTitle(Text("Projects"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Projects load with the rest of the reference data at sign-in; this only fills a
            // gap left by a failed or not-yet-finished load — and asks for projects alone,
            // rather than re-running all six collections to fetch one of them.
            await model.workspaceData.ensure(.projects)
        }
    }

    private var projects: [Project] {
        if let team { return model.workspaceData.projects(forTeam: team.id) }
        return (model.workspaceData.projects.value ?? []).sorted { left, right in
            if left.status.category.isOpen != right.status.category.isOpen {
                return left.status.category.isOpen
            }
            return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.workspaceData.projects {
        case .idle, .loading:
            LoadingView(label: String(localized: "Loading projects"))

        case .failed(let error):
            ErrorStateView(error: error) { Task { await model.workspaceData.reload(.projects) } }
                .readableColumn()

        case .loaded:
            let list = projects
            if list.isEmpty {
                ScrollView {
                    EmptyStateView(
                        symbol: "hexagon",
                        title: String(localized: "No projects"),
                        message: team.map { String(localized: "\($0.name) is not on any project yet.") }
                            ?? String(localized: "Nothing in this workspace is organised into a project yet.")
                    )
                    .padding(.top, Theme.Space.xxxl)
                    .readableColumn()
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.workspaceData.reload(.projects) }
            } else {
                let open = list.filter { $0.status.category.isOpen }
                let closed = list.filter { !$0.status.category.isOpen }
                List {
                    section(String(localized: "Open"), open)
                    section(String(localized: "Closed"), closed)
                }
                .listStyle(.plain)
                .listSectionSeparator(.hidden)
                .listSectionSpacing(0)
                .contentMargins(.top, 0, for: .scrollContent)
                .scrollContentBackground(.hidden)
                .scrollIndicators(.hidden)
                .environment(\.defaultMinListRowHeight, Theme.rowHeight)
                .readableColumn()
                .refreshable { await model.workspaceData.reload(.projects) }
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ projects: [Project]) -> some View {
        if !projects.isEmpty {
            Section {
                ForEach(projects) { project in
                    ProjectRow(project: project)
                        // Before the link goes behind it, so only the row carries the id.
                        .accessibilityIdentifier("project.row.\(project.id)")
                        .background(NavigationLink(value: project) { EmptyView() }.opacity(0))
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Theme.hairline)
                        .listRowInsets(EdgeInsets(
                            top: 0, leading: Theme.Space.lg,
                            bottom: 0, trailing: Theme.Space.lg
                        ))
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                }
            } header: {
                PlanningSectionHeader(title: title, count: projects.count, identifier: "projects.section.\(title)")
            }
        }
    }
}

/// One project on one line: its mark, its name, its status, when it is due, who leads it.
struct ProjectRow: View {
    let project: Project

    var body: some View {
        HStack(spacing: Theme.Space.sm + 2) {
            ProjectIconView(project: project, size: 20)
            Text(project.name)
                .font(PolarisText.rowTitle)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: Theme.Space.sm)
            ProjectStatusPill(status: project.status)
            if let target = PlanningDates.day(project.targetDate) {
                Text(target)
                    .font(PolarisText.captionSmall.monospacedDigit())
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }
            AvatarView(user: project.lead, size: 20)
        }
        .padding(.vertical, Theme.Space.sm + 2)
        .frame(minHeight: Theme.rowHeight)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityDescription)
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityDescription: String {
        var parts = [project.name, "Status: \(project.status.name)"]
        if let target = PlanningDates.day(project.targetDate) { parts.append("Due \(target)") }
        parts.append(project.lead.map { "Led by \($0.displayName)" } ?? "No lead")
        return parts.joined(separator: ", ")
    }
}
