import SwiftUI
import PolarisCore

/// The labels an issue can carry, as a searchable multi-select.
///
/// Each toggle is its own write — `onToggle` fires as the row is tapped rather than on
/// dismiss — for the reason the store gives: two people adding different labels a second
/// apart must both win, and a picker that sends the whole list on Done would have the
/// second overwrite the first.
struct LabelPicker: View {
    let labels: [PolarisCore.Label]
    let selected: Set<String>
    let onToggle: (PolarisCore.Label, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if filtered.isEmpty {
                    Text(labels.isEmpty ? "This team has no labels." : "No label matches.")
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.textTertiary)
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(filtered) { label in
                        let isOn = selected.contains(label.id)
                        Button {
                            onToggle(label, !isOn)
                        } label: {
                            row(label, isOn: isOn)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Theme.hairline)
                        .accessibilityLabel(Text(label.name))
                        .accessibilityValue(Text(isOn ? "Selected" : "Not selected"))
                        .accessibilityAddTraits(isOn ? [.isSelected] : [])
                        .accessibilityIdentifier("label.option.\(label.name)")
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .safeAreaInset(edge: .top, spacing: 0) {
                searchField
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.vertical, Theme.Space.sm)
                    .background(Theme.background)
            }
            .navigationTitle(Text("Labels"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: {
                        Text("Done").font(.system(.body).weight(.semibold))
                    }
                    .tint(Theme.accentBright)
                    .accessibilityIdentifier("labelPicker.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var filtered: [PolarisCore.Label] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return labels }
        return labels.filter { $0.name.localizedCaseInsensitiveContains(needle) }
    }

    private var searchField: some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
                .accessibilityHidden(true)
            TextField(
                "",
                text: $query,
                prompt: Text("Search labels").foregroundStyle(Theme.placeholder)
            )
            .font(PolarisText.body)
            .foregroundStyle(Theme.textPrimary)
            .tint(Theme.accentBright)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .accessibilityIdentifier("labelPicker.search")
        }
        .padding(.horizontal, Theme.Space.md)
        .frame(minHeight: 36)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.fieldFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }

    private func row(_ label: PolarisCore.Label, isOn: Bool) -> some View {
        HStack(spacing: Theme.Space.md) {
            Circle()
                .fill(Theme.hex(label.color))
                .frame(width: 9, height: 9)
            Text(label.name)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 0)
            if isOn {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.accentBright)
            }
        }
        .frame(minHeight: Theme.rowHeight - Theme.Space.lg)
        .contentShape(Rectangle())
    }
}
