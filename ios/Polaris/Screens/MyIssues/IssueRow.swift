import SwiftUI
import PolarisCore

struct IssueRow: View {
    let issue: Issue
    var isPending: Bool = false

    var body: some View {
        HStack(spacing: 10) {
            StateIcon(state: issue.state)

            VStack(alignment: .leading, spacing: 3) {
                Text(issue.title)
                    .font(TypeScale.rowTitle)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text(issue.identifier)
                        .font(TypeScale.identifier)
                        .foregroundStyle(Theme.secondaryText)
                    if issue.priority != Priority.none {
                        PriorityIcon(priority: issue.priority)
                    }
                    if let dueDate = issue.dueDate {
                        Text(dueDate)
                            .font(TypeScale.rowMeta)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    ForEach(issue.labels.prefix(2)) { label in
                        LabelChip(label: label)
                    }
                }
            }

            Spacer(minLength: 8)

            if isPending {
                ProgressView().controlSize(.small)
            } else {
                AvatarView(user: issue.assignee)
            }
        }
        .padding(.vertical, 3)
        // Without this the row reads out as six unrelated fragments. One label, in the order a
        // person would say it.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityDescription)
    }

    private var accessibilityDescription: String {
        var parts = [issue.identifier, issue.title, "Status: \(issue.state.name)"]
        if issue.priority != Priority.none { parts.append("Priority: \(issue.priority.label)") }
        parts.append(issue.assignee.map { "Assigned to \($0.displayName)" } ?? "Unassigned")
        return parts.joined(separator: ", ")
    }
}
