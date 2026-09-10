import SwiftUI
import PolarisCore

/// One issue, on one line: priority, identifier, status, title, then whatever else the row
/// has room to say — labels as dots, a due date, the assignee.
///
/// The row is the densest surface in the product and the one people look at all day, so
/// everything on it is a fact and nothing on it is chrome. The identifier sits in a fixed
/// column so the titles beside it start on one vertical line.
struct IssueRow: View {
    let issue: Issue
    var isPending: Bool = false
    /// The statuses this issue's team defines. Empty leaves the mark as the plain glyph it
    /// has always been — there is nothing to offer.
    var states: [WorkflowState] = []
    /// Applies a status picked from the mark. Nil is a row that only reports status.
    var onSetState: ((WorkflowState) -> Void)?

    var body: some View {
        HStack(spacing: Theme.Space.sm) {
            PriorityIcon(priority: issue.priority)

            Text(issue.identifier)
                .font(PolarisText.rowMeta)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .frame(minWidth: 48, alignment: .leading)

            statusMark

            Text(issue.title)
                .font(PolarisText.rowTitle)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: Theme.Space.sm)

            LabelDots(labels: issue.labels)

            if let dueDate = issue.dueDate, let due = DueDateFormat.present(dueDate) {
                // Overdue is the one fact on a row worth interrupting a scan for.
                Text(due.text)
                    .font(PolarisText.captionSmall.monospacedDigit())
                    .foregroundStyle(due.isOverdue ? Theme.danger : Theme.textTertiary)
                    .lineLimit(1)
            }

            if isPending {
                ProgressView()
                    .controlSize(.small)
                    .tint(Theme.textSecondary)
                    .frame(width: 22, height: 22)
            } else {
                AvatarView(user: issue.assignee, size: 22)
            }
        }
        .padding(.vertical, Theme.Space.sm + 2)
        .frame(minHeight: Theme.rowHeight)
        .contentShape(Rectangle())
        // Without this the row reads out as six unrelated fragments. One label, in the order
        // a person would say it.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityDescription)
        // The row opens the issue, and says so: the link that does the opening sits behind
        // it with no label of its own.
        .accessibilityAddTraits(.isButton)
        // The row is one element, so the mark's menu is invisible to VoiceOver. The same
        // statuses are offered here instead, in the rotor, where a custom action belongs.
        .accessibilityActions {
            if let onSetState {
                ForEach(states) { state in
                    Button(String(localized: "Set status to \(state.name)")) { onSetState(state) }
                }
            }
        }
    }

    /// The status mark, which is also the fastest way to change it.
    ///
    /// Tapping the glyph is how a status is changed in the product this one follows, and it
    /// was the one gesture missing here: the list had a swipe and a long-press, both of which
    /// have to be discovered, and the mark itself did nothing. It stays a plain glyph when
    /// the team's statuses are not known yet, rather than opening an empty menu.
    @ViewBuilder
    private var statusMark: some View {
        if let onSetState, !states.isEmpty {
            Menu {
                ForEach(states) { state in
                    Button {
                        onSetState(state)
                    } label: {
                        SwiftUI.Label(state.name, systemImage: state.category.symbolName)
                    }
                }
            } label: {
                StateIcon(state: issue.state)
                    // A 16pt glyph is not a touch target. The mark keeps its size and the
                    // area around it is what catches the tap, matching the avatar at the
                    // other end of the row.
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true)
        } else {
            StateIcon(state: issue.state)
        }
    }

    private var accessibilityDescription: String {
        var parts = [issue.identifier, issue.title, "Status: \(issue.state.name)"]
        if issue.priority != Priority.none { parts.append("Priority: \(issue.priority.label)") }
        parts.append(issue.assignee.map { "Assigned to \($0.displayName)" } ?? "Unassigned")
        return parts.joined(separator: ", ")
    }
}
