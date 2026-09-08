import SwiftUI
import PolarisCore

/// First-run (and change-server) flow: welcome → Cloud vs own server → optional address.
///
/// Matches the desktop `ConnectServer` steps and copy. Account CTAs stay on `WelcomeView`
/// after an origin is persisted.
struct ConnectServerView: View {
    let onConnect: (URL) -> Void

    @State private var step: Step = .welcome
    @State private var address = ""
    @State private var fieldError: String?
    @State private var isBusy = false
    @FocusState private var addressFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Step: Equatable {
        case welcome, choose, address
    }

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .welcome: welcomeStep
                case .choose: chooseStep
                case .address: addressStep
                }
            }
            .animation(reduceMotion ? nil : Theme.easing(0.35), value: step)
        }
    }

    // MARK: - Welcome

    private var welcomeStep: some View {
        AuthScaffold(
            eyebrow: "Polaris",
            title: "Hi. This is ",
            accent: "Polaris."
        ) {
            Text("Issue tracking without the wait — keyboard-first, local-first, for software teams.")
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        } footer: {
            PrimaryButton(title: "Continue") {
                step = .choose
            }
            .accessibilityIdentifier("connect.continue")
        }
    }

    // MARK: - Choose

    private var chooseStep: some View {
        AuthScaffold(
            eyebrow: "Connect",
            title: "Where should Polaris ",
            accent: "connect?"
        ) {
            Text("Polaris Cloud is hosted for you. Or point this app at a server you run.")
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        } footer: {
            VStack(spacing: Theme.Space.sm) {
                PrimaryButton(title: "Polaris Cloud", isBusy: isBusy) {
                    connect(to: ServerPreference.hostedCloudOrigin)
                }
                .accessibilityIdentifier("connect.cloud")

                SecondaryButton(title: "Use your own server") {
                    step = .address
                }
                .disabled(isBusy)
                .accessibilityIdentifier("connect.ownServer")
            }
        }
    }

    // MARK: - Address

    private var addressStep: some View {
        AuthScaffold(
            eyebrow: "Your server",
            title: "Connect to your ",
            accent: "server"
        ) {
            VStack(spacing: 12) {
                TextField("", text: $address, prompt: prompt("polaris.acme.com"))
                    .darkField()
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($addressFocused)
                    .submitLabel(.go)
                    .onSubmit(submitAddress)
                    .onChange(of: address) { _, _ in fieldError = nil }
                    .accessibilityLabel("Server address")
                    .accessibilityIdentifier("connect.address")

                if let fieldError {
                    InlineErrorLabel(text: fieldError)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            VStack(spacing: Theme.Space.sm) {
                PrimaryButton(
                    title: "Connect",
                    isBusy: isBusy,
                    isEnabled: !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    action: submitAddress
                )
                .accessibilityIdentifier("connect.submit")

                SecondaryButton(title: "Back") {
                    fieldError = nil
                    step = .choose
                }
                .disabled(isBusy)
                .accessibilityIdentifier("connect.back")
            }
        }
        .onAppear { addressFocused = true }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Theme.textTertiary)
    }

    private func submitAddress() {
        switch ServerPreference.normaliseServerURL(address) {
        case .failure(let error):
            fieldError = error.message
            addressFocused = true
        case .success(let origin):
            fieldError = nil
            connect(to: origin)
        }
    }

    private func connect(to origin: URL) {
        guard !isBusy else { return }
        isBusy = true
        // No reachability probe — same deliberate choice as desktop. Sign-in makes the real
        // request and reports a real failure.
        onConnect(origin)
    }
}
