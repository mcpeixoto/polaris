import SwiftUI
import PolarisCore

/// The composer, shaped like Linear's: the team as a pill at the top, a big title, a
/// description, and the properties as a row of pills that sits above the keyboard.
///
/// Every property the create mutation accepts is here — status, priority, assignee, labels,
/// due date, estimate, project, cycle — as a pill that opens the smallest control that can
/// set it: a menu where the options fit in one, a sheet where they do not. "Create more"
/// keeps the sheet open across several issues, and an unfinished draft outlives the sheet.
struct ComposeIssueView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// One store for the process. The shell makes a new sheet per opening, and the draft has
    /// to outlive the sheet, so it cannot be `@State` here.
    private static let drafts = ComposeDraftStore(defaults: LaunchOptions.usesFixtures ? nil : .standard)

    @State private var title = ""
    @State private var details = ""
    @State private var teamId: String?
    @State private var priority: Priority = .none
    /// The status the issue is created in. Nil means "the team's default", which is what the
    /// server picks when `stateId` is absent — offering a status picker that cannot express
    /// "leave it to the workspace" would be a worse default than not offering one.
    @State private var stateId: String?
    /// Nil is unassigned. Defaults to the reader — see `assignToMe` below.
    @State private var assigneeId: String?
    @State private var labelIds: Set<String> = []
    @State private var dueDate: Date?
    @State private var estimate: Int?
    @State private var projectId: String?
    @State private var cycleId: String?
    @State private var cycles: [Cycle] = []
    /// Linear's "Create more": the sheet stays open after Create, cleared for the next one.
    @State private var createMore = false
    /// The identifier of the last issue created with the sheet still open, so the reader can
    /// see the create happened without the list behind the sheet.
    @State private var lastCreated: String?
    @State private var isSaving = false
    @State private var error: PolarisError?
    @State private var isConfirmingDiscard = false
    @State private var isPickingAssignee = false
    @State private var isPickingLabels = false
    @State private var isPickingDueDate = false
    @FocusState private var focused: Field?

    private enum Field: Hashable { case title, details }

    private var teams: [Team] { model.workspaceData.teams.value ?? [] }
    private var team: Team? { teams.first { $0.id == teamId } }
    private var states: [WorkflowState] {
        guard let teamId else { return [] }
        return model.workspaceData.states(forTeam: teamId)
    }
    private var labels: [PolarisCore.Label] {
        guard let teamId else { return [] }
        return model.workspaceData.labels(forTeam: teamId)
    }
    private var projects: [Project] {
        guard let teamId else { return [] }
        return model.workspaceData.projects(forTeam: teamId)
    }
    private var people: [User] { model.workspaceData.users.value ?? [] }
    private var me: User? { model.currentUser }
    private var assignee: User? {
        guard let assigneeId else { return nil }
        return me?.id == assigneeId ? me : model.workspaceData.user(id: assigneeId)
    }

    /// Defaulted on, and offered rather than assumed. This screen is reached from My Issues,
    /// which the server filters strictly by assignee — so an unassigned issue is created,
    /// appears once because the store appends it locally, and then vanishes on the next load.
    /// That reads as data loss.
    private var assignToMe: Binding<Bool> {
        Binding(
            get: { assigneeId != nil && assigneeId == me?.id },
            set: { assigneeId = $0 ? me?.id : nil }
        )
    }

    private var hasDraft: Bool { !draft.isEmpty }
    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && teamId != nil
            && !isSaving
    }

    /// Everything on the sheet, as the store keeps it.
    private var draft: ComposeDraft {
        ComposeDraft(
            title: title,
            details: details,
            teamId: teamId,
            priority: priority.rawValue,
            stateId: stateId,
            assigneeId: assigneeId,
            labelIds: labelIds.sorted(),
            dueDate: dueDate.map { Self.wireDay($0) },
            estimate: estimate,
            projectId: projectId,
            cycleId: cycleId
        )
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

                        teamsProblem

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
                        .padding(.top, Theme.Space.sm)
                    createMoreRow
                        .padding(.horizontal, Theme.Space.lg)
                        .padding(.vertical, Theme.Space.xs + 2)
                }
                .background(Theme.background)
            }
            .navigationTitle("New Issue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        // The draft is kept either way; the question is whether the reader
                        // meant to throw it out. "Keep editing" leaves it for next time.
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
                restoreDraft()
                if teamId == nil { teamId = teams.first?.id }
            }
            // Not `.onAppear`. Setting @FocusState in the same runloop turn a sheet presents
            // frequently no-ops on iOS: the keyboard does not come up and the reader taps the
            // field themselves. The auth screens get away with it because they are pushed.
            .task {
                try? await Task.sleep(for: .milliseconds(350))
                focused = .title
            }
            .task(id: teamId) { await loadCycles() }
            // Every picker on this sheet is one of the workspace's reference collections, and
            // all of them are fetched once at sign-in. This is the screen that notices when
            // that never landed — so it asks, rather than presenting empty menus.
            .task { await model.workspaceData.ensureReferenceData([.teams, .users, .labels, .projects]) }
            // Teams may not have loaded when the sheet opens. Without this the selection stays
            // nil for ever and Create is permanently disabled with nothing explaining why.
            .onChange(of: teams) { _, loaded in
                if teamId == nil { teamId = loaded.first?.id }
            }
            // A state, a project, a cycle and a team label all belong to one team. Keeping
            // them across a team change would send the new team ids it does not own, which
            // the server refuses. The first assignment — nil to a team — is not a change of
            // mind, and must not wipe a restored draft.
            .onChange(of: teamId) { previous, current in
                guard previous != nil, current != previous else { return }
                stateId = nil
                projectId = nil
                cycleId = nil
                labelIds = labelIds.intersection(labels.map(\.id))
            }
            .onChange(of: draft) { _, updated in Self.drafts.save(updated) }
            .presentationDragIndicator(.visible)
            .confirmationDialog(
                "Discard this issue?",
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
            .sheet(isPresented: $isPickingAssignee) {
                PeoplePicker(people: people, me: me, selection: $assigneeId)
            }
            .sheet(isPresented: $isPickingLabels) {
                LabelPickerSheet(labels: labels, selection: $labelIds)
            }
            .sheet(isPresented: $isPickingDueDate) {
                DueDateSheet(date: $dueDate)
            }
        }
    }

    /// Why Create is disabled, when the reason is not simply an empty title.
    ///
    /// An issue needs a team, and the only list of teams is reference data fetched once at
    /// sign-in. When that fetch failed the picker held nothing, Create stayed grey for the
    /// life of the session, and neither of them said a word about it — the reader was left
    /// deciding whether the app was broken or they were. This is the sentence, and the way
    /// back.
    @ViewBuilder
    private var teamsProblem: some View {
        if let failure = model.workspaceData.failure(of: .teams) {
            InlineErrorLabel(
                text: String(localized: "Couldn't load your teams, so there's nowhere to file this yet. \(failure.displayMessage)"),
                retryLabel: failure.isRetryable ? String(localized: "Try again") : nil,
                onRetry: failure.isRetryable
                    ? { Task { await model.workspaceData.reload(.teams) } }
                    : nil
            )
            .accessibilityIdentifier("compose.teams.retry")
        } else if teams.isEmpty, case .loaded = model.workspaceData.teams {
            // The one case where an empty picker is the truth, and only sayable once the
            // server has answered.
            InlineErrorLabel(
                text: String(localized: "You're not on a team yet, so there's nowhere to file this. Whoever runs this workspace can add you to one.")
            )
            .accessibilityIdentifier("compose.teams.none")
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

    /// The properties, as one scrolling row of pills. Menu pickers in pill clothing where the
    /// options fit in a menu, so the labels the platform reads out are still "Status" and
    /// "Priority"; buttons into a sheet where they do not.
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
                    .accessibilityIdentifier("compose.priority")
                }

                Toggle(isOn: assignToMe) {
                    HStack(spacing: Theme.Space.xs + 2) {
                        Image(systemName: assignToMe.wrappedValue ? "person.fill" : "person")
                            .font(.system(size: 12))
                        Text("Assign to me")
                            .font(.system(.footnote).weight(.medium))
                    }
                    .foregroundStyle(assignToMe.wrappedValue ? Theme.accentBright : Theme.textSecondary)
                    .padding(.horizontal, Theme.Space.sm + 2)
                    .frame(minHeight: 30)
                    .background(assignToMe.wrappedValue ? Theme.accentTint : Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                            .stroke(assignToMe.wrappedValue ? Theme.accent : Theme.border, lineWidth: 1)
                    )
                }
                .toggleStyle(.button)
                .buttonStyle(PressableStyle())

                chipButton(
                    text: assignee?.displayName ?? String(localized: "Assignee"),
                    label: "Assignee",
                    value: assignee?.displayName ?? String(localized: "Unassigned"),
                    identifier: "compose.assignee"
                ) {
                    AvatarView(user: assignee, size: 16).accessibilityHidden(true)
                } action: {
                    isPickingAssignee = true
                }

                chipButton(
                    text: labelsText,
                    label: "Labels",
                    value: labelsText,
                    identifier: "compose.labels"
                ) {
                    if labelIds.isEmpty {
                        Image(systemName: "tag")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    } else {
                        LabelDots(labels: labels.filter { labelIds.contains($0.id) })
                    }
                } action: {
                    isPickingLabels = true
                }

                chipButton(
                    text: dueDateText ?? String(localized: "Due date"),
                    label: "Due date",
                    value: dueDateText ?? String(localized: "None"),
                    identifier: "compose.dueDate"
                ) {
                    Image(systemName: "calendar")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                } action: {
                    isPickingDueDate = true
                }

                pill {
                    Picker(selection: $estimate) {
                        Text("No estimate").tag(Int?.none)
                        ForEach(1...8, id: \.self) { points in
                            Text("\(points)").tag(Int?.some(points))
                        }
                    } label: {
                        Text("Estimate")
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("compose.estimate")
                }

                if !projects.isEmpty {
                    pill {
                        Picker(selection: $projectId) {
                            Text("No project").tag(String?.none)
                            ForEach(projects) { project in
                                Text(project.name).tag(String?.some(project.id))
                            }
                        } label: {
                            Text("Project")
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("compose.project")
                    }
                }

                if !cycles.isEmpty {
                    pill {
                        Picker(selection: $cycleId) {
                            Text("No cycle").tag(String?.none)
                            ForEach(cycles) { cycle in
                                Text(cycle.isActive() ? "\(cycle.displayName) · Active" : cycle.displayName)
                                    .tag(String?.some(cycle.id))
                            }
                        } label: {
                            Text("Cycle")
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("compose.cycle")
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    /// Linear's "Create more", and the receipt for the last one it created.
    private var createMoreRow: some View {
        HStack(spacing: Theme.Space.md) {
            Toggle(isOn: $createMore) {
                Text("Create more")
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
            .tint(Theme.accent)
            .fixedSize()
            .accessibilityIdentifier("compose.createMore")
            Spacer(minLength: 0)
            if let lastCreated {
                Text("Created \(lastCreated)")
                    .font(PolarisText.caption.monospacedDigit())
                    .foregroundStyle(Theme.textTertiary)
                    .transition(.opacity)
            }
        }
    }

    private var labelsText: String {
        let chosen = labels.filter { labelIds.contains($0.id) }
        switch chosen.count {
        case 0: return String(localized: "Labels")
        case 1: return chosen[0].name
        default: return "\(chosen[0].name) +\(chosen.count - 1)"
        }
    }

    private var dueDateText: String? {
        guard let dueDate else { return nil }
        return DueDateFormat.present(Self.wireDay(dueDate))?.text
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

    /// A pill that opens a sheet. Spoken as the property and its value, like the detail
    /// screen's, so "Labels, backend" rather than just the label's name.
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

    /// The draft from last time, if the sheet was left with words in it. Only into a fresh
    /// sheet: a "Create more" run has its own state and must not be overwritten mid-flight.
    private func restoreDraft() {
        guard title.isEmpty, details.isEmpty else { return }
        guard let saved = Self.drafts.load(), !saved.isEmpty else {
            assigneeId = me?.id
            return
        }
        title = saved.title
        details = saved.details
        teamId = saved.teamId
        priority = Priority(rawValue: saved.priority) ?? .none
        stateId = saved.stateId
        assigneeId = saved.assigneeId
        labelIds = Set(saved.labelIds)
        dueDate = saved.dueDate.flatMap { DueDateFormat.day($0, calendar: .current) }
        estimate = saved.estimate
        projectId = saved.projectId
        cycleId = saved.cycleId
    }

    /// The team's cycles, the running one first. Fetched per team rather than held in the
    /// workspace store because cycles roll over weekly and the store is loaded once a session.
    private func loadCycles() async {
        guard let teamId, team?.cyclesEnabled ?? true else {
            cycles = []
            return
        }
        let fetched = (try? await model.api.cycles(teamId: teamId)) ?? []
        guard !Task.isCancelled else { return }
        cycles = fetched
            .filter { $0.completedAt == nil }
            .sorted { left, right in
                if left.isActive() != right.isActive() { return left.isActive() }
                return left.startsAt < right.startsAt
            }
    }

    /// `2026-09-30`, the wire form of a calendar day, in the reader's calendar.
    static func wireDay(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private func save() {
        guard canSave, let teamId else { return }
        isSaving = true
        error = nil
        Task {
            do {
                let issue = IssueDraft(
                    teamId: teamId,
                    title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                    // Trimmed like the title. An untrimmed body stores the reader's stray
                    // trailing newlines and renders them back on the detail screen.
                    description: details.trimmingCharacters(in: .whitespacesAndNewlines),
                    priority: priority,
                    stateId: stateId,
                    assigneeId: assigneeId,
                    labelIds: labelIds.sorted(),
                    dueDate: dueDate.map { Self.wireDay($0) },
                    estimate: estimate,
                    projectId: projectId,
                    cycleId: cycleId
                )
                let created = try await model.issues.create(issue)
                Self.drafts.clear()
                if createMore {
                    // The words go, the properties stay: the next issue is usually the next
                    // one in the same team, with the same labels, in the same cycle.
                    withAnimation(Theme.easing(0.3)) {
                        title = ""
                        details = ""
                        lastCreated = created.identifier
                    }
                    focused = .title
                } else {
                    dismiss()
                }
            } catch let failure as PolarisError {
                withAnimation(Theme.easing(0.3)) { error = failure }
            } catch {
                withAnimation(Theme.easing(0.3)) { self.error = .badResponse }
            }
            isSaving = false
        }
    }
}

/// Which labels an issue carries: a multi-select list, checked rows staying checked.
private struct LabelPickerSheet: View {
    let labels: [PolarisCore.Label]
    @Binding var selection: Set<String>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if labels.isEmpty {
                    EmptyStateView(
                        symbol: "tag",
                        title: String(localized: "No labels"),
                        message: String(localized: "This team has no labels to apply yet.")
                    )
                } else {
                    List(labels) { label in
                        Button {
                            if selection.contains(label.id) {
                                selection.remove(label.id)
                            } else {
                                selection.insert(label.id)
                            }
                        } label: {
                            HStack(spacing: Theme.Space.sm + 2) {
                                Circle()
                                    .fill(Theme.hex(label.color))
                                    .frame(width: 9, height: 9)
                                Text(label.name)
                                    .font(PolarisText.rowTitle)
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer(minLength: 0)
                                if selection.contains(label.id) {
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
                        .accessibilityAddTraits(selection.contains(label.id) ? .isSelected : [])
                        .accessibilityIdentifier("label.\(label.id)")
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("Labels"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.tint(Theme.accentBright)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// When the issue is due: a calendar, and a way to say "no date" again.
private struct DueDateSheet: View {
    @Binding var date: Date?
    @Environment(\.dismiss) private var dismiss
    @State private var working: Date

    init(date: Binding<Date?>) {
        _date = date
        _working = State(initialValue: date.wrappedValue ?? Calendar.current.startOfDay(for: .now))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: Theme.Space.md) {
                DatePicker(
                    "Due date",
                    selection: $working,
                    displayedComponents: .date
                )
                .datePickerStyle(.graphical)
                .tint(Theme.accentBright)
                .labelsHidden()
                .padding(.horizontal, Theme.Space.sm)
                Spacer(minLength: 0)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("Due date"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Clear") {
                        date = nil
                        dismiss()
                    }
                    .tint(Theme.textSecondary)
                    .disabled(date == nil)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        date = working
                        dismiss()
                    }
                    .tint(Theme.accentBright)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
