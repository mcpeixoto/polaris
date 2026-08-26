import SwiftUI
import PolarisCore

struct IssueRow: View {
    let issue: Issue
    var isPending: Bool = false

    var body: some View {
        HStack(spacing: 11) {
            StateIcon(state: issue.state)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 4) {
                Text(issue.title)
                    .bodyFont(14.5, weight: .medium)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                HStack(spacing: 7) {
                    Text(issue.identifier)
                        .monoFont(10.5, weight: .medium)
                        .foregroundStyle(Theme.eyebrowText)
                    if issue.priority != Priority.none {
                        PriorityIcon(priority: issue.priority)
                    }
                    if let dueDate = issue.dueDate {
                        Text(dueDate)
                            .monoFont(10.5)
                            .foregroundStyle(Theme.eyebrowText)
                    }
                    ForEach(issue.labels.prefix(2)) { label in
                        LabelChip(label: label)
                    }
                }
            }

            Spacer(minLength: 8)

            if isPending {
                ProgressView()
                    .controlSize(.small)
                    .tint(Theme.accentBright)
            } else {
                AvatarView(user: issue.assignee)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        // Without this the row reads out as six unrelated fragments. One label, in the order
        // a person would say it.
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
