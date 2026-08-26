import SwiftUI
import PolarisCore

/// Colour tokens.
///
/// Built on the system semantic colours rather than a fixed palette, so the app follows
/// Dark Mode, Increase Contrast and Smart Invert without a second set of values to maintain.
/// Only the things that carry meaning — priority, state category, label chips — get literal
/// colours, and those come from the workspace's own data where the server provides it.
enum Theme {
    static let background = Color(.systemGroupedBackground)
    static let surface = Color(.secondarySystemGroupedBackground)
    static let separator = Color(.separator)

    static let primaryText = Color(.label)
    static let secondaryText = Color(.secondaryLabel)
    /// For text that is genuinely de-emphasised. `.tertiaryLabel` and below fall under the
    /// 4.5:1 contrast floor at small sizes, so this stops at secondary on purpose.
    static let mutedText = Color(.secondaryLabel)

    static let accent = Color.accentColor

    static func priority(_ priority: Priority) -> Color {
        switch priority {
        case .urgent: .red
        case .high: .orange
        case .medium: .yellow
        case .low: .blue
        case .none: Color(.tertiaryLabel)
        }
    }

    static func state(_ category: StateCategory) -> Color {
        switch category {
        case .triage: .purple
        case .backlog: Color(.tertiaryLabel)
        case .unstarted: Color(.secondaryLabel)
        case .started: .yellow
        case .completed: .green
        case .canceled, .duplicate: Color(.tertiaryLabel)
        }
    }

    /// Workspace-defined colours arrive as `#rrggbb`. A malformed value falls back to the
    /// accent rather than to black, which would read as a deliberate choice.
    static func hex(_ value: String?) -> Color {
        guard let value else { return .accentColor }
        var trimmed = value.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        guard trimmed.count == 6, let rgb = UInt32(trimmed, radix: 16) else { return .accentColor }
        return Color(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

/// Type scale. Every entry is a Dynamic Type text style rather than a fixed point size, so
/// the whole app scales with the reader's setting.
enum TypeScale {
    static let screenTitle = Font.largeTitle.weight(.bold)
    static let sectionTitle = Font.headline
    static let rowTitle = Font.body
    static let rowMeta = Font.footnote
    static let identifier = Font.system(.footnote, design: .monospaced)
    static let body = Font.body
}
