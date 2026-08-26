import SwiftUI
import PolarisCore

struct MyIssuesView: View {
    @Environment(AppModel.self) private var model
    @State private var isComposing = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("My Issues")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            isComposing = true
                        } label: {
                            Image(systemName: "square.and.pencil")
                        }
                        .accessibilityLabel("New issue")
                    }
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Toggle(
                                "Show completed",
                                isOn: Binding(
                                    get: { model.issues.includeCompleted },
                                    set: { newValue in
                                        Task { await model.issues.setIncludeCompleted(newValue) }
                                    }
                                )
                            )
                        } label: {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                        }
                        .accessibilityLabel("Filter")
                    }
                }
                .sheet(isPresented: $isComposing) {
                    ComposeIssueView()
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.issues.issues {
        case .idle, .loading:
            LoadingView(label: "Loading your issues")

        case .failed(let error):
            ErrorStateView(error: error) {
                Task { await model.issues.load() }
            }

        case .loaded(let issues) where issues.isEmpty:
            EmptyStateView(
                symbol: "checkmark.circle",
                title: "Nothing assigned to you",
                message: model.issues.includeCompleted
                    ? "No issues are assigned to you in this workspace."
                    : "You're all clear. Completed issues are hidden — turn them on from the filter menu.",
                actionTitle: "New issue",
                action: { isComposing = true }
            )

        case .loaded(let issues):
            List {
                ForEach(issues) { issue in
                    NavigationLink {
                        IssueDetailView(issue: issue)
                    } label: {
                        IssueRow(
                            issue: issue,
                            isPending: model.issues.pendingIssueIDs.contains(issue.id)
                        )
                    }
                }
            }
            .listStyle(.plain)
            .refreshable { await model.issues.load() }
        }
    }
}
