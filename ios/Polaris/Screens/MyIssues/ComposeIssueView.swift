import SwiftUI
import PolarisCore

struct ComposeIssueView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var details = ""
    @State private var teamId: String?
    @State private var priority: Priority = .none
    @State private var isSaving = false
    @State private var error: PolarisError?
    @FocusState private var focused: Field?

    private enum Field: Hashable { case title, details }

    private var teams: [Team] { model.workspaceData.teams.value ?? [] }
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
                    Button("Cancel") { dismiss() }
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
                focused = .title
            }
        }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Color.white.opacity(0.4))
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
                    description: details,
                    priority: priority
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
