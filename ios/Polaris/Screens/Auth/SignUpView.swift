import SwiftUI
import PolarisCore

/// Creating an account.
///
/// The invitation field is optional and explained rather than hidden, because on a default
/// install it is the thing that decides whether this form can succeed at all: registration
/// mode is `invite`, under which only an invitation holder and the very first account on an
/// empty server may register. A refusal here is policy, not a fault, and the copy says so.
struct SignUpView: View {
    @Environment(AppModel.self) private var model

    @State private var displayName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var inviteToken = ""
    @State private var isSubmitting = false
    @State private var error: PolarisError?
    @State private var left: Set<Field> = []
    @FocusState private var focused: Field?

    private enum Field: Hashable { case name, email, password, invite }

    /// What holds the button closed.
    private var blockingProblem: String? {
        if displayName.trimmingCharacters(in: .whitespaces).isEmpty { return "Enter your name" }
        // `contains("@")` accepted a bare "@". Not full RFC validation — the server is the
        // authority — just enough that an obviously-wrong address is caught here rather than
        // after a round trip.
        if !isPlausibleEmail(email) { return "Enter a valid email address" }
        if password.count < 8 { return "Use at least 8 characters" }
        return nil
    }

    /// The same reason said out loud — but only once it is fair to say it. Printing "enter
    /// your name" under an untouched empty form is scolding somebody for not having typed yet.
    private var visibleProblem: String? {
        guard let blockingProblem else { return nil }
        switch blockingProblem {
        case "Enter your name": return left.contains(.name) ? blockingProblem : nil
        case "Enter a valid email address":
            return left.contains(.email) && !email.isEmpty ? blockingProblem : nil
        default: return left.contains(.password) && !password.isEmpty ? blockingProblem : nil
        }
    }

    private func isPlausibleEmail(_ value: String) -> Bool {
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1]
        return domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")
    }

    var body: some View {
        AuthScaffold(eyebrow: "Get started", title: "Create your ", accent: "account") {
            VStack(spacing: 12) {
                TextField("", text: $displayName, prompt: prompt("Your name"))
                    .darkField()
                    .textContentType(.name)
                    .focused($focused, equals: .name)
                    .submitLabel(.next)
                    .onSubmit { focused = .email }
                    .accessibilityLabel("Your name")

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

                SecureField("", text: $password, prompt: prompt("Password, 8 characters or more"))
                    .darkField()
                    .textContentType(.newPassword)
                    .focused($focused, equals: .password)
                    .submitLabel(.next)
                    .onSubmit { focused = .invite }
                    .accessibilityLabel("Password")

                TextField("", text: $inviteToken, prompt: prompt("Invitation code (optional)"))
                    .darkField()
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .invite)
                    .submitLabel(.go)
                    .onSubmit(submit)
                    .accessibilityLabel("Invitation code, optional")

                Text("Most Polaris servers are invite-only. Leave this blank if you are setting up a brand-new server — the first account never needs one.")
                    .bodyFont(11.5)
                    .foregroundStyle(Theme.eyebrowText)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 2)

                if let message = error?.displayMessage ?? visibleProblem {
                    InlineErrorLabel(text: message)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            PrimaryButton(
                title: "Create account",
                isBusy: isSubmitting,
                isEnabled: blockingProblem == nil,
                action: submit
            )
        }
        .onAppear { focused = .name }
        .onChange(of: focused) { previous, _ in
            if let previous { left.insert(previous) }
        }
        // A server refusal that outlives the thing it was about is just noise. Clearing on
        // the next edit means the reader sees their correction take effect.
        .onChange(of: email) { _, _ in error = nil }
        .onChange(of: password) { _, _ in error = nil }
        .onChange(of: inviteToken) { _, _ in error = nil }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Color.white.opacity(0.4))
    }

    private func submit() {
        guard blockingProblem == nil, !isSubmitting else { return }
        focused = nil
        isSubmitting = true
        error = nil
        Task {
            let failure = await model.register(
                email: email.trimmingCharacters(in: .whitespaces),
                password: password,
                inviteToken: inviteToken.trimmingCharacters(in: .whitespaces),
                displayName: displayName.trimmingCharacters(in: .whitespaces)
            )
            isSubmitting = false
            if let failure { withAnimation(Theme.easing(0.3)) { error = failure } }
        }
    }
}
