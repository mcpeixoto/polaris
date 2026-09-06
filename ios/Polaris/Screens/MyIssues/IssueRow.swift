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

    var body: some View {
        HStack(spacing: Theme.Space.sm) {
            PriorityIcon(priority: issue.priority)

            Text(issue.identifier)
                .font(PolarisText.rowMeta)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .frame(minWidth: 48, alignment: .leading)

            StateIcon(state: issue.state)

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
    }

    private var accessibilityDescription: String {
        var parts = [issue.identifier, issue.title, "Status: \(issue.state.name)"]
        if issue.priority != Priority.none { parts.append("Priority: \(issue.priority.label)") }
        parts.append(issue.assignee.map { "Assigned to \($0.displayName)" } ?? "Unassigned")
        return parts.joined(separator: ", ")
    }
}
