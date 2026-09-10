import SwiftUI
import PolarisCore

/// One issue: where it is, what it says, its properties as a row of pills, what hangs off
/// it — sub-issues, relations, links — and the thread under all of that. The bar carries
/// the identifier; the body carries everything else, flat, with the composer pinned under it.
struct IssueDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var store: IssueDetailStore?
    @State private var draftComment = ""
    @State private var draftTitle = ""
    @State private var editingDescription: String?
    @State private var editingComment: Comment?
    @State private var deletingComment: Comment?
    @State private var isConfirmingArchive = false
    @State private var isConfirmingDelete = false
    @State private var sheet: DetailSheet?
    /// An issue reached from this one — the parent, a relation, a child — pushed on top.
    @State private var linkedIssue: Issue?
    @State private var linkError: PolarisError?
    @State private var relationError: PolarisError?
    @State private var commentsPosted = 0
    @State private var writeFailures = 0
    /// Bumped on every property write, which is what drives the success haptic.
    @State private var writes = 0
    @FocusState private var titleFocused: Bool
    @FocusState private var commentFocused: Bool

    private let seed: Issue

    init(issue: Issue) {
        self.seed = issue
    }

    /// Every sheet the screen can present, as one item so two can never stack.
    private enum DetailSheet: Identifiable {
        case assignee, labels, dueDate, estimate, project, cycle, parent, addLink
        case relation(RelationsSection.Choice)

        var id: String {
            switch self {
            case .relation(let choice): "relation-\(choice.rawValue)"
            default: String(describing: self)
            }
        }
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let store {
                content(store: store)
            } else {
                LoadingView()
            }
        }
        .navigationTitle(seed.identifier)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let store { ToolbarItem(placement: .topBarTrailing) { overflowMenu(store: store) } }
        }
        .task {
            // Seeded from the row the reader tapped so the screen opens with content, then
            // refreshed in place. A detail view that spinners over data the app already had is
            // the most common self-inflicted slowness in a list-detail app.
            if store == nil {
                let created = IssueDetailStore(api: model.api, issue: seed, viewerId: model.currentUser?.id) { updated in
                    // Otherwise the row and the "N open" count keep the old status after the
                    // reader comes back: nothing reloads on return, and refreshIfStale
                    // short-circuits because the version did not move — this client made the
                    // change.
                    model.issues.merge(updated)
                }
                model.adopt(&created.onUnauthorized)
                store = created
                draftTitle = seed.title
            }
            await store?.load()
        }
        .sensoryFeedback(.success, trigger: commentsPosted)
        .sensoryFeedback(.success, trigger: writes)
        .sensoryFeedback(.error, trigger: writeFailures)
    }

    @ViewBuilder
    private func content(store: IssueDetailStore) -> some View {
        let issue = store.issue.value ?? seed
        let detail = store.detail.value
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    breadcrumb(issue: issue)
                    titleField(store: store, issue: issue)
                    descriptionBlock(issue: issue)
                }

                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    properties(issue: issue, store: store)
                    if let error = store.propertyError {
                        InlineErrorLabel(text: error.displayMessage)
                    }
                }
                .padding(.top, Theme.Space.xl)
                // The status picker needs this team's states and the bulk fetch runs once, at
                // sign-in. Asking here as well is what makes the picker work on a screen
                // opened before that finished, after it failed, or on a team created since.
                .task(id: issue.team.id) {
                    await model.workspaceData.ensureStates(forTeam: issue.team.id)
                }
                // The same argument for the property chips beside it: the assignee, label and
                // project pickers all read collections fetched once at sign-in, and an empty
                // picker is indistinguishable from a workspace with nobody in it.
                .task {
                    await model.workspaceData.ensureReferenceData([.users, .labels, .projects])
                }

                SubIssuesSection(
                    children: detail?.children ?? [],
                    progress: issue.progress,
                    onOpen: { linkedIssue = $0 },
                    onAdd: { title in
                        let ok = await store.createSubIssue(title: title)
                        if ok { writes += 1 } else { writeFailures += 1 }
                        return ok
                    }
                )
                .padding(.top, Theme.Space.xl)

                RelationsSection(
                    issueId: issue.id,
                    relations: detail?.relations ?? [],
                    blockedBy: detail?.blockedBy ?? [],
                    error: relationError,
                    onOpen: open(_:),
                    onAdd: { sheet = .relation($0) }
                )
                .padding(.top, Theme.Space.xl)

                LinksSection(attachments: detail?.attachments ?? []) {
                    sheet = .addLink
                }
                .padding(.top, Theme.Space.xl)

                ActivityThreadView(
                    store: store,
                    names: names,
                    viewerId: model.currentUser?.id,
                    author: author(for:),
                    authorName: authorName(for:),
                    onEdit: { editingComment = $0 },
                    onDelete: { deletingComment = $0 },
                    onReact: { comment, emoji in
                        guard let viewerId = model.currentUser?.id else { return }
                        Task {
                            await store.toggleReaction(commentId: comment.id, emoji: emoji, viewerId: viewerId)
                            writes += 1
                        }
                    }
                )
                .padding(.top, Theme.Space.xl)
            }
            .padding(.horizontal, Theme.Space.lg)
            .padding(.top, Theme.Space.md)
            .padding(.bottom, Theme.Space.xxl)
            .readableColumn()
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.load() }
        // Out of the ScrollView, which is where it used to live: on an issue with twenty
        // comments you had to scroll to the end of the thread before you could reply.
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 0) {
                HairlineDivider()
                composer(store: store)
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.vertical, Theme.Space.sm)
                    .readableColumn()
            }
            .background(Theme.background)
        }
        .onChange(of: store.propertyError == nil) { _, isClear in
            if !isClear { writeFailures += 1 }
        }
        .onChange(of: store.commentError == nil) { _, isClear in
            if !isClear { writeFailures += 1 }
        }
        .onChange(of: issue.title) { _, updated in
            // The server's title wins, unless the reader is in the middle of typing one.
            if !titleFocused { draftTitle = updated }
        }
        .navigationDestination(item: $linkedIssue) { IssueDetailView(issue: $0) }
        .sheet(item: Binding(
            get: { editingDescription.map(TextDraft.init) },
            set: { editingDescription = $0?.text }
        )) { draft in
            TextEditorSheet(
                title: String(localized: "Description"),
                prompt: String(localized: "What is this issue about?"),
                text: draft.text
            ) { updated in
                Task { await store.setDescription(updated); writes += 1 }
            }
        }
        .sheet(item: $editingComment) { comment in
            TextEditorSheet(
                title: String(localized: "Edit comment"),
                prompt: String(localized: "Say something"),
                text: comment.body,
                identifier: "comment.editor"
            ) { updated in
                Task {
                    if await store.editComment(id: comment.id, body: updated) { writes += 1 }
                }
            }
        }
        .sheet(item: $sheet) { which in
            pickerSheet(which, issue: issue, store: store)
        }
        .confirmationDialog(
            Text("Archive this issue?"),
            isPresented: $isConfirmingArchive,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { if await store.archive() { dismiss() } }
            } label: {
                Text("Archive")
            }
            Button(role: .cancel) {} label: { Text("Cancel") }
        } message: {
            Text("It leaves every list. An admin can bring it back.")
        }
        .confirmationDialog(
            Text("Delete this issue?"),
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { if await store.delete() { dismiss() } }
            } label: {
                Text("Delete")
            }
            Button(role: .cancel) {} label: { Text("Cancel") }
        } message: {
            Text("It goes to the trash, with its comments and sub-issues.")
        }
        .confirmationDialog(
            Text("Delete this comment?"),
            isPresented: Binding(get: { deletingComment != nil }, set: { if !$0 { deletingComment = nil } }),
            titleVisibility: .visible,
            presenting: deletingComment
        ) { comment in
            Button(role: .destructive) {
                Task { if await store.deleteComment(id: comment.id) { writes += 1 } }
            } label: {
                Text("Delete comment")
            }
            Button(role: .cancel) {} label: { Text("Cancel") }
        } message: { _ in
            Text("This can't be undone.")
        }
        .alert(
            Text("Couldn't open that issue"),
            isPresented: Binding(get: { linkError != nil }, set: { if !$0 { linkError = nil } }),
            presenting: linkError
        ) { _ in
            Button { linkError = nil } label: { Text("OK") }
        } message: { error in
            Text(error.displayMessage)
        }
    }

    // MARK: - Sheets

    @ViewBuilder
    private func pickerSheet(_ which: DetailSheet, issue: Issue, store: IssueDetailStore) -> some View {
        switch which {
        case .assignee:
            AssigneePicker(
                people: model.workspaceData.users.value ?? [],
                selected: issue.assignee?.id
            ) { person in
                Task { await store.setAssignee(person); writes += 1 }
            }
        case .labels:
            LabelPicker(
                labels: model.workspaceData.labels(forTeam: issue.team.id),
                selected: Set(issue.labels.map(\.id))
            ) { label, isOn in
                Task {
                    if isOn { await store.addLabel(label) } else { await store.removeLabel(label) }
                    writes += 1
                }
            }
        case .dueDate:
            DatePickerSheet(title: String(localized: "Due date"), selected: issue.dueDate) { day in
                Task { await store.setDueDate(day); writes += 1 }
            }
        case .estimate:
            EstimatePicker(selected: issue.estimate) { points in
                Task { await store.setEstimate(points); writes += 1 }
            }
        case .project:
            ProjectPicker(
                projects: model.workspaceData.projects(forTeam: issue.team.id),
                selected: issue.projectId
            ) { project in
                Task { await store.setProject(project); writes += 1 }
            }
        case .cycle:
            CyclePicker(api: model.api, teamId: issue.team.id, selected: issue.cycleId) { cycle in
                Task { await store.setCycle(cycle); writes += 1 }
            }
        case .parent:
            IssuePicker(
                title: String(localized: "Parent issue"),
                api: model.api,
                excluding: [issue.id],
                clearTitle: issue.parent == nil ? nil : String(localized: "Remove parent")
            ) { parent in
                Task { await store.setParent(parent); writes += 1 }
            }
        case .addLink:
            AddLinkSheet { url, title in
                Task {
                    if await store.addLink(url: url, title: title) { writes += 1 }
                }
            }
        case .relation(let choice):
            IssuePicker(
                title: choice.title,
                api: model.api,
                excluding: [issue.id]
            ) { other in
                guard let other else { return }
                Task { await addRelation(choice, other: other, issue: issue, store: store) }
            }
        }
    }

    /// Relations have no store method, so the write goes straight to the API and the detail
    /// is reloaded — the server owns which end of a `BLOCKS` row is which.
    private func addRelation(
        _ choice: RelationsSection.Choice,
        other: IssueRef,
        issue: Issue,
        store: IssueDetailStore
    ) async {
        relationError = nil
        let (subject, object, type): (String, String, RelationType) = switch choice {
        case .blocks: (issue.id, other.id, .blocks)
        case .blockedBy: (other.id, issue.id, .blocks)
        case .related: (issue.id, other.id, .related)
        case .duplicateOf: (issue.id, other.id, .duplicate)
        }
        do {
            _ = try await model.api.createIssueRelation(
                issueId: subject, relatedIssueId: object, type: type, opId: UUIDv7.string()
            )
            writes += 1
            await store.load()
        } catch {
            relationError = PolarisError.mapped(error)
            writeFailures += 1
        }
    }

    /// Pushes another issue by reference. The row only carries an identifier and a title,
    /// so the full issue is fetched first; a fixture answers instantly, a server in a few
    /// hundred milliseconds — short enough that a spinner would flash.
    private func open(_ ref: IssueRef) {
        Task {
            do {
                linkedIssue = try await model.api.issue(id: ref.id)
            } catch {
                linkError = PolarisError.mapped(error)
            }
        }
    }

    // MARK: - Header

    /// Where the issue lives: the team's mark, the parent when there is one, then the
    /// identifier. The parent is the one tappable part — it is the way up the tree.
    private func breadcrumb(issue: Issue) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Text(issue.team.key)
                .font(.system(.caption).weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, Theme.Space.xs + 1)
                .frame(minHeight: 20)
                .background(Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
                .accessibilityLabel(Text("Team \(issue.team.name)"))
            if let parent = issue.parent {
                Button {
                    open(parent)
                } label: {
                    Text(parent.identifier)
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.accentBright)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Parent issue \(parent.identifier), \(parent.title)"))
                .accessibilityIdentifier("issue.parentLink")
                Text(verbatim: "›")
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityHidden(true)
                Text(issue.identifier)
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            } else {
                Text(verbatim: "\(issue.team.name) › \(issue.identifier)")
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
        }
    }

    /// The title, editable in place.
    ///
    /// Committed on return *and* on focus loss, because a phone has no other moment that
    /// reliably means "done". The store ignores an unchanged or blank title, so tapping away
    /// from a title nobody edited mints no write and clearing the field does not save an
    /// issue with no name.
    private func titleField(store: IssueDetailStore, issue: Issue) -> some View {
        TextField(
            "",
            text: $draftTitle,
            prompt: Text(issue.title).foregroundStyle(Theme.placeholder),
            axis: .vertical
        )
        .lineLimit(1...4)
        .font(PolarisText.issueTitle)
        .foregroundStyle(Theme.textPrimary)
        .tint(Theme.accentBright)
        .focused($titleFocused)
        .submitLabel(.done)
        .onSubmit {
            titleFocused = false
            Task { await store.setTitle(draftTitle) }
        }
        .onChange(of: titleFocused) { wasFocused, isFocused in
            guard wasFocused, !isFocused else { return }
            Task { await store.setTitle(draftTitle) }
        }
        .accessibilityLabel(Text("Issue title"))
        .accessibilityIdentifier("issue.title")
    }

    /// The description, rendered as the Markdown it is and edited in a sheet.
    ///
    /// A tap anywhere on the block opens the editor; a tap on a link inside it follows the
    /// link, because `Text` claims its links before the block's gesture sees the tap.
    @ViewBuilder
    private func descriptionBlock(issue: Issue) -> some View {
        Group {
            if issue.description.isEmpty {
                HStack(spacing: Theme.Space.sm) {
                    Image(systemName: "text.alignleft")
                        .font(.system(size: 12))
                    Text("Add a description")
                    Spacer(minLength: 0)
                }
                .font(PolarisText.body)
                .foregroundStyle(Theme.placeholder)
            } else {
                MarkdownView(source: issue.description)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { editingDescription = issue.description }
        .accessibilityElement(children: issue.description.isEmpty ? .ignore : .contain)
        .accessibilityLabel(Text(issue.description.isEmpty ? "Add a description" : "Description"))
        .accessibilityHint(Text("Opens the description editor"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { editingDescription = issue.description }
        .accessibilityIdentifier("issue.description")
    }

    // MARK: - Properties

    /// The properties as a wrapping row of pills, the way Linear lays them out on a phone:
    /// status, priority, assignee, then everything else the issue can carry — each a pill
    /// whether it is set or not, so a reader can see what can be set.
    private func properties(issue: Issue, store: IssueDetailStore) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            SectionLabel(text: String(localized: "Properties"))
            FlowLayout(spacing: Theme.Space.sm) {
                statusChip(issue: issue, store: store)
                priorityChip(issue: issue, store: store)
                assigneeChip(issue: issue)
                labelsChip(issue: issue)
                dueDateChip(issue: issue)
                estimateChip(issue: issue)
                projectChip(issue: issue)
                if issue.team.cyclesEnabled {
                    cycleChip(issue: issue)
                }
                parentChip(issue: issue)
            }
        }
    }

    @ViewBuilder
    private func statusChip(issue: Issue, store: IssueDetailStore) -> some View {
        let states = model.workspaceData.states(forTeam: issue.team.id)
        if states.isEmpty {
            // A disabled control that explains nothing is worse than an absent one, and there
            // are three reasons this list can be empty, not two: the request failed, nobody
            // has made it yet, or the team really has no statuses. Only the last of those is
            // a sentence about the workspace, and saying it while the answer is still on its
            // way is how the picker came to look broken on a cold start.
            switch model.workspaceData.statesAvailability(forTeam: issue.team.id) {
            case .failed:
                Button {
                    Task { await model.workspaceData.reloadStates(forTeam: issue.team.id) }
                } label: {
                    PropertyChip(text: String(localized: "Status: couldn't load — retry"), tint: Theme.accentBright) {
                        StateIcon(state: issue.state, size: 14)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("issue.status.retry")
            case .unknown, .loading:
                PropertyChip(text: issue.state.name, tint: Theme.textSecondary) {
                    StateIcon(state: issue.state, size: 14)
                }
                .accessibilityLabel(Text("Status, \(issue.state.name), loading the rest"))
                .accessibilityIdentifier("issue.status.loading")
            case .loaded:
                PropertyChip(text: String(localized: "No statuses in this team"), tint: Theme.textSecondary) {
                    StateIcon(state: issue.state, size: 14)
                }
                .accessibilityLabel(Text("Status: no statuses in this team"))
            }
        } else {
            Menu {
                ForEach(states) { state in
                    Button {
                        Task { await store.setState(state); writes += 1 }
                    } label: {
                        SwiftUI.Label(state.name, systemImage: state.category.symbolName)
                    }
                }
            } label: {
                PropertyChip(text: issue.state.name) {
                    StateIcon(state: issue.state, size: 14)
                }
            }
            .accessibilityLabel(Text("Status, \(issue.state.name)"))
            .accessibilityIdentifier("issue.status")
            // The one control whose whole job is to show change should say so on the wrist.
            .sensoryFeedback(.impact(weight: .light), trigger: issue.state.id)
        }
    }

    private func priorityChip(issue: Issue, store: IssueDetailStore) -> some View {
        Menu {
            ForEach(Priority.allCases, id: \.self) { value in
                Button {
                    Task { await store.setPriority(value); writes += 1 }
                } label: {
                    SwiftUI.Label(value.label, systemImage: value.symbolName)
                }
            }
        } label: {
            PropertyChip(text: issue.priority.label) {
                PriorityIcon(priority: issue.priority, size: 14)
            }
        }
        .accessibilityLabel(Text("Priority, \(issue.priority.label)"))
        .accessibilityIdentifier("issue.priority")
    }

    private func assigneeChip(issue: Issue) -> some View {
        Button {
            sheet = .assignee
        } label: {
            PropertyChip(text: issue.assignee?.displayName ?? String(localized: "Unassigned")) {
                AvatarView(user: issue.assignee, size: 16)
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Assignee, \(issue.assignee?.displayName ?? String(localized: "Unassigned"))"))
        .accessibilityIdentifier("issue.assignee")
    }

    private func labelsChip(issue: Issue) -> some View {
        let names = issue.labels.map(\.name).joined(separator: ", ")
        return Button {
            sheet = .labels
        } label: {
            PropertyChip(
                text: names.isEmpty ? String(localized: "Add label") : names,
                tint: names.isEmpty ? Theme.textSecondary : Theme.textPrimary
            ) {
                if issue.labels.isEmpty {
                    Image(systemName: "tag")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    LabelDots(labels: issue.labels, shown: 3)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Labels, \(names.isEmpty ? String(localized: "none") : names)"))
        .accessibilityIdentifier("issue.labels")
    }

    private func dueDateChip(issue: Issue) -> some View {
        let due = issue.dueDate.flatMap { DueDateFormat.present($0) }
        let overdue = due?.isOverdue ?? false
        return Button {
            sheet = .dueDate
        } label: {
            PropertyChip(
                text: due?.text ?? String(localized: "Set due date"),
                tint: overdue ? Theme.danger : (due == nil ? Theme.textSecondary : Theme.textPrimary)
            ) {
                Image(systemName: "calendar")
                    .font(.system(size: 12))
                    .foregroundStyle(overdue ? Theme.danger : Theme.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(
            due.map { overdue ? "Due date, overdue, \($0.text)" : "Due date, \($0.text)" }
                ?? String(localized: "Due date, none")
        ))
        .accessibilityIdentifier("issue.dueDate")
    }

    private func estimateChip(issue: Issue) -> some View {
        Button {
            sheet = .estimate
        } label: {
            PropertyChip(
                text: issue.estimate.map { $0 == 1 ? "1 point" : "\($0) points" } ?? String(localized: "Set estimate"),
                tint: issue.estimate == nil ? Theme.textSecondary : Theme.textPrimary
            ) {
                Image(systemName: "number")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Estimate, \(issue.estimate.map(String.init) ?? String(localized: "none"))"))
        .accessibilityIdentifier("issue.estimate")
    }

    private func projectChip(issue: Issue) -> some View {
        let project = model.workspaceData.project(id: issue.projectId)
        return Button {
            sheet = .project
        } label: {
            PropertyChip(
                text: issue.project?.name ?? String(localized: "Add to project"),
                tint: issue.project == nil ? Theme.textSecondary : Theme.textPrimary
            ) {
                Image(systemName: project?.status.category.symbolName ?? "square.stack.3d.up")
                    .font(.system(size: 12))
                    .foregroundStyle(project.map { Theme.hex($0.status.color) } ?? Theme.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Project, \(issue.project?.name ?? String(localized: "none"))"))
        .accessibilityIdentifier("issue.project")
    }

    private func cycleChip(issue: Issue) -> some View {
        Button {
            sheet = .cycle
        } label: {
            PropertyChip(
                text: issue.cycle?.displayName ?? String(localized: "Add to cycle"),
                tint: issue.cycle == nil ? Theme.textSecondary : Theme.textPrimary
            ) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Cycle, \(issue.cycle?.displayName ?? String(localized: "none"))"))
        .accessibilityIdentifier("issue.cycle")
    }

    private func parentChip(issue: Issue) -> some View {
        Button {
            sheet = .parent
        } label: {
            PropertyChip(
                text: issue.parent?.identifier ?? String(localized: "Set parent"),
                tint: issue.parent == nil ? Theme.textSecondary : Theme.textPrimary
            ) {
                Image(systemName: "arrow.turn.down.right")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Parent, \(issue.parent?.identifier ?? String(localized: "none"))"))
        .accessibilityIdentifier("issue.parent")
    }

    // MARK: - Menu

    /// `https://<host>/issue/ENG-1` — the address the web client answers, so a link pasted
    /// into a chat opens for somebody without the app.
    private var webURL: URL? {
        URL(string: "https://\(model.displayHost)/issue/\(seed.identifier)")
    }

    private func overflowMenu(store: IssueDetailStore) -> some View {
        let issue = store.issue.value ?? seed
        return Menu {
            Button {
                Task { await store.setSubscribed(!store.isSubscribed); writes += 1 }
            } label: {
                if store.isSubscribed {
                    SwiftUI.Label("Unsubscribe", systemImage: "bell.slash")
                } else {
                    SwiftUI.Label("Subscribe", systemImage: "bell")
                }
            }
            Divider()
            Button {
                UIPasteboard.general.string = webURL?.absoluteString ?? "polaris://issue/\(seed.id)"
            } label: {
                SwiftUI.Label("Copy link", systemImage: "link")
            }
            Button {
                UIPasteboard.general.string = seed.identifier
            } label: {
                SwiftUI.Label("Copy identifier", systemImage: "doc.on.doc")
            }
            if let webURL {
                Link(destination: webURL) {
                    SwiftUI.Label("Open in browser", systemImage: "safari")
                }
                ShareLink(item: webURL, subject: Text(issue.identifier), message: Text(issue.title)) {
                    SwiftUI.Label("Share", systemImage: "square.and.arrow.up")
                }
            }
            if issue.state.category == .triage {
                Divider()
                Button {
                    Task { await store.acceptTriage(); writes += 1 }
                } label: {
                    SwiftUI.Label("Accept", systemImage: "checkmark.circle")
                }
                Button {
                    Task { await store.declineTriage(); writes += 1 }
                } label: {
                    SwiftUI.Label("Decline", systemImage: "xmark.circle")
                }
            }
            Divider()
            Button(role: .destructive) {
                isConfirmingArchive = true
            } label: {
                SwiftUI.Label("Archive", systemImage: "archivebox")
            }
            Button(role: .destructive) {
                isConfirmingDelete = true
            } label: {
                SwiftUI.Label("Delete", systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis")
        }
        .accessibilityLabel(Text("Issue actions"))
        .accessibilityIdentifier("issue.menu")
    }

    // MARK: - Thread

    /// Everything the feed can look an id up in, from what the app already holds.
    private var names: HistoryText.Names {
        let data = model.workspaceData
        var names = HistoryText.Names()
        for user in data.users.value ?? [] { names.users[user.id] = user.displayName }
        for states in data.statesByTeam.values {
            for state in states { names.states[state.id] = state.name }
        }
        for label in data.labels.value ?? [] { names.labels[label.id] = label.name }
        for project in data.projects.value ?? [] { names.projects[project.id] = project.name }
        if let detail = store?.detail.value {
            for child in detail.children { names.issues[child.id] = child.identifier }
            for relation in detail.relations + detail.blockedBy {
                names.issues[relation.relatedIssue.id] = relation.relatedIssue.identifier
                if let issue = relation.issue { names.issues[issue.id] = issue.identifier }
            }
            if let parent = detail.issue.parent { names.issues[parent.id] = parent.identifier }
            if let cycle = detail.issue.cycle { names.cycles[cycle.id] = cycle.displayName }
        }
        return names
    }

    private func composer(store: IssueDetailStore) -> some View {
        HStack(alignment: .bottom, spacing: Theme.Space.sm) {
            TextField(
                "",
                text: $draftComment,
                prompt: Text("Leave a comment…").foregroundStyle(Theme.placeholder),
                axis: .vertical
            )
            .lineLimit(1...4)
            .font(PolarisText.body)
            .foregroundStyle(Theme.textPrimary)
            .tint(Theme.accentBright)
            .padding(.horizontal, Theme.Space.md)
            .padding(.vertical, Theme.Space.sm + 1)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .fill(Theme.fieldFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
            .focused($commentFocused)
            .accessibilityIdentifier("issue.commentField")

            Button {
                let body = draftComment
                commentFocused = false
                Task {
                    // Cleared only once it has landed. Clearing first destroyed what the
                    // reader typed the moment the server refused.
                    if await store.postComment(body) {
                        draftComment = ""
                        commentsPosted += 1
                    } else {
                        writeFailures += 1
                    }
                }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.accentContrast)
                    .frame(width: 34, height: 34)
                    .background(Theme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
                    .hitTarget(minWidth: 34)
            }
            .buttonStyle(PressableStyle())
            .disabled(isComposerEmpty || store.isPostingComment)
            .opacity(isComposerEmpty || store.isPostingComment ? 0.5 : 1)
            .accessibilityLabel(Text("Post comment"))
            .accessibilityIdentifier("issue.commentSend")
        }
    }

    private var isComposerEmpty: Bool {
        draftComment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func author(for comment: Comment) -> User? {
        switch comment.actor.type {
        case .user, .appUser: model.workspaceData.user(id: comment.actor.id)
        case .integration, .system: nil
        }
    }

    private func authorName(for comment: Comment) -> String {
        switch comment.actor.type {
        case .user, .appUser:
            // A former member, or anyone absent from `users()`, has no name to show. "Someone"
            // reads like a placeholder that failed to fill in; naming the condition does not.
            model.workspaceData.user(id: comment.actor.id)?.displayName
                ?? String(localized: "Former member")
        case .integration: String(localized: "Integration")
        case .system: String(localized: "Polaris")
        }
    }
}
