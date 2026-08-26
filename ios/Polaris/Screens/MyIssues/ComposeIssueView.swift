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

    private var teams: [Team] { model.workspaceData.teams.value ?? [] }
    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && teamId != nil
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Issue title", text: $title, axis: .vertical)
                        .lineLimit(1...3)
                    TextField("Description", text: $details, axis: .vertical)
                        .lineLimit(3...8)
                }

                Section {
                    Picker("Team", selection: $teamId) {
                        // Nil tag included so the picker has a valid selection before a team
                        // is chosen; without it SwiftUI silently shows an empty selection.
                        Text("Choose a team").tag(String?.none)
                        ForEach(teams) { team in
                            Text("\(team.key) · \(team.name)").tag(String?.some(team.id))
                        }
                    }
                    Picker("Priority", selection: $priority) {
                        ForEach(Priority.allCases, id: \.self) { value in
                            Text(value.label).tag(value)
                        }
                    }
                }

                if let error {
                    Section {
                        Text(error.displayMessage).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Issue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", action: save).disabled(!canSave)
                }
            }
            .onAppear {
                if teamId == nil { teamId = teams.first?.id }
            }
        }
    }

    private func save() {
        guard let teamId else { return }
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
                error = failure
            } catch {
                self.error = .badResponse
            }
            isSaving = false
        }
    }
}
