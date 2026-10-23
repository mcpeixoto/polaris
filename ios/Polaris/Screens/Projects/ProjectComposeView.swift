import SwiftUI
import PolarisCore

/// One form for both halves of a project: filing a new one, and editing the one on screen.
///
/// Shaped like `ComposeIssueView` — the name as a big field, the prose under it, and the
/// properties as a row of pills pinned above the keyboard — because the two are the same kind
/// of screen and a reader who has filed an issue should not have to learn a second layout.
///
/// Two things differ between the modes, and both come from the schema rather than from taste:
///
/// - **Teams are a create-time decision.** `CreateProjectInput.teamIds` is `[UUID!]!` and its
///   comment says why it has no default — *a project with no team is invisible to everyone*.
///   So the create half requires at least one and says what happens without it, rather than
///   picking the first team on somebody's behalf. `UpdateProjectInput` has no `teamIds` at
///   all, so the edit half does not offer the control; the detail header lists the teams.
/// - **Who the result belongs to.** A create lands in the workspace's project list, an edit in
///   the detail store whose header sits behind this sheet. Only the caller knows which, so
///   `perform` is the caller's.
struct ProjectComposeView: View {
    enum Mode {
        case create
        case edit(Project)
    }

    /// What the form has collected, in the shape the matching mutation takes.
    enum Request {
        case create(ProjectDraft)
        case update(ProjectChange)
    }

    let mode: Mode
    /// Performs the write and hands back a refusal to show next to the fields, or nil.
    let perform: (Request) async -> PolarisError?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// One store for the process, for `ComposeIssueView.drafts`' reason: the shell makes a new
    /// sheet per opening and a half-typed project has to outlive the sheet.
    private static let drafts = ProjectDraftStore(defaults: LaunchOptions.usesFixtures ? nil : .standard)

    @State private var name = ""
    @State private var summary = ""
    @State private var details = ""
    /// Nil means "the workspace's default status", which is what the server picks when
    /// `statusId` is absent.
    @State private var statusId: String?
    @State private var priority: Priority = .none
    @State private var leadId: String?
    @State private var teamIds: Set<String> = []
    /// Wire calendar days, `2026-10-15`, as `DatePickerSheet` hands them over.
    @State private var startDate: String?
    @State private var targetDate: String?
    @State private var isSaving = false
    @State private var error: PolarisError?
    @State private var isConfirmingDiscard = false
    @State private var isPickingLead = false
    @State private var isPickingTeams = false
    @State private var isPickingStart = false
    @State private var isPickingTarget = false
    @FocusState private var focused: Field?

    private enum Field: Hashable { case name, summary, details }

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private var original: Project? {
        if case .edit(let project) = mode { return project }
        return nil
    }

    private var teams: [Team] { model.workspaceData.teams.value ?? [] }
    private var statuses: [ProjectStatus] { model.workspaceData.projectStatuses.value ?? [] }
    private var people: [User] { model.workspaceData.users.value ?? [] }
    private var lead: User? {
        guard let leadId else { return nil }
        return model.workspaceData.user(id: leadId) ?? original?.lead
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canSave: Bool {
        guard !trimmedName.isEmpty, !isSaving else { return false }
        // The create half cannot proceed without a team; the edit half cannot change them,
        // and will not send a round trip for a sheet nobody touched.
        guard let original else { return !teamIds.isEmpty }
        return hasChanges(from: original)
    }

    /// Whether anything on the sheet differs from the project it was seeded with.
    ///
    /// Save stays grey until it does. `updateProject` with every field nil is a write that
    /// bumps the version and changes nothing — and a Save button that is always live tells
    /// the reader nothing about whether their edit took.
    private func hasChanges(from original: Project) -> Bool {
        trimmedName != original.name
            || blankToNil(summary) != original.summary
            || details.trimmingCharacters(in: .whitespacesAndNewlines) != original.description
            || statusId != original.status.id
            || priority != original.priority
            || leadId != original.leadId
            || startDate != original.startDate
            || targetDate != original.targetDate
    }

    /// Everything on the sheet, as the draft store keeps it.
    private var draft: ProjectComposeDraft {
        ProjectComposeDraft(
            name: name,
            summary: summary,
            details: details,
            statusId: statusId,
            priority: priority.rawValue,
            leadId: leadId,
            teamIds: teamIds.sorted(),
            startDate: startDate,
            targetDate: targetDate
        )
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Space.md) {
                        TextField("", text: $name, prompt: prompt("Project name"), axis: .vertical)
                            .lineLimit(1...3)
                            .font(PolarisText.issueTitle)
                            .foregroundStyle(Theme.textPrimary)
                            .tint(Theme.accentBright)
                            .focused($focused, equals: .name)
                            .accessibilityLabel("Project name")
                            .accessibilityIdentifier("projectCompose.name")

                        TextField("", text: $summary, prompt: prompt("One-line summary"), axis: .vertical)
                            .lineLimit(1...3)
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textPrimary)
                            .tint(Theme.accentBright)
                            .focused($focused, equals: .summary)
                            .accessibilityLabel("Summary")
                            .accessibilityIdentifier("projectCompose.summary")

                        TextField("", text: $details, prompt: prompt("Add description…"), axis: .vertical)
                            .lineLimit(3...12)
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textPrimary)
                            .tint(Theme.accentBright)
                            .focused($focused, equals: .details)
                            .accessibilityLabel("Description")
                            .accessibilityIdentifier("projectCompose.details")

