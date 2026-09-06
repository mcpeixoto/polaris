import SwiftUI
import PolarisCore

/// The composer, shaped like Linear's: the team as a pill at the top, a big title, a
/// description, and the properties as a row of pills that sits above the keyboard.
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
                    VStack(alignment: .leading, spacing: Theme.Space.md) {
                        teamPill

                        TextField(
                            "",
                            text: $title,
                            prompt: prompt("Issue title"),
                            axis: .vertical
                        )
                        .lineLimit(1...3)
                        .font(PolarisText.issueTitle)
                        .foregroundStyle(Theme.textPrimary)
                        .tint(Theme.accentBright)
                        .focused($focused, equals: .title)
                        .accessibilityLabel("Issue title")

                        TextField(
                            "",
                            text: $details,
                            prompt: prompt("Add description…"),
                            axis: .vertical
                        )
                        .lineLimit(3...12)
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.textPrimary)
                        .tint(Theme.accentBright)
                        .focused($focused, equals: .details)
                        .accessibilityLabel("Description")

                        if let error {
                            InlineErrorLabel(text: error.displayMessage)
                        }
                    }
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.top, Theme.Space.md)
                    .padding(.bottom, Theme.Space.xxl)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
            // Pinned under the text and over the keyboard, where the thumb already is.
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 0) {
                    HairlineDivider()
                    propertyPills
                        .padding(.horizontal, Theme.Space.lg)
                        .padding(.vertical, Theme.Space.sm)
                }
                .background(Theme.background)
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
                            Text("Create").font(.system(.body).weight(.semibold))
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

    /// Which team the issue goes to, as the pill at the top-left of the sheet.
    private var teamPill: some View {
        HStack {
            Picker(selection: $teamId) {
                // A nil tag so the picker has a valid selection before a team is chosen;
                // without it SwiftUI shows an empty row.
                Text("Choose a team").tag(String?.none)
                ForEach(teams) { team in
                    Text("\(team.key) · \(team.name)").tag(String?.some(team.id))
                }
            } label: {
                Text("Team")
            }
            .pickerStyle(.menu)
            .tint(Theme.textPrimary)
            .font(.system(.footnote).weight(.medium))
            .padding(.horizontal, Theme.Space.xs)
            .frame(minHeight: 28)
            .background(Theme.raised)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            Spacer(minLength: 0)
        }
    }

    /// Status, priority, and whether it is yours. Menu pickers in pill clothing, so the
    /// labels the platform reads out are still "Status" and "Priority".
    private var propertyPills: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Theme.Space.sm) {
                pill {
                    Picker(selection: $stateId) {
                        Text("Team default").tag(String?.none)
                        ForEach(states) { state in
                            Text(state.name).tag(String?.some(state.id))
                        }
                    } label: {
                        Text("Status")
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("compose.status")
                }

                pill {
                    Picker(selection: $priority) {
                        ForEach(Priority.allCases, id: \.self) { value in
                            Text(value.label).tag(value)
                        }
                    } label: {
                        Text("Priority")
                    }
                    .pickerStyle(.menu)
                }

                // Defaulted on, and offered rather than assumed. This screen is reached from
                // My Issues, which the server filters strictly by assignee — so an unassigned
                // issue is created, appears once because the store appends it locally, and
                // then vanishes on the next load. That reads as data loss.
                Toggle(isOn: $assignToMe) {
                    HStack(spacing: Theme.Space.xs + 2) {
                        Image(systemName: assignToMe ? "person.fill" : "person")
                            .font(.system(size: 12))
                        Text("Assign to me")
                            .font(.system(.footnote).weight(.medium))
                    }
                    .foregroundStyle(assignToMe ? Theme.accentBright : Theme.textSecondary)
                    .padding(.horizontal, Theme.Space.sm + 2)
                    .frame(minHeight: 30)
                    .background(assignToMe ? Theme.accentTint : Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                            .stroke(assignToMe ? Theme.accent : Theme.border, lineWidth: 1)
                    )
                }
                .toggleStyle(.button)
                .buttonStyle(PressableStyle())
            }
        }
        .scrollIndicators(.hidden)
    }

    private func pill<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .tint(Theme.textPrimary)
            .font(.system(.footnote).weight(.medium))
            .padding(.horizontal, Theme.Space.xs)
            .frame(minHeight: 30)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
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
