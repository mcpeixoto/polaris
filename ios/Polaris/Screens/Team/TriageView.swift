import SwiftUI
import PolarisCore

/// What has come in and nobody has decided about yet.
///
/// The two decisions are swipes: accept from the leading edge, decline from the trailing one,
/// which is where the status swipes sit on every other list — so the gesture a reader has
/// already learned does the analogous thing here. Both go through the API rather than a
/// status change, because accepting is the server's decision about *which* state an issue
/// lands in, and a client that guesses "Todo" is wrong on any team that named it differently.
struct TriageView: View {
    let team: Team
    @Environment(AppModel.self) private var model
    @Environment(\.issueTransitionNamespace) private var transitionNamespace
    @State private var store: TeamWorkStore?
    @State private var pendingIDs: Set<String> = []
    @State private var error: PolarisError?
    @State private var decisions = 0

    var body: some View {
        VStack(spacing: 0) {
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
        .navigationTitle(Text("Triage"))
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.impact(weight: .light), trigger: decisions)
        .task {
            if store == nil { store = TeamWorkStores.shared.store(for: team, model: model) }
            await store?.load()
        }
        // A decision in flight is a row the server has not answered about yet; reloading over
        // it puts the issue back in the queue the reader just cleared it from.
        .refreshOnRealtime(isSuspended: !pendingIDs.isEmpty) { await store?.load() }
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

        case .failed(let failure):
            ErrorStateView(error: failure) { Task { await store.load() } }
                .readableColumn()

        case .loaded:
            let queue = store.triage
            if queue.isEmpty {
                ScrollView {
                    EmptyStateView(
                        symbol: "checkmark.circle",
                        title: String(localized: "Triage is clear"),
                        message: String(localized: "New issues that come in without a status land here for \(team.name) to accept or decline.")
                    )
                    .padding(.top, Theme.Space.xxxl)
                    .readableColumn()
                }
                .scrollIndicators(.hidden)
                .refreshable { await store.load() }
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Text("\(queue.count) to triage")
                            .font(PolarisText.caption.monospacedDigit())
                            .foregroundStyle(Theme.textSecondary)
                            .accessibilityAddTraits(.isHeader)
                        Spacer(minLength: 0)
                        Text("Swipe to accept or decline")
                            .font(PolarisText.captionSmall)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.vertical, Theme.Space.sm)
                    if let error {
                        InlineErrorLabel(text: error.displayMessage)
                            .padding(.horizontal, Theme.Space.lg)
                            .padding(.bottom, Theme.Space.sm)
                    }
                    HairlineDivider()
                    list(queue, store: store)
                }
                .readableColumn()
            }
        }
    }

    private func list(_ queue: [Issue], store: TeamWorkStore) -> some View {
        List {
            ForEach(queue) { issue in
                IssueRow(issue: issue, isPending: pendingIDs.contains(issue.id))
                    .background(NavigationLink(value: issue) { EmptyView() }.opacity(0))
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Theme.hairline)
                    .listRowInsets(EdgeInsets(
                        top: 0, leading: Theme.Space.lg,
                        bottom: 0, trailing: Theme.Space.lg
                    ))
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    .issueTransitionSource(issue.id, in: transitionNamespace)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            decide(issue, accept: true, store: store)
                        } label: {
                            SwiftUI.Label(String(localized: "Accept"), systemImage: "checkmark.circle")
                        }
                        .tint(Theme.state(.completed))
                        .accessibilityLabel(Text("Accept \(issue.identifier)"))
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button {
                            decide(issue, accept: false, store: store)
                        } label: {
                            SwiftUI.Label(String(localized: "Decline"), systemImage: "xmark.circle")
                        }
                        .tint(Theme.state(.canceled))
                        .accessibilityLabel(Text("Decline \(issue.identifier)"))
                    }
                    .contextMenu {
                        Button {
                            decide(issue, accept: true, store: store)
                        } label: {
                            SwiftUI.Label(String(localized: "Accept"), systemImage: "checkmark.circle")
                        }
                        Button(role: .destructive) {
                            decide(issue, accept: false, store: store)
                        } label: {
                            SwiftUI.Label(String(localized: "Decline"), systemImage: "xmark.circle")
                        }
                    }
                    .accessibilityIdentifier("triage.row.\(issue.identifier)")
            }
        }
        .listStyle(.plain)
        .contentMargins(.top, 0, for: .scrollContent)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
        .environment(\.defaultMinListRowHeight, Theme.rowHeight)
        .animation(Theme.easing(0.3), value: queue.map(\.id))
        .refreshable { await store.load() }
    }

    /// The row stays, with a spinner, until the server answers. It leaves the queue by
    /// changing state, not by being removed — the store's filter does the removing.
    private func decide(_ issue: Issue, accept: Bool, store: TeamWorkStore) {
        guard !pendingIDs.contains(issue.id) else { return }
        decisions += 1
        error = nil
        pendingIDs.insert(issue.id)
        Task {
            defer { pendingIDs.remove(issue.id) }
            do {
                let updated = accept
                    ? try await model.api.acceptTriageIssue(id: issue.id, opId: UUIDv7.string())
                    : try await model.api.declineTriageIssue(id: issue.id, opId: UUIDv7.string())
                store.merge(updated)
                model.issueDidChange(updated, from: store)
            } catch {
                self.error = PolarisError.mapped(error)
            }
        }
    }
}
