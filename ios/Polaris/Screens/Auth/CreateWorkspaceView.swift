import SwiftUI
import PolarisCore

/// The step after registering, for an account that belongs to no workspace.
///
/// The URL key and team key are derived as you type and stop following once you edit them by
/// hand — deriving forever would overwrite a deliberate choice on the next keystroke of the
/// name. Same rule the web client's create screen uses.
struct CreateWorkspaceView: View {
    @Environment(AppModel.self) private var model

    @State private var name = ""
    @State private var urlKey = ""
    @State private var teamName = "Engineering"
    @State private var teamKey = "ENG"
    @State private var urlKeyEdited = false
    @State private var teamKeyEdited = false
    @State private var isSubmitting = false
    @State private var error: PolarisError?
    @FocusState private var focused: Field?

    private enum Field: Hashable { case name, urlKey, teamName, teamKey }

    private var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !urlKey.isEmpty
            && !teamKey.isEmpty
    }

    var body: some View {
        AuthScaffold(eyebrow: "One last step", title: "Name your ", accent: "workspace") {
            VStack(spacing: 12) {
                labelled("Workspace") {
                    TextField("", text: $name, prompt: prompt("Peixoto Labs"))
                        .darkField()
                        .focused($focused, equals: .name)
                        .accessibilityLabel("Workspace name")
                        .submitLabel(.next)
                        .onSubmit { focused = .teamName }
                        .onChange(of: name) { _, new in
                            if !urlKeyEdited { urlKey = KeyDerivation.urlKey(from: new) }
                        }
                }

                labelled("Address") {
                    HStack(spacing: 0) {
                        Text("\(model.displayHost)/")
                            .bodyFont(14)
                            .foregroundStyle(Theme.eyebrowText)
                        TextField("", text: $urlKey, prompt: prompt("peixoto-labs"))
                            .bodyFont(14, weight: .medium)
                            .foregroundStyle(Theme.textPrimary)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focused, equals: .urlKey)
                            .accessibilityLabel("Workspace address")
                            .onChange(of: urlKey) { _, _ in
                                if focused == .urlKey { urlKeyEdited = true }
                            }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.white.opacity(0.16), lineWidth: 1)
                    )
                }

                labelled("First team") {
                    HStack(spacing: 10) {
                        TextField("", text: $teamName, prompt: prompt("Engineering"))
                            .darkField()
                            .focused($focused, equals: .teamName)
                            .accessibilityLabel("First team name")
                            .onChange(of: teamName) { _, new in
                                if !teamKeyEdited { teamKey = KeyDerivation.teamKey(from: new) }
                            }
                        TextField("", text: $teamKey, prompt: prompt("ENG"))
                            .darkField()
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .frame(width: 92)
                            .focused($focused, equals: .teamKey)
                            .onChange(of: teamKey) { _, _ in
                                if focused == .teamKey { teamKeyEdited = true }
                            }
                            .accessibilityLabel("Team key")
                    }
                }

                Text("The team key prefixes every issue — ENG-1, ENG-2. It is hard to change later.")
                    .bodyFont(11.5)
                    .foregroundStyle(Theme.eyebrowText)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let error {
                    InlineErrorLabel(text: error.displayMessage)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            PrimaryButton(
                title: "Create workspace",
                isBusy: isSubmitting,
                isEnabled: canSubmit,
                action: submit
            )
        }
        .onAppear { focused = .name }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Color.white.opacity(0.4))
    }

    @ViewBuilder
    private func labelled<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoEyebrow(text: label)
            content()
        }
    }

    private func submit() {
        guard canSubmit, !isSubmitting else { return }
        focused = nil
        isSubmitting = true
        error = nil
        Task {
            // The creator's own name, not the workspace's. They are different facts and the
            // server stores them in different tables.
            let person = model.accountDisplayName?.trimmingCharacters(in: .whitespaces)
            let creator = (person?.isEmpty == false ? person! : name.trimmingCharacters(in: .whitespaces))
            let draft = WorkspaceDraft(
                name: name.trimmingCharacters(in: .whitespaces),
                urlKey: urlKey,
                userName: creator,
                userDisplayName: creator,
                firstTeamKey: teamKey.uppercased(),
                firstTeamName: teamName.trimmingCharacters(in: .whitespaces)
            )
            let failure = await model.createWorkspace(draft)
            isSubmitting = false
            if let failure { withAnimation(Theme.easing(0.3)) { error = failure } }
        }
    }
}
