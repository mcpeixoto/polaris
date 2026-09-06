import SwiftUI
import PolarisCore

/// The issue list, wherever it appears: My Issues, a team, a search result.
///
/// A `List` rather than a `LazyVStack`, and that is the whole point of the type:
/// `.swipeActions` is a `List` affordance and cannot be attached to anything else, and
/// swipe-to-change-status is the single largest "feels less native" gap a list like this can
/// have. Rows are flat and separated by a hairline; there is no card chrome anywhere.
///
/// Grouped by workflow state by default, the way Linear's lists are: a small heading per
/// state, states in the workspace's order with open work first. My Issues opts out and keeps
/// `IssueOrder`'s flat priority order, which is Linear's own default for that view.
///
/// Navigation is value-based: rows push `Issue` and the *caller* owns the destination, so the
/// same list works inside a `NavigationStack` on a phone and inside the content column of a
/// `NavigationSplitView` on an iPad.
struct IssueListView: View {
    enum Grouping {
        case status
        case none
    }

    let issues: [Issue]
    /// Rows with a write in flight, which show a spinner where their avatar goes.
    var pendingIDs: Set<String> = []
    var grouping: Grouping = .status
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
            switch grouping {
            case .none:
                ForEach(issues) { issue in
                    row(issue)
                }
            case .status:
                ForEach(IssueGrouping.byStatus(issues, statesFor: statesFor)) { group in
                    Section {
                        ForEach(group.issues) { issue in
                            row(issue)
                        }
                    } header: {
                        StatusGroupHeader(state: group.state, count: group.issues.count)
                    }
                }
            }
        }
        .listStyle(.plain)
        .listSectionSeparator(.hidden)
        // No air between a group's last row and the next heading, and none above the first:
        // the headings are bands of the list, and a band with a margin is a card.
        .listSectionSpacing(0)
        .contentMargins(.top, 0, for: .scrollContent)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
        .environment(\.defaultMinListRowHeight, Theme.rowHeight)
        // The store re-sorts on every merge, create and status change. Without this the row
        // teleports: change an issue from Todo to Done and its row snaps to the bottom of the
        // list with no motion tying the two positions together.
        .animation(Theme.easing(0.3), value: issues.map(\.id))
        .sensoryFeedback(.impact(weight: .light), trigger: stateChanges)
    }

    private func row(_ issue: Issue) -> some View {
        IssueRow(issue: issue, isPending: pendingIDs.contains(issue.id))
            // The link is behind the row rather than around it, so the cell does not draw
            // the disclosure chevron — Linear's rows have none, and forty chevrons down the
            // right edge are forty marks saying nothing. A tap on the cell still activates
            // it; the row itself says it is a button so VoiceOver and XCUITest agree.
            .background(NavigationLink(value: issue) { EmptyView() }.opacity(0))
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(Theme.hairline)
        .listRowInsets(EdgeInsets(
            top: 0, leading: Theme.Space.lg,
            bottom: 0, trailing: Theme.Space.lg
        ))
        // The separator runs from the row's leading inset rather than from the text, so the
        // list reads as one column of rows rather than as rows hanging off their titles.
        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
        .transition(.opacity)
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

/// The heading over a status group: the state's glyph, its name, and how many rows are under
/// it. Drawn on the raised tint the web's group bar uses, so the groups read as bands of the
/// list rather than as rows of it.
struct StatusGroupHeader: View {
    let state: WorkflowState
    let count: Int

    var body: some View {
        HStack(spacing: Theme.Space.sm) {
            StateIcon(state: state, size: 14)
            Text(state.name)
                .font(.system(.footnote).weight(.medium))
                .foregroundStyle(Theme.textPrimary)
            Text("\(count)")
                .font(.system(.footnote).monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Space.lg)
        .frame(minHeight: 32)
        .background(Theme.raised)
        .textCase(nil)
        .listRowInsets(EdgeInsets())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("issues.group.\(state.name)")
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
        VStack(spacing: 0) {
            ForEach(0..<rows, id: \.self) { index in
                SkeletonIssueRow(titleWidth: index.isMultiple(of: 2) ? 200 : 140)
                HairlineDivider()
            }
        }
        .padding(.horizontal, Theme.Space.lg)
        .redacted(reason: .placeholder)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading issues")
    }
}

private struct SkeletonIssueRow: View {
    /// How wide the title placeholder is, so four rows do not read as one grey block.
    let titleWidth: CGFloat

    var body: some View {
        HStack(spacing: Theme.Space.sm) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(Theme.chipInactive)
                .frame(width: 14, height: 14)
            Capsule()
                .fill(Theme.chipInactive)
                .frame(width: 44, height: 10)
            Circle()
                .fill(Theme.chipInactive)
                .frame(width: 14, height: 14)
            Capsule()
                .fill(Theme.chipInactive)
                .frame(width: titleWidth, height: 12)
            Spacer(minLength: Theme.Space.sm)
            Circle()
                .fill(Theme.chipInactive)
                .frame(width: 22, height: 22)
        }
        .frame(minHeight: Theme.rowHeight)
    }
}
