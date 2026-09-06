import SwiftUI
import PolarisCore

/// Who an issue goes to, for the composer: a searchable list of the workspace's people, with
/// "Unassigned" at the top and the reader pinned under it, the way Linear's assignee picker
/// is laid out.
///
/// A sheet rather than a menu because a workspace has more people than a menu can hold, and
/// because a menu cannot be searched. Named apart from the detail screen's private
/// `AssigneePicker`, which is a menu over the same people.
struct PeoplePicker: View {
    let people: [User]
    /// The reader, so their row sits first and reads "you".
    let me: User?
    @Binding var selection: String?
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [User] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let ordered = people.sorted { left, right in
            if left.id == me?.id { return true }
            if right.id == me?.id { return false }
            return left.displayName.localizedCaseInsensitiveCompare(right.displayName) == .orderedAscending
        }
        guard !needle.isEmpty else { return ordered }
        return ordered.filter {
            $0.displayName.localizedCaseInsensitiveContains(needle)
                || $0.name.localizedCaseInsensitiveContains(needle)
                || ($0.email?.localizedCaseInsensitiveContains(needle) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    row(user: nil, title: String(localized: "Unassigned"), subtitle: nil, isSelected: selection == nil) {
                        pick(nil)
                    }
                }
                ForEach(filtered) { person in
                    row(
                        user: person,
                        title: person.id == me?.id
                            ? String(localized: "\(person.displayName) (you)")
                            : person.displayName,
                        subtitle: person.name,
                        isSelected: selection == person.id
                    ) {
                        pick(person.id)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("Search people")
            )
            .navigationTitle(Text("Assignee"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .tint(Theme.accentBright)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func pick(_ id: String?) {
        selection = id
        dismiss()
    }

    private func row(
        user: User?,
        title: String,
        subtitle: String?,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: Theme.Space.sm + 2) {
                AvatarView(user: user, size: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(PolarisText.rowTitle)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    if let subtitle, !subtitle.isEmpty, subtitle != title {
                        Text(subtitle)
                            .font(PolarisText.captionSmall)
                            .foregroundStyle(Theme.textTertiary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.accentBright)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(Theme.hairline)
        .frame(minHeight: Theme.rowHeight - Theme.Space.sm)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("assignee.\(user?.id ?? "none")")
    }
}
