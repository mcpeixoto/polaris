import SwiftUI
import PolarisCore

/// The issue list, wherever it appears: My Issues, a team, a search result.
///
/// A `List` rather than the `LazyVStack` this started as, and that is the whole point of the
/// type. `.swipeActions` is a `List` affordance and cannot be attached to anything else, and
/// swipe-to-change-status is the single largest "feels less native" gap a list like this can
/// have. The list styling is stripped back to plain with clear row backgrounds so the rows
/// keep the card look they had.
///
/// Navigation is value-based: rows push `Issue` and the *caller* owns the destination, so the
/// same list works inside a `NavigationStack` on a phone and inside the content column of a
/// `NavigationSplitView` on an iPad.
struct IssueListView: View {
    let issues: [Issue]
    /// Rows with a write in flight, which show a spinner where their avatar goes.
    var pendingIDs: Set<String> = []
    /// The states this issue's team defines, for the swipe action and the context menu. Empty
    /// disables both rather than offering a menu with nothing in it.
    let statesFor: (Issue) -> [WorkflowState]
    let setState: (Issue, WorkflowState) -> Void

    /// Bumped whenever a status change is applied, which is what drives the haptic. A trigger
    /// on the issue array itself would fire on every refresh, tapping the wrist for something
    /// the reader did not do.
    @State private var stateChanges = 0
    @Environment(\.issueTransitionNamespace) private var transitionNamespace

    var body: some View {
        List {
            ForEach(issues) { issue in
                row(issue)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
        // The store re-sorts on every merge, create and status change. Without this the row
        // teleports: change an issue from Todo to Done and its row snaps to the bottom of the
        // list with no motion tying the two positions together.
        .animation(Theme.easing(0.3), value: issues.map(\.id))
        .sensoryFeedback(.impact(weight: .light), trigger: stateChanges)
    }

    private func row(_ issue: Issue) -> some View {
        NavigationLink(value: issue) {
            IssueRow(issue: issue, isPending: pendingIDs.contains(issue.id))
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(
            top: Theme.Space.xs, leading: Theme.Space.xl,
            bottom: Theme.Space.xs, trailing: Theme.Space.xl
        ))
        .transition(.opacity.combined(with: .move(edge: .top)))
        // The title, the identifier and the state icon all exist on both screens; on iOS 18
        // they are the same element crossing between them rather than two that happen to
        // look alike.
        .issueTransitionSource(issue.id, in: transitionNamespace)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if let done = terminal(for: issue) {
                Button {
                    apply(issue, done)
                } label: {
                    SwiftUI.Label(done.name, systemImage: done.category.symbolName)
                }
                .tint(Theme.state(done.category))
                .accessibilityLabel(Text("Mark \(issue.identifier) \(done.name)"))
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if let next = nextOpen(for: issue) {
                Button {
                    apply(issue, next)
                } label: {
                    SwiftUI.Label(next.name, systemImage: next.category.symbolName)
                }
                .tint(Theme.state(next.category))
                .accessibilityLabel(Text("Move \(issue.identifier) to \(next.name)"))
            }
        }
        .contextMenu {
            let states = statesFor(issue)
            if !states.isEmpty {
                Menu {
                    ForEach(states) { state in
                        Button {
                            apply(issue, state)
                        } label: {
                            SwiftUI.Label(state.name, systemImage: state.category.symbolName)
                        }
                    }
                } label: {
                    SwiftUI.Label("Status", systemImage: "circle.lefthalf.filled")
                }
            }
            Button {
                UIPasteboard.general.string = issue.identifier
            } label: {
                SwiftUI.Label("Copy identifier", systemImage: "doc.on.doc")
            }
        }
        .accessibilityIdentifier("issue.row.\(issue.identifier)")
    }

    private func apply(_ issue: Issue, _ state: WorkflowState) {
        stateChanges += 1
        setState(issue, state)
    }

    /// The first completed state this team has, for the leading full swipe. Nil when the team
    /// defines none, in which case no action is offered rather than one that does nothing.
    private func terminal(for issue: Issue) -> WorkflowState? {
        statesFor(issue).first { $0.category == .completed && $0.id != issue.state.id }
    }

    /// The next open state after this one, in the workspace's own order. "Next" rather than a
    /// fixed target, because a workspace's pipeline is its own.
    private func nextOpen(for issue: Issue) -> WorkflowState? {
        let states = statesFor(issue).filter { $0.category.isOpen }
        guard let index = states.firstIndex(where: { $0.id == issue.state.id }) else {
            return states.first
        }
        return index + 1 < states.count ? states[index + 1] : nil
    }
}

/// The real row's geometry over placeholder text.
///
/// Redacted fixture content rather than grey rectangles, so the layout the reader is about to
/// get is already on screen and nothing jumps when the answer arrives — which is what a
/// centred spinner over an empty screen cannot do.
struct SkeletonIssueList: View {
    var rows: Int = 4

    var body: some View {
        VStack(spacing: Theme.Space.sm) {
            ForEach(0..<rows, id: \.self) { index in
                SkeletonIssueRow(titleWidth: index.isMultiple(of: 2) ? 230 : 150)
            }
        }
        .padding(.horizontal, Theme.Space.xl)
        .redacted(reason: .placeholder)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading issues")
    }
}

private struct SkeletonIssueRow: View {
    /// How wide the title placeholder is, so four rows do not read as one grey block.
    let titleWidth: CGFloat

    var body: some View {
        HStack(spacing: 11) {
            Circle()
                .fill(Theme.chipInactive)
                .frame(width: 15, height: 15)
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                Capsule()
                    .fill(Theme.chipInactive)
                    .frame(width: titleWidth, height: 13)
                Capsule()
                    .fill(Theme.chipInactive)
                    .frame(width: 90, height: 10)
            }
            Spacer(minLength: Theme.Space.sm)
            Circle()
                .fill(Theme.chipInactive)
                .frame(width: 26, height: 26)
        }
        .padding(.horizontal, Theme.Space.lg)
        .padding(.vertical, Theme.Space.md)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }
}
