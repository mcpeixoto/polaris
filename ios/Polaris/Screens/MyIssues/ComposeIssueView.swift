import SwiftUI
import PolarisCore

struct ComposeIssueView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var details = ""
    @State private var teamId: String?
    @State private var priority: Priority = .none
    /// The status the issue is created in. Nil means "the team's default", which is what the
    /// server picks when `stateId` is absent — offering a status picker that cannot express
    /// "leave it to the workspace" would be a worse default than not offering one.
    @State private var stateId: String?
    @State private var assignToMe = true
    @State private var isSaving = false
    @State private var error: PolarisError?
    @State private var isConfirmingDiscard = false
    @FocusState private var focused: Field?

    private enum Field: Hashable { case title, details }

    private var teams: [Team] { model.workspaceData.teams.value ?? [] }
    private var states: [WorkflowState] {
        guard let teamId else { return [] }
        return model.workspaceData.states(forTeam: teamId)
    }

    private var hasDraft: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && teamId != nil
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        TextField(
                            "",
                            text: $title,
                            prompt: prompt("What needs doing?"),
                            axis: .vertical
                        )
                        .lineLimit(1...3)
                        .bodyFont(18, weight: .semibold)
                        .foregroundStyle(Theme.textPrimary)
                        .tint(Theme.accentBright)
                        .focused($focused, equals: .title)
                        .accessibilityLabel("Issue title")

                        TextField(
                            "",
                            text: $details,
                            prompt: prompt("Add detail (optional)"),
                            axis: .vertical
                        )
                        .lineLimit(3...10)
                        .bodyFont(14)
                        .foregroundStyle(Theme.textSecondary)
                        .tint(Theme.accentBright)
                        .focused($focused, equals: .details)
                        .accessibilityLabel("Description")

                        HairlineDivider()

                        Card {
                            VStack(spacing: 0) {
                                Picker(selection: $teamId) {
                                    // A nil tag so the picker has a valid selection before a
                                    // team is chosen; without it SwiftUI shows an empty row.
                                    Text("Choose a team").tag(String?.none)
                                    ForEach(teams) { team in
                                        Text("\(team.key) · \(team.name)").tag(String?.some(team.id))
                                    }
                                } label: {
                                    Text("Team").bodyFont(14).foregroundStyle(Theme.textSecondary)
                                }
                                .tint(Theme.accentBright)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 4)

                                HairlineDivider().padding(.horizontal, 16)

                                // Defaulted on, and offered rather than assumed. This screen
                                // is reached from My Issues, which the server filters strictly
                                // by assignee — so an unassigned issue is created, appears once
                                // because the store appends it locally, and then vanishes on
                                // the next load. That reads as data loss.
                                Toggle(isOn: $assignToMe) {
                                    Text("Assign to me")
                                        .bodyFont(14)
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                .tint(Theme.accent)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)

                                HairlineDivider().padding(.horizontal, 16)

                                Picker(selection: $stateId) {
                                    Text("Team default").tag(String?.none)
                                    ForEach(states) { state in
                                        Text(state.name).tag(String?.some(state.id))
                                    }
                                } label: {
                                    Text("Status").bodyFont(14).foregroundStyle(Theme.textSecondary)
                                }
                                .tint(Theme.accentBright)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 4)
                                .accessibilityIdentifier("compose.status")

                                HairlineDivider().padding(.horizontal, 16)

                                Picker(selection: $priority) {
                                    ForEach(Priority.allCases, id: \.self) { value in
                                        Text(value.label).tag(value)
                                    }
                                } label: {
                                    Text("Priority").bodyFont(14).foregroundStyle(Theme.textSecondary)
                                }
                                .tint(Theme.accentBright)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 4)
                            }
                        }

                        if let error {
                            InlineErrorLabel(text: error.displayMessage)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle("New Issue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        // Typed work is gone on reopen — the state is not preserved — so
                        // discarding it silently is a small data loss with no undo.
                        if hasDraft { isConfirmingDiscard = true } else { dismiss() }
                    }
                    .tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSaving {
                            ProgressView().tint(Theme.accentBright)
                        } else {
                            Text("Create").bodyFont(15, weight: .bold)
                        }
                    }
                    .tint(Theme.accentBright)
                    .disabled(!canSave)
                }
            }
            .onAppear {
                if teamId == nil { teamId = teams.first?.id }
            }
            // Not `.onAppear`. Setting @FocusState in the same runloop turn a sheet presents
            // frequently no-ops on iOS: the keyboard does not come up and the reader taps the
            // field themselves. The auth screens get away with it because they are pushed.
            .task {
                try? await Task.sleep(for: .milliseconds(350))
                focused = .title
            }
            // Teams may not have loaded when the sheet opens. Without this the selection stays
            // nil for ever and Create is permanently disabled with nothing explaining why.
            .onChange(of: teams) { _, loaded in
                if teamId == nil { teamId = loaded.first?.id }
            }
            // A state belongs to one team. Keeping the selection across a team change would
            // send the new team an id it does not own, which the server refuses.
            .onChange(of: teamId) { _, _ in stateId = nil }
            .presentationDragIndicator(.visible)
            .confirmationDialog(
                "Discard this issue?",
                isPresented: $isConfirmingDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("What you have typed will not be saved.")
            }
        }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Theme.placeholder)
    }

    private func save() {
        guard canSave, let teamId else { return }
        isSaving = true
        error = nil
        Task {
            do {
                let draft = IssueDraft(
                    teamId: teamId,
                    title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                    // Trimmed like the title. An untrimmed body stores the reader's stray
                    // trailing newlines and renders them back on the detail screen.
                    description: details.trimmingCharacters(in: .whitespacesAndNewlines),
                    priority: priority,
                    stateId: stateId,
                    assigneeId: assignToMe ? model.currentUser?.id : nil
                )
                _ = try await model.issues.create(draft)
                dismiss()
            } catch let failure as PolarisError {
                withAnimation(Theme.easing(0.3)) { error = failure }
            } catch {
                withAnimation(Theme.easing(0.3)) { self.error = .badResponse }
            }
            isSaving = false
        }
    }
}