                        teamSection

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
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 0) {
                    HairlineDivider()
                    propertyPills
                        .padding(.horizontal, Theme.Space.lg)
                        .padding(.vertical, Theme.Space.sm)
                }
                .background(Theme.background)
            }
            .navigationTitle(isEditing ? Text("Edit Project") : Text("New Project"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        // A draft only exists for a create; an edit is seeded from the project
                        // and discarding it loses nothing that was not already on the server.
                        if !isEditing, !draft.isEmpty {
                            isConfirmingDiscard = true
                        } else {
                            dismiss()
                        }
                    }
                    .tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSaving {
                            ProgressView().tint(Theme.accentBright)
                        } else {
                            Text(isEditing ? "Save" : "Create")
                                .font(.system(.body).weight(.semibold))
                        }
                    }
                    .tint(Theme.accentBright)
                    .disabled(!canSave)
                    .accessibilityIdentifier("projectCompose.save")
                }
            }
            .onAppear(perform: seed)
            // Not `.onAppear`: setting @FocusState in the turn a sheet presents frequently
            // no-ops on iOS, and the reader taps the field themselves. Same delay as the
            // issue composer's.
            .task {
                try? await Task.sleep(for: .milliseconds(350))
                focused = .name
            }
            // Every picker here is one of the collections the workspace fetches once at
            // sign-in. This is the screen that notices when that never landed.
            .task {
                await model.workspaceData.ensureReferenceData([.teams, .users, .projectStatuses])
            }
            .onChange(of: draft) { _, updated in
                guard !isEditing else { return }
                Self.drafts.save(updated)
            }
            .presentationDragIndicator(.visible)
            .confirmationDialog(
                "Discard this project?",
                isPresented: $isConfirmingDiscard,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) {
                    Self.drafts.clear()
                    dismiss()
                }
                Button("Keep editing", role: .cancel) {}
            } message: {
                Text("What you have typed will not be saved.")
            }
            .sheet(isPresented: $isPickingLead) {
                PeoplePicker(
                    people: people,
                    me: model.currentUser,
                    selection: $leadId,
                    title: String(localized: "Lead"),
                    noneLabel: String(localized: "No lead")
                )
            }
            .sheet(isPresented: $isPickingTeams) {
                TeamPickerSheet(teams: teams, selection: $teamIds)
            }
            .sheet(isPresented: $isPickingStart) {
                DatePickerSheet(title: String(localized: "Start date"), selected: startDate) {
                    startDate = $0
                }
            }
            .sheet(isPresented: $isPickingTarget) {
                DatePickerSheet(title: String(localized: "Target date"), selected: targetDate) {
                    targetDate = $0
                }
            }
        }
    }

    // MARK: - Teams

    /// Which teams the project belongs to, and what happens if it belongs to none.
    ///
    /// Only on a create: `UpdateProjectInput` cannot change the set, so offering the control
    /// on an edit would be a picker whose choice is thrown away.
    @ViewBuilder
    private var teamSection: some View {
        if !isEditing {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                SectionLabel(text: String(localized: "Teams"))
                Button {
                    isPickingTeams = true
                } label: {
                    PropertyChip(text: teamsText) {
                        Image(systemName: "person.2")
                            .font(.system(size: 12))
                            .foregroundStyle(teamIds.isEmpty ? Theme.danger : Theme.textSecondary)
                    }
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(Text("Teams"))
                .accessibilityValue(Text(teamsText))
                .accessibilityIdentifier("projectCompose.teams")

                // Said before Create is pressed, not after the server refuses. A project on no
                // team is created successfully and then cannot be found by anybody, which is
                // a worse outcome than a disabled button with a reason next to it.
                if teamIds.isEmpty {
                    Text("A project needs at least one team. On none, it exists but nobody can see it.")
                        .font(PolarisText.captionSmall)
                        .foregroundStyle(Theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("projectCompose.teams.required")
                }
            }
            teamsProblem
        }
    }

    /// Why the team picker is empty, when it is empty for a reason worth a sentence — the
    /// same two cases `ComposeIssueView.teamsProblem` distinguishes, and the same way back.
    @ViewBuilder
    private var teamsProblem: some View {
        if let failure = model.workspaceData.failure(of: .teams) {
            InlineErrorLabel(
                text: String(localized: "Couldn't load your teams, and a project needs one. \(failure.displayMessage)"),
                retryLabel: failure.isRetryable ? String(localized: "Try again") : nil,
                onRetry: failure.isRetryable
                    ? { Task { await model.workspaceData.reload(.teams) } }
                    : nil
            )
            .accessibilityIdentifier("projectCompose.teams.retry")
        } else if teams.isEmpty, case .loaded = model.workspaceData.teams {
            InlineErrorLabel(
                text: String(localized: "You're not on a team yet, so there's nothing to give this project to. Whoever runs this workspace can add you to one.")
            )
            .accessibilityIdentifier("projectCompose.teams.none")
        }
    }

    private var teamsText: String {
        let chosen = teams.filter { teamIds.contains($0.id) }
        switch chosen.count {
        case 0: return String(localized: "Choose a team")
        case 1: return chosen[0].key
        default: return "\(chosen[0].key) +\(chosen.count - 1)"
        }
    }

    // MARK: - Properties

    private var propertyPills: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Theme.Space.sm) {
                pill {
                    Picker(selection: $statusId) {
                        Text("Default status").tag(String?.none)
                        ForEach(statuses) { status in
                            Text(status.name).tag(String?.some(status.id))
                        }
                    } label: {
                        Text("Status")
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("projectCompose.status")
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
                    .accessibilityIdentifier("projectCompose.priority")
                }

                chipButton(
                    text: lead?.displayName ?? String(localized: "Lead"),
                    label: "Lead",
                    value: lead?.displayName ?? String(localized: "No lead"),
                    identifier: "projectCompose.lead"
                ) {
                    AvatarView(user: lead, size: 16).accessibilityHidden(true)
                } action: {
                    isPickingLead = true
                }

                chipButton(
                    text: PlanningDates.day(startDate) ?? String(localized: "Start"),
                    label: "Start date",
                    value: PlanningDates.day(startDate) ?? String(localized: "None"),
                    identifier: "projectCompose.startDate"
                ) {
                    Image(systemName: "calendar")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                } action: {
                    isPickingStart = true
                }

                chipButton(
                    text: PlanningDates.day(targetDate) ?? String(localized: "Target"),
                    label: "Target date",
                    value: PlanningDates.day(targetDate) ?? String(localized: "None"),
                    identifier: "projectCompose.targetDate"
                ) {
                    Image(systemName: "flag")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                } action: {
                    isPickingTarget = true
                }
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

    private func chipButton<Icon: View>(
        text: String,
        label: String,
        value: String,
        identifier: String,
        @ViewBuilder icon: @escaping () -> Icon,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            PropertyChip(text: text, icon: icon)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(value))
        .accessibilityIdentifier(identifier)
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Theme.placeholder)
    }

    // MARK: - Seeding and saving

    /// The project being edited, or whatever was left in a half-finished create.
    private func seed() {
        if let original {
            name = original.name
            summary = original.summary ?? ""
            details = original.description
            statusId = original.status.id
            priority = original.priority
            leadId = original.leadId
            teamIds = Set(original.teams.map(\.id))
            startDate = original.startDate
            targetDate = original.targetDate
            return
        }
        guard name.isEmpty, summary.isEmpty, details.isEmpty else { return }
        guard let saved = Self.drafts.load(), !saved.isEmpty else { return }
        name = saved.name
        summary = saved.summary
        details = saved.details
        statusId = saved.statusId
        priority = Priority(rawValue: saved.priority) ?? .none
        leadId = saved.leadId
        teamIds = Set(saved.teamIds)
        startDate = saved.startDate
        targetDate = saved.targetDate
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        error = nil
        Task {
            let failure = await perform(request())
            if let failure {
                withAnimation(Theme.easing(0.3)) { error = failure }
            } else {
                if !isEditing { Self.drafts.clear() }
                dismiss()
            }
            isSaving = false
        }
    }

    private func request() -> Request {
        guard let original else {
            return .create(
                ProjectDraft(
                    name: trimmedName,
                    // Omitted rather than sent empty: an empty summary and no summary read
                    // identically on every screen, and the server stores the difference.
                    summary: blankToNil(summary),
                    description: blankToNil(details),
                    statusId: statusId,
                    priority: priority,
                    leadId: leadId,
                    teamIds: teamIds.sorted(),
                    startDate: startDate,
                    startDateGranularity: startDate == nil ? nil : .day,
                    targetDate: targetDate,
                    targetDateGranularity: targetDate == nil ? nil : .day
                )
            )
        }

        // An edit sends only what moved, and says "removed" with a flag rather than with a
        // nil — nil in a partial update means "leave alone", which is the whole reason the
        // three `clear…` booleans exist.
        let nextSummary = blankToNil(summary)
        let nextDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        return .update(
            ProjectChange(
                id: original.id,
                name: trimmedName == original.name ? nil : trimmedName,
                // An emptied summary is sent as "" rather than cleared: `UpdateProjectInput`
                // has no clearSummary, and "" is what the server stores for no summary.
                summary: nextSummary == original.summary ? nil : (nextSummary ?? ""),
                description: nextDetails == original.description ? nil : nextDetails,
                statusId: statusId == original.status.id ? nil : statusId,
                priority: priority == original.priority ? nil : priority,
                leadId: leadId == original.leadId ? nil : leadId,
                clearLead: leadId == nil && original.leadId != nil,
                startDate: startDate == original.startDate ? nil : startDate,
                startDateGranularity: startDate == nil || startDate == original.startDate ? nil : .day,
                clearStart: startDate == nil && original.startDate != nil,
                targetDate: targetDate == original.targetDate ? nil : targetDate,
                targetDateGranularity: targetDate == nil || targetDate == original.targetDate ? nil : .day,
                clearTarget: targetDate == nil && original.targetDate != nil
            )
        )
    }

    private func blankToNil(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Which teams a new project belongs to: a multi-select list, checked rows staying checked.
///
/// Multi-select rather than one team, because `CreateProjectInput.teamIds` is a list and a
/// project that spans two teams is the ordinary case for anything shipping on more than one
/// surface.
private struct TeamPickerSheet: View {
    let teams: [Team]
    @Binding var selection: Set<String>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if teams.isEmpty {
                    EmptyStateView(
                        symbol: "person.2",
                        title: String(localized: "No teams"),
                        message: String(localized: "You're not on a team yet, so there's nothing to give a project to.")
                    )
                } else {
                    List(teams) { team in
                        Button {
                            if selection.contains(team.id) {
                                selection.remove(team.id)
                            } else {
                                selection.insert(team.id)
                            }
                        } label: {
                            HStack(spacing: Theme.Space.sm + 2) {
                                TeamIconView(team: team, size: 24)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(team.name)
                                        .font(PolarisText.rowTitle)
                                        .foregroundStyle(Theme.textPrimary)
                                        .lineLimit(1)
                                    Text(team.key)
                                        .font(PolarisText.captionSmall)
                                        .foregroundStyle(Theme.textTertiary)
                                }
                                Spacer(minLength: 0)
                                if selection.contains(team.id) {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Theme.accentBright)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Theme.hairline)
                        .frame(minHeight: Theme.rowHeight - Theme.Space.sm)
                        .accessibilityAddTraits(selection.contains(team.id) ? .isSelected : [])
                        .accessibilityIdentifier("projectTeam.\(team.id)")
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("Teams"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .tint(Theme.accentBright)
                        .disabled(selection.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// What the create form holds between openings.
struct ProjectComposeDraft: Codable, Equatable {
    var name = ""
    var summary = ""
    var details = ""
    var statusId: String?
    var priority = 0
    var leadId: String?
    var teamIds: [String] = []
    /// Wire calendar days, `2006-01-02`.
    var startDate: String?
    var targetDate: String?

    /// Nothing typed. Properties alone are not a draft worth restoring, for the reason
    /// `ComposeDraft.isEmpty` gives: a team chosen with no words behind it is a default, not
    /// somebody's work.
    var isEmpty: Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Where a half-written project lives: `UserDefaults` on a device, memory in the fixture app.
///
/// A mirror of `ComposeDraftStore` rather than a shared generic over both draft types,
/// because that store's concrete name is what a pre-existing test constructs — making it
/// generic would mean editing a test to accommodate a refactor it has no stake in.
final class ProjectDraftStore {
    static let storageKey = "polaris.project.draft"

    private let defaults: UserDefaults?
    private var memory: ProjectComposeDraft?

    init(defaults: UserDefaults?) {
        self.defaults = defaults
    }

    func load() -> ProjectComposeDraft? {
        if let defaults {
            guard let data = defaults.data(forKey: Self.storageKey) else { return nil }
            return try? JSONDecoder().decode(ProjectComposeDraft.self, from: data)
        }
        return memory
    }

    func save(_ draft: ProjectComposeDraft) {
        guard !draft.isEmpty else { return clear() }
        if let defaults {
            defaults.set(try? JSONEncoder().encode(draft), forKey: Self.storageKey)
        } else {
            memory = draft
        }
    }

    func clear() {
        defaults?.removeObject(forKey: Self.storageKey)
        memory = nil
    }
}
