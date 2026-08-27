import SwiftUI
import PolarisCore

/// A workflow state, as an icon in its workspace-given colour.
///
/// The glyph comes from the *category*, never the name: a workspace may rename a started state
/// to anything it likes, and the icon still has to mean "in progress".
struct StateIcon: View {
    let state: WorkflowState
    var size: CGFloat = 15

    var body: some View {
        Image(systemName: state.category.symbolName)
            .font(.system(size: size, weight: .medium))
            .foregroundStyle(Theme.hex(state.color))
            .accessibilityHidden(true)
    }
}

struct PriorityIcon: View {
    let priority: Priority

    var body: some View {
        Image(systemName: priority.symbolName)
            .font(.system(size: 12, weight: .semibold))
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
                .bodyFont(10.5, weight: .medium)
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(Theme.chipInactive))
        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
        .accessibilityLabel("Label: \(label.name)")
    }
}

/// Initials, because most seeded accounts have no avatar image.
struct AvatarView: View {
    let user: User?
    var size: CGFloat = 26

    var body: some View {
        Group {
            if let user {
                Circle()
                    .fill(Theme.accent.opacity(0.22))
                    .overlay(Circle().stroke(Theme.accent.opacity(0.45), lineWidth: 1))
                    .overlay(
                        Text(user.initials)
                            .bodyFont(size * 0.4, weight: .bold)
                            .foregroundStyle(Theme.accentBright)
                    )
            } else {
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [2.5, 2.5]))
                    .foregroundStyle(Color.white.opacity(0.25))
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(user.map { "Assigned to \($0.displayName)" } ?? "Unassigned")
    }
}
