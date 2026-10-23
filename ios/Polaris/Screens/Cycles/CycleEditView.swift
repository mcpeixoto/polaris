import SwiftUI
import PolarisCore

/// Editing a cycle: its name, its description, and whichever of its two ends the server will
/// still accept.
///
/// There is no create half, deliberately. Cycles are minted by `updateTeamCycles` from a
/// team's cadence — there is no `createCycle` in the schema — so a "New cycle" button here
/// would be a button for a mutation that does not exist.
///
/// A short form of its own rather than one built like `ProjectComposeView`: three fields and
/// two date pickers fit an inset-grouped list, and a list is where iOS puts a disabled row
/// with an explanation under it, which is the whole point of this screen.
struct CycleEditView: View {
    let cycle: Cycle
    /// Performs the write and hands back a refusal, or nil. The caller's, because the result
    /// has to land in the store whose header sits behind this sheet.
    let perform: (CycleChange) async -> PolarisError?

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var details: String
    @State private var startsAt: Date
    @State private var endsAt: Date
    @State private var isSaving = false
    @State private var error: PolarisError?
    @FocusState private var focused: Field?

    private enum Field: Hashable { case name, details }

    init(cycle: Cycle, perform: @escaping (CycleChange) async -> PolarisError?) {
        self.cycle = cycle
        self.perform = perform
        _name = State(initialValue: cycle.name)
        _details = State(initialValue: cycle.description ?? "")
        _startsAt = State(initialValue: cycle.startsAt)
        _endsAt = State(initialValue: cycle.endsAt)
    }

    /// `UpdateCycleInput`'s own rules, read off the cycle rather than guessed at. A field the
    /// server will refuse is disabled here instead, because letting somebody fill in a sheet
    /// and then telling them no is the version of this screen worth avoiding.
    private var canEditStart: Bool { cycle.allowsStartEdit() }
    private var canEditEnd: Bool { cycle.allowsEndEdit() }

    private var hasChanges: Bool {
        name != cycle.name
            || details != (cycle.description ?? "")
            || (canEditStart && startsAt != cycle.startsAt)
            || (canEditEnd && endsAt != cycle.endsAt)
    }

    private var canSave: Bool { hasChanges && !isSaving && endsAt > startsAt }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField(
                        "",
                        text: $name,
                        prompt: Text(verbatim: "Cycle \(cycle.number)").foregroundStyle(Theme.placeholder)
                    )
                    .focused($focused, equals: .name)
                    .accessibilityLabel("Cycle name")
                    .accessibilityIdentifier("cycleEdit.name")

                    TextField(
                        "",
                        text: $details,
                        prompt: Text("What this cycle is for").foregroundStyle(Theme.placeholder),
                        axis: .vertical
                    )
                    .lineLimit(2...6)
                    .focused($focused, equals: .details)
                    .accessibilityLabel("Description")
                    .accessibilityIdentifier("cycleEdit.details")
                } header: {
                    header(String(localized: "Name"))
                } footer: {
                    // Naming is the one thing every cycle allows, whatever its dates do.
                    footer(String(localized: "A cycle with no name is shown as its number."))
                }

                Section {
                    DatePicker(
                        "Starts",
                        selection: $startsAt,
                        displayedComponents: .date
                    )
                    .disabled(!canEditStart)
                    .accessibilityIdentifier("cycleEdit.startsAt")

                    DatePicker(
                        "Ends",
                        selection: $endsAt,
                        in: startsAt...,
                        displayedComponents: .date
                    )
                    .disabled(!canEditEnd)
                    .accessibilityIdentifier("cycleEdit.endsAt")
                } header: {
                    header(String(localized: "Dates"))
                } footer: {
                    footer(datesFooter)
                        .accessibilityIdentifier("cycleEdit.dates.footer")
                }

                if let error {
                    Section {
                        InlineErrorLabel(text: error.displayMessage)
                            .listRowBackground(Color.clear)
                            .accessibilityIdentifier("cycleEdit.error")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .tint(Theme.accentBright)
            .navigationTitle(Text("Edit Cycle"))
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
                            Text("Save").font(.system(.body).weight(.semibold))
                        }
                    }
                    .tint(Theme.accentBright)
                    .disabled(!canSave)
                    .accessibilityIdentifier("cycleEdit.save")
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    /// The same section band and footnote the settings screens use, so an edit sheet and a
    /// preferences list read as one product.
    private func header(_ title: String) -> some View {
        Text(title)
            .font(PolarisText.sectionTitle)
            .foregroundStyle(Theme.textTertiary)
            .textCase(nil)
    }

    private func footer(_ text: String) -> some View {
        Text(text)
            .font(PolarisText.captionSmall)
            .foregroundStyle(Theme.textTertiary)
    }

    /// Which of the two dates is frozen, and why. The server's rule stated as a fact about
    /// this cycle, so a greyed-out row is never a mystery.
    private var datesFooter: String {
        switch (canEditStart, canEditEnd) {
        case (true, true):
            String(localized: "This cycle hasn't started, so both ends can still move.")
        case (false, true):
            String(localized: "This cycle is running. Its start is fixed; its end can still move.")
        default:
            String(localized: "This cycle has ended. Neither date can be changed now.")
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        error = nil
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        let hadDescription = (cycle.description ?? "").isEmpty == false
        let change = CycleChange(
            id: cycle.id,
            name: trimmedName == cycle.name ? nil : trimmedName,
            description: trimmedDetails.isEmpty || trimmedDetails == cycle.description
                ? nil
                : trimmedDetails,
            // The one `clear…` flag the input has, for `IssueChange`'s reason: an emptied
            // field has to say "remove it" rather than "leave it alone".
            clearDescription: trimmedDetails.isEmpty && hadDescription,
            // Never sent for a date the server considers immutable, even if something got
            // past the disabled control — `updateCycle` refuses the whole change for one
            // frozen field, which would lose the rename alongside it.
            startsAt: canEditStart && startsAt != cycle.startsAt ? startsAt : nil,
            endsAt: canEditEnd && endsAt != cycle.endsAt ? endsAt : nil
        )
        Task {
            let failure = await perform(change)
            if let failure {
                withAnimation(Theme.easing(0.3)) { error = failure }
            } else {
                dismiss()
            }
            isSaving = false
        }
    }
}
