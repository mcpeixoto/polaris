import SwiftUI
import PolarisCore

/// A workflow state, as an icon plus its workspace-given colour.
///
/// The icon comes from the *category*, never the name: a workspace may call a started state
/// anything it likes, and the glyph still has to mean "in progress".
struct StateIcon: View {
    let state: WorkflowState
    var size: CGFloat = 15

    var body: some View {
        Image(systemName: state.category.symbolName)
            .font(.system(size: size))
            .foregroundStyle(Theme.hex(state.color))
            .accessibilityHidden(true)
    }
}

struct PriorityIcon: View {
    let priority: Priority

    var body: some View {
        Image(systemName: priority.symbolName)
            .font(.system(size: 13))
            .foregroundStyle(Theme.priority(priority))
            .accessibilityHidden(true)
    }
}

struct LabelChip: View {
    let label: PolarisCore.Label

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Theme.hex(label.color))
                .frame(width: 6, height: 6)
            Text(label.name)
                .font(.caption2)
                .foregroundStyle(Theme.secondaryText)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Capsule().fill(Color(.tertiarySystemFill)))
        .accessibilityLabel("Label: \(label.name)")
    }
}

/// Initials, because most seeded accounts have no avatar image.
struct AvatarView: View {
    let user: User?
    var size: CGFloat = 24

    var body: some View {
        Group {
            if let user {
                Circle()
                    .fill(Color.accentColor.opacity(0.18))
                    .overlay(
                        Text(user.initials)
                            .font(.system(size: size * 0.42, weight: .semibold))
                            .foregroundStyle(Color.accentColor)
                    )
            } else {
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(user.map { "Assigned to \($0.displayName)" } ?? "Unassigned")
    }
}
