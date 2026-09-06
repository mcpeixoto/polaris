import SwiftUI
import PolarisCore

/// The projects an issue on this team can belong to, open ones first, with the status glyph
/// the web's project rows carry so a completed project reads as one before it is tapped.
struct ProjectPicker: View {
    let projects: [Project]
    let selected: String?
    let onPick: (ProjectRef?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                    dismiss()
                } label: {
                    row(name: String(localized: "No project"), symbol: "circle.dashed", tint: Theme.textSecondary, isSelected: selected == nil)
                }
                .listRowBackground(Color.clear)
                .listRowSeparatorTint(Theme.hairline)
                .accessibilityIdentifier("projectPicker.none")

                ForEach(projects) { project in
                    Button {
                        onPick(project.ref)
                        dismiss()
                    } label: {
                        row(
                            name: project.name,
                            symbol: project.status.category.symbolName,
                            tint: Theme.hex(project.status.color),
                            isSelected: project.id == selected
                        )
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Theme.hairline)
                    .accessibilityLabel(Text("\(project.name), \(project.status.name)"))
                    .accessibilityIdentifier("projectPicker.option.\(project.name)")
                }

                if projects.isEmpty {
                    Text("This team has no projects.")
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.textTertiary)
                        .listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(Text("Project"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(name: String, symbol: String, tint: Color, isSelected: Bool) -> some View {
        HStack(spacing: Theme.Space.md) {
            Image(systemName: symbol)
                .font(.system(size: 14))
                .foregroundStyle(tint)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(name)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.accentBright)
            }
        }
        .frame(minHeight: Theme.rowHeight - Theme.Space.lg)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
