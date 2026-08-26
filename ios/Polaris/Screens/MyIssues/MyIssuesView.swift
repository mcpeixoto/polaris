import SwiftUI
import PolarisCore

struct MyIssuesView: View {
    @Environment(AppModel.self) private var model
    @State private var isComposing = false

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                content
            }
            // Every screen draws its own header, so the system bar would only add a second,
            // emptier one above it.
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $isComposing) { ComposeIssueView() }
        }
    }

    /// Eyebrow over title, with the trailing action as a tinted circle — the same shape on
    /// every screen, so the eye learns where to look once.
    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                MonoEyebrow(text: openCountLabel)
                Spacer(minLength: 0)
            }
            HStack(alignment: .center) {
                Text("My Issues")
                    .displayFont(30, weight: .bold)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                filterMenu
                Button { isComposing = true } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.accentBright)
                        .frame(width: 38, height: 38)
                        .background(Theme.accentTint)
                        .clipShape(Circle())
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("New issue")
            }
        }
    }

    private var openCountLabel: String {
        guard let issues = model.issues.issues.value else { return "Loading" }
        let open = issues.filter { $0.state.category.isOpen }.count
        return open == 1 ? "1 open" : "\(open) open"
    }

    private var filterMenu: some View {
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
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 38, height: 38)
                .background(Theme.chipInactive)
                .clipShape(Circle())
        }
        .accessibilityLabel("Filter")
    }

    @ViewBuilder
    private var content: some View {
        switch model.issues.issues {
        case .idle, .loading:
            VStack(spacing: 0) {
                header.padding(.horizontal, 20).padding(.top, 8)
                LoadingView(label: "Loading your issues")
            }

        case .failed(let error):
            VStack(spacing: 0) {
                header.padding(.horizontal, 20).padding(.top, 8)
                ErrorStateView(error: error) {
                    Task { await model.issues.load() }
                }
            }

        case .loaded(let issues):
            ScrollView {
                LazyVStack(spacing: 8) {
                    header
                        .padding(.bottom, 10)
                        .staggerRise(0)

                    if issues.isEmpty {
                        EmptyStateView(
                            symbol: "checkmark.circle",
                            title: "Nothing assigned to you",
                            message: model.issues.includeCompleted
                                ? "No issues are assigned to you in this workspace yet."
                                : "You're all clear. Completed work is hidden — turn it on from the filter above.",
                            actionTitle: "New issue",
                            action: { isComposing = true }
                        )
                        .staggerRise(1)
                    } else {
                        ForEach(Array(issues.enumerated()), id: \.element.id) { index, issue in
                            NavigationLink {
                                IssueDetailView(issue: issue)
                            } label: {
                                IssueRow(
                                    issue: issue,
                                    isPending: model.issues.pendingIssueIDs.contains(issue.id)
                                )
                            }
                            .buttonStyle(PressableStyle())
                            .staggerRise(index + 1)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.issues.load() }
        }
    }
}
