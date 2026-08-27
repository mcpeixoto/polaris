import SwiftUI
import PolarisCore

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var error: PolarisError?
    @FocusState private var focused: Field?

    private enum Field: Hashable { case email, password }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    var body: some View {
        AuthScaffold(
            eyebrow: "Welcome back",
            title: "Sign in to ",
            accent: "Polaris"
        ) {
            VStack(spacing: 12) {
                TextField("", text: $email, prompt: prompt("you@company.com"))
                    .darkField()
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focused = .password }
                    .accessibilityLabel("Email")

                SecureField("", text: $password, prompt: prompt("Password"))
                    .darkField()
                    .textContentType(.password)
                    .focused($focused, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(submit)
                    .accessibilityLabel("Password")

                if let error {
                    InlineErrorLabel(text: error.displayMessage)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            PrimaryButton(title: "Sign in", isBusy: isSubmitting, isEnabled: canSubmit, action: submit)
        }
        .onAppear { focused = .email }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Theme.placeholder)
    }

    private func submit() {
        guard canSubmit, !isSubmitting else { return }
        focused = nil
        isSubmitting = true
        error = nil
        Task {
            let failure = await model.signIn(
                email: email.trimmingCharacters(in: .whitespaces),
                password: password
            )
            isSubmitting = false
            // Only surface it here; a success replaces this whole screen from the root.
            if let failure { withAnimation(Theme.easing(0.3)) { error = failure } }
        }
    }
}
