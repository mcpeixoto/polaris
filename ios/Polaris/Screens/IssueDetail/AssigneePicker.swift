import SwiftUI
import PolarisCore

/// A sheet rather than a menu: a workspace's people list is unbounded, and a menu of two
/// hundred names is not a picker.
struct AssigneePicker: View {
    let people: [User]
    let selected: String?
    let onPick: (User?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                    dismiss()
                } label: {
                    row(name: String(localized: "Unassigned"), user: nil, isSelected: selected == nil)
                }
                .listRowBackground(Color.clear)
                .listRowSeparatorTint(Theme.hairline)
                ForEach(people) { person in
                    Button {
                        onPick(person)
                        dismiss()
                    } label: {
                        row(name: person.displayName, user: person, isSelected: person.id == selected)
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Theme.hairline)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(Text("Assignee"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(name: String, user: User?, isSelected: Bool) -> some View {
        HStack(spacing: Theme.Space.md) {
            AvatarView(user: user, size: 24)
                .accessibilityHidden(true)
            Text(name)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
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
