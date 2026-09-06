import SwiftUI
import PolarisCore

/// The reader's own account: the picture, the two names they can change, and the email they
/// cannot.
///
/// Email is read-only on purpose. It is the sign-in identity and changing it is a verified
/// flow the server does not expose over `updateProfile`; a field that looks editable and
/// silently is not would be worse than a plain row.
struct ProfileView: View {
    /// The account as the screen behind this one knows it, updated on save so the two do not
    /// disagree until the next viewer load.
    @Binding var user: User
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var displayName: String
    @State private var name: String
    @State private var isSaving = false
    @State private var error: PolarisError?

    init(user: Binding<User>) {
        _user = user
        _displayName = State(initialValue: user.wrappedValue.displayName)
        _name = State(initialValue: user.wrappedValue.name)
    }

    private var isDirty: Bool {
        trimmed(displayName) != user.displayName || trimmed(name) != user.name
    }
    private var canSave: Bool {
        isDirty && !trimmed(displayName).isEmpty && !trimmed(name).isEmpty && !isSaving
    }

    var body: some View {
        List {
            Section {
                HStack {
                    Spacer()
                    // Hidden here: AvatarView's label reads "Assigned to …", which is wrong
                    // on your own account.
                    AvatarView(user: user, size: 72)
                        .accessibilityHidden(true)
                    Spacer()
                }
                .listRowBackground(Color.clear)
            }

            Section {
                field("Display name", text: $displayName, identifier: "profile.displayName")
                field("Name", text: $name, identifier: "profile.name")
            } header: {
                header(String(localized: "Name"))
            } footer: {
                Text("The display name is what everyone sees on issues and comments.")
                    .font(PolarisText.captionSmall)
                    .foregroundStyle(Theme.textTertiary)
            }

            Section {
                HStack {
                    Text("Email")
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Text(user.email ?? "—")
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .accessibilityElement(children: .combine)
            } header: {
                header(String(localized: "Account"))
            }

            if let error {
                Section {
                    InlineErrorLabel(text: error.displayMessage)
                        .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Profile"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(action: save) {
                    if isSaving {
                        ProgressView().tint(Theme.accentBright)
                    } else {
                        Text("Save").font(.system(.body).weight(.semibold))
                    }
                }
                .tint(Theme.accentBright)
                .disabled(!canSave)
                .accessibilityIdentifier("profile.save")
            }
        }
    }

    private func header(_ title: String) -> some View {
        Text(title)
            .font(PolarisText.sectionTitle)
            .foregroundStyle(Theme.textTertiary)
            .textCase(nil)
    }

    private func field(_ label: LocalizedStringKey, text: Binding<String>, identifier: String) -> some View {
        HStack {
            Text(label)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 110, alignment: .leading)
            TextField("", text: text)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .tint(Theme.accentBright)
                .multilineTextAlignment(.trailing)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { if canSave { save() } }
                .accessibilityLabel(Text(label))
                .accessibilityIdentifier(identifier)
        }
    }

    private func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Only what changed goes over the wire — `ProfileChange` is a partial update, and a
    /// field sent unchanged is still a write the audit log records.
    private func save() {
        guard canSave else { return }
        isSaving = true
        error = nil
        let change = ProfileChange(
            name: trimmed(name) != user.name ? trimmed(name) : nil,
            displayName: trimmed(displayName) != user.displayName ? trimmed(displayName) : nil
        )
        Task {
            do {
                user = try await model.api.updateProfile(change)
                displayName = user.displayName
                name = user.name
                dismiss()
            } catch {
                withAnimation(Theme.easing(0.3)) { self.error = PolarisError.mapped(error) }
            }
            isSaving = false
        }
    }
}
