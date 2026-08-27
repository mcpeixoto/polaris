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
    /// The field the reader most recently moved away from. Its complaint is shown first,
    /// because an error about a field you just left is the one you can act on — being told
    /// "enter your name" the moment you leave the *password* field answers a question nobody
    /// asked and buries the one they did.
    @State private var lastLeft: Field?
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

    /// The first problem belonging to a field the reader has already left.
    ///
    /// Not simply `blockingProblem` gated on one field: that showed the first problem in a
    /// fixed order and only if *that* field had been visited, so filling the password first
    /// and leaving it said nothing at all — the name was still empty, so the name's complaint
    /// won, and the name had never been focused, so it was suppressed. The reader got
    /// silence and a dead button.
    ///
    /// Each field still speaks only once it has been left, so an untouched form scolds nobody.
    private var visibleProblem: String? {
        if let lastLeft, let problem = problem(for: lastLeft) { return problem }
        // Otherwise the first outstanding complaint among fields already visited, so a form
        // that is still incomplete says so rather than going quiet.
        for field in [Field.name, .email, .password] where field != lastLeft {
            if let problem = problem(for: field) { return problem }
        }
        return nil
    }

    /// A field's complaint, or nil — and always nil until the reader has left it, so an
    /// untouched form scolds nobody.
    private func problem(for field: Field) -> String? {
        guard left.contains(field) else { return nil }
        switch field {
        case .name:
            return displayName.trimmingCharacters(in: .whitespaces).isEmpty ? "Enter your name" : nil
        case .email:
            return !email.isEmpty && !isPlausibleEmail(email) ? "Enter a valid email address" : nil
        case .password:
            return !password.isEmpty && password.count < 8 ? "Use at least 8 characters" : nil
        case .invite:
            return nil
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
            if let previous {
                left.insert(previous)
                lastLeft = previous
            }
        }
        // A server refusal that outlives the thing it was about is just noise. Clearing on
        // the next edit means the reader sees their correction take effect.
        .onChange(of: email) { _, _ in error = nil }
        .onChange(of: password) { _, _ in error = nil }
        .onChange(of: inviteToken) { _, _ in error = nil }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Theme.placeholder)
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
