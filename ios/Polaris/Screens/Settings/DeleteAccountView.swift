import SwiftUI
import PolarisCore

/// Account deletion, on its own screen so the path from Settings is a navigation the
/// review recording can follow: open it, read what it does, confirm.
struct DeleteAccountView: View {
    @Environment(AppModel.self) private var model
    @State private var isConfirming = false
    @State private var isDeleting = false
    @State private var failure: PolarisError?

    var body: some View {
        List {
            Section {
                Text("This deletes your login and signs you out on every device. Your name comes off every workspace you belong to. Issues and comments stay, under Deleted user.")
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textSecondary)
                Text("If you are the last owner of a workspace that still has other people, make somebody else an admin first.")
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textSecondary)
            }
            if let failure {
                Section {
                    InlineErrorLabel(text: failure.displayMessage)
                }
            }
            Section {
                Button {
                    isConfirming = true
                } label: {
                    Text("Delete account")
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isDeleting)
                .accessibilityIdentifier("deleteAccount.confirm")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Delete account"))
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            Text("Delete your account?"),
            isPresented: $isConfirming,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await delete() }
            } label: {
                Text("Delete account")
            }
            .accessibilityIdentifier("deleteAccount.commit")
            Button(role: .cancel) {} label: { Text("Cancel") }
        } message: {
            Text("This cannot be undone.")
        }
    }

    private func delete() async {
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await model.api.deleteAccount()
            await model.signOut()
        } catch let error as PolarisError {
            failure = error
        } catch {
            failure = .badResponse
        }
    }
}
