import SwiftUI
import PolarisCore

struct IssueDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var store: IssueDetailStore?
    @State private var draftComment = ""
    @State private var draftTitle = ""
    @State private var editingDescription: String?
    @State private var isConfirmingArchive = false
    @State private var commentsPosted = 0
    @State private var writeFailures = 0
    @State private var assigneePickerOpen = false
    @FocusState private var titleFocused: Bool
    @FocusState private var commentFocused: Bool

    private let seed: Issue

    init(issue: Issue) {
        self.seed = issue
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
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if let store { ToolbarItem(placement: .topBarTrailing) { overflowMenu(store: store) } }
        }
        .task {
            // Seeded from the row the reader tapped so the screen opens with content, then
            // refreshed in place. A detail view that spinners over data the app already had is
            // the most common self-inflicted slowness in a list-detail app.
            if store == nil {
                let created = IssueDetailStore(api: model.api, issue: seed) { updated in
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
        .sensoryFeedback(.error, trigger: writeFailures)
    }

    @ViewBuilder
    private func content(store: IssueDetailStore) -> some View {
        let issue = store.issue.value ?? seed
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    HStack(spacing: Theme.Space.sm) {
                        StateIcon(state: issue.state, size: 16)
                            .symbolEffect(.bounce, value: issue.state.id)
                        Text(issue.state.name)
                            .monoFont(11, weight: .medium)
                            .foregroundStyle(Theme.stateColor(issue.state))
                        Text(verbatim: "·").foregroundStyle(Theme.eyebrowText)
                        Text(verbatim: "\(issue.team.key) · \(issue.team.name)")
                            .monoFont(11)
                            .foregroundStyle(Theme.eyebrowText)
                    }

                    titleField(store: store, issue: issue)
                    descriptionBlock(issue: issue)
                }
                .staggerRise(0)

                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    properties(issue: issue, store: store)
                    if let error = store.propertyError {
                        InlineErrorLabel(text: error.displayMessage)
                    }
                }
                .padding(.top, Theme.Space.xxl)
                .staggerRise(1)

                comments(store: store)
                    .padding(.top, Theme.Space.xxl)
                    .staggerRise(2)
            }
            .padding(.horizontal, Theme.Space.xl)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, Theme.Space.xxl)
            .readableColumn()
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.load() }
        // Out of the ScrollView, which is where it used to live: on an issue with twenty
        // comments you had to scroll to the end of the thread before you could reply.
        .safeAreaInset(edge: .bottom) {
            composer(store: store)
                .padding(.horizontal, Theme.Space.xl)
                .padding(.vertical, Theme.Space.sm)
                .background(.bar)
                .readableColumn()
        }
        .onChange(of: store.propertyError == nil) { _, isClear in
            if !isClear { writeFailures += 1 }
        }
        .onChange(of: issue.title) { _, updated in
            // The server's title wins, unless the reader is in the middle of typing one.
            if !titleFocused { draftTitle = updated }
        }
        .sheet(item: Binding(
            get: { editingDescription.map(DescriptionDraft.init) },
            set: { editingDescription = $0?.text }
        )) { draft in
            DescriptionEditor(text: draft.text) { updated in
                Task { await store.setDescription(updated) }
            }
        }
        .sheet(isPresented: $assigneePickerOpen) {
            AssigneePicker(
                people: model.workspaceData.users.value ?? [],
                selected: issue.assignee?.id
            ) { person in
                Task { await store.setAssignee(person) }
            }
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
        .displayFont(24, weight: .semibold)
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

    /// The description, edited in a sheet rather than in place.
    ///
    /// In-place editing of a multi-paragraph body inside a scroll view that also holds a
    /// comment thread fights the keyboard for the same space; a sheet has the whole screen and
    /// an explicit Save.
    @ViewBuilder
    private func descriptionBlock(issue: Issue) -> some View {
        Button {
            editingDescription = issue.description
        } label: {
            if issue.description.isEmpty {
                HStack(spacing: Theme.Space.sm) {
                    Image(systemName: "text.alignleft")
                        .font(.system(size: 12))
                    Text("Add a description")
                    Spacer(minLength: 0)
                }
                .bodyFont(14)
                .foregroundStyle(Theme.placeholder)
            } else {
                Text(issue.description)
                    .bodyFont(14)
                    .foregroundStyle(Theme.textSecondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .multilineTextAlignment(.leading)
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(Text("Description"))
        .accessibilityHint(Text("Opens the description editor"))
        .accessibilityIdentifier("issue.description")
    }

    private func properties(issue: Issue, store: IssueDetailStore) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            MonoEyebrow(text: String(localized: "Properties"))
            Card {
                VStack(spacing: 0) {
                    statusRow(issue: issue, store: store)
                    HairlineDivider().padding(.horizontal, Theme.Space.lg)
                    priorityRow(issue: issue, store: store)
                    HairlineDivider().padding(.horizontal, Theme.Space.lg)
                    assigneeRow(issue: issue)
                    if !issue.labels.isEmpty {
                        HairlineDivider().padding(.horizontal, Theme.Space.lg)
                        HStack {
                            Text("Labels")
                                .bodyFont(14)
                                .foregroundStyle(Theme.textSecondary)
                            Spacer()
                            HStack(spacing: Theme.Space.xs) {
                                ForEach(issue.labels) { LabelChip(label: $0) }
                            }
                        }
                        .padding(Theme.Space.lg)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func statusRow(issue: Issue, store: IssueDetailStore) -> some View {
        let states = model.workspaceData.states(forTeam: issue.team.id)
        if states.isEmpty {
            // A disabled control that explains nothing is worse than an absent one. The two
            // reasons need different sentences, and only one of them is worth retrying.
            HStack {
                Text("Status").bodyFont(14).foregroundStyle(Theme.textSecondary)
                Spacer()
                if model.workspaceData.statesFailedForTeam.contains(issue.team.id) {
                    Button {
                        Task { await model.workspaceData.load() }
                    } label: {
                        Text("Couldn't load — retry")
                            .bodyFont(12.5, weight: .semibold)
                            .underline()
                            .foregroundStyle(Theme.accentBright)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("No statuses in this team")
                        .bodyFont(12.5)
                        .foregroundStyle(Theme.eyebrowText)
                }
            }
            .padding(Theme.Space.lg)
        } else {
            Menu {
                ForEach(states) { state in
                    Button {
                        Task { await store.setState(state) }
                    } label: {
                        SwiftUI.Label(state.name, systemImage: state.category.symbolName)
                    }
                }
            } label: {
                PropertyRow(label: String(localized: "Status")) {
                    HStack(spacing: Theme.Space.sm) {
                        StateIcon(state: issue.state)
                        Text(issue.state.name)
                            .bodyFont(14, weight: .medium)
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
            }
            .accessibilityIdentifier("issue.status")
            // The one control whose whole job is to show change should say so on the wrist.
            .sensoryFeedback(.impact(weight: .light), trigger: issue.state.id)
        }
    }

    private func priorityRow(issue: Issue, store: IssueDetailStore) -> some View {
        Menu {
            ForEach(Priority.allCases, id: \.self) { value in
                Button {
                    Task { await store.setPriority(value) }
                } label: {
                    SwiftUI.Label(value.label, systemImage: value.symbolName)
                }
            }
        } label: {
            PropertyRow(label: String(localized: "Priority")) {
                HStack(spacing: Theme.Space.sm) {
                    PriorityIcon(priority: issue.priority)
                    Text(issue.priority.label)
                        .bodyFont(14, weight: .medium)
                        .foregroundStyle(Theme.textPrimary)
                }
            }
        }
        .accessibilityIdentifier("issue.priority")
    }

    /// A sheet rather than a menu: a workspace's people list is unbounded, and a menu of two
    /// hundred names is not a picker.
    private func assigneeRow(issue: Issue) -> some View {
        Button {
            assigneePickerOpen = true
        } label: {
            PropertyRow(label: String(localized: "Assignee")) {
                HStack(spacing: Theme.Space.sm) {
                    AvatarView(user: issue.assignee, size: 22)
                    Text(issue.assignee?.displayName ?? String(localized: "Unassigned"))
                        .bodyFont(14, weight: .medium)
                        .foregroundStyle(Theme.textPrimary)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("issue.assignee")
    }

    private func overflowMenu(store: IssueDetailStore) -> some View {
        Menu {
            Button {
                // The desktop app registers `polaris://` (docs/03-architecture/07-desktop-apps.md),
                // so a link copied here opens the issue there rather than a browser tab.
                UIPasteboard.general.string = "polaris://issue/\(seed.id)"
            } label: {
                SwiftUI.Label("Copy link", systemImage: "link")
            }
            Button {
                UIPasteboard.general.string = seed.identifier
            } label: {
                SwiftUI.Label("Copy identifier", systemImage: "doc.on.doc")
            }
            Divider()
            Button(role: .destructive) {
                isConfirmingArchive = true
            } label: {
                SwiftUI.Label("Archive", systemImage: "archivebox")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel(Text("Issue actions"))
        .accessibilityIdentifier("issue.menu")
    }

    @ViewBuilder
    private func comments(store: IssueDetailStore) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            MonoEyebrow(text: String(localized: "Comments"))

            switch store.comments {
            case .idle, .loading:
                HStack(spacing: Theme.Space.md) {
                    ProgressView().controlSize(.small).tint(Theme.accentBright)
                    Text("Loading comments")
                        .bodyFont(12.5)
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.vertical, Theme.Space.sm)

            case .failed(let error):
                InlineErrorLabel(
                    text: error.displayMessage,
                    retryLabel: error.isRetryable ? String(localized: "Try again") : nil,
                    onRetry: error.isRetryable ? { Task { await store.load() } } : nil
                )

            case .loaded(let comments) where comments.isEmpty:
                Text("No comments yet.")
                    .bodyFont(12.5)
                    .foregroundStyle(Theme.eyebrowText)
                    .padding(.vertical, Theme.Space.xs)

            case .loaded(let comments):
                VStack(spacing: Theme.Space.sm) {
                    ForEach(comments) { comment in
                        CommentCard(
                            comment: comment,
                            author: author(for: comment),
                            name: authorName(for: comment)
                        )
                    }
                }
            }

            if let error = store.commentError {
                InlineErrorLabel(text: error.displayMessage)
            }
        }
    }

    private func composer(store: IssueDetailStore) -> some View {
        HStack(spacing: Theme.Space.sm) {
            TextField(
                "",
                text: $draftComment,
                prompt: Text("Add a comment").foregroundStyle(Theme.placeholder),
                axis: .vertical
            )
            .lineLimit(1...4)
            .darkField()
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
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.accentContrast)
                    .frame(width: 44, height: 44)
                    .background(Theme.accent)
                    .clipShape(Circle())
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

/// A property row's chrome: the label on the left, the current value and a chevron on the
/// right. Shared by three rows that used to be three differently-configured `Picker`s.
private struct PropertyRow<Value: View>: View {
    let label: String
    @ViewBuilder var value: () -> Value

    var body: some View {
        HStack {
            Text(label)
                .bodyFont(14)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: Theme.Space.md)
            value()
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.eyebrowText)
                .accessibilityHidden(true)
        }
        .padding(Theme.Space.lg)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct CommentCard: View {
    let comment: Comment
    let author: User?
    let name: String
    @State private var showsAbsoluteDate = false

    var body: some View {
        Card(radius: Theme.Radius.md) {
            HStack(alignment: .top, spacing: Theme.Space.md) {
                AvatarView(user: author, size: 26)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    HStack(spacing: Theme.Space.sm) {
                        Text(name)
                            .bodyFont(12.5, weight: .bold)
                            .foregroundStyle(Theme.textPrimary)
                        // Relative by default, because "2h ago" is what a thread is read in.
                        // The absolute date is a tap away rather than gone.
                        Group {
                            if showsAbsoluteDate {
                                Text(comment.createdAt.formatted(date: .abbreviated, time: .shortened))
                            } else {
                                Text(comment.createdAt, format: .relative(presentation: .numeric))
                            }
                        }
                        .monoFont(10)
                        .foregroundStyle(Theme.eyebrowText)
                    }
                    Text(comment.body)
                        .bodyFont(13.5)
                        .foregroundStyle(Theme.textSecondary)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(Theme.Space.lg)
        }
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(Theme.easing(0.25)) { showsAbsoluteDate.toggle() } }
        .contextMenu {
            Button {
                UIPasteboard.general.string = comment.body
            } label: {
                SwiftUI.Label("Copy text", systemImage: "doc.on.doc")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A sheet needs an `Identifiable` item, and a bare `String?` is not one.
private struct DescriptionDraft: Identifiable {
    let text: String
    var id: String { text }
}

private struct DescriptionEditor: View {
    @State private var draft: String
    @Environment(\.dismiss) private var dismiss
    private let onSave: (String) -> Void

    init(text: String, onSave: @escaping (String) -> Void) {
        _draft = State(initialValue: text)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                TextField(
                    "",
                    text: $draft,
                    prompt: Text("What is this issue about?").foregroundStyle(Theme.placeholder),
                    axis: .vertical
                )
                .lineLimit(6...30)
                .bodyFont(14)
                .foregroundStyle(Theme.textPrimary)
                .tint(Theme.accentBright)
                .padding(Theme.Space.xl)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityIdentifier("issue.descriptionEditor")
            }
            .navigationTitle(Text("Description"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Text("Cancel") }
                        .tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        onSave(draft)
                        dismiss()
                    } label: {
                        Text("Save").bodyFont(15, weight: .bold)
                    }
                    .tint(Theme.accentBright)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct AssigneePicker: View {
    let people: [User]
    let selected: String?
    let onPick: (User?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                    dismiss()
                } label: {
                    row(name: String(localized: "Unassigned"), user: nil, isSelected: selected == nil)
                }
                ForEach(people) { person in
                    Button {
                        onPick(person)
                        dismiss()
                    } label: {
                        row(name: person.displayName, user: person, isSelected: person.id == selected)
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle(Text("Assignee"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(name: String, user: User?, isSelected: Bool) -> some View {
        HStack(spacing: Theme.Space.md) {
            AvatarView(user: user, size: 26)
                .accessibilityHidden(true)
            Text(name)
                .bodyFont(15)
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.accentBright)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
