import SwiftUI
import PolarisCore

struct IssueDetailView: View {
    @Environment(AppModel.self) private var model
    @State private var store: IssueDetailStore?
    @State private var draftComment = ""
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
        .task {
            // Seeded from the row the reader tapped so the screen opens with content, then
            // refreshed in place. A detail view that spinners over data the app already had is
            // the most common self-inflicted slowness in a list-detail app.
            if store == nil {
                store = IssueDetailStore(api: model.api, issue: seed) { updated in
                    // Otherwise the row and the "N open" count keep the old status after the
                    // reader comes back: nothing reloads on return, and refreshIfStale
                    // short-circuits because the version did not move — this client made the
                    // change.
                    model.issues.merge(updated)
                }
            }
            await store?.load()
        }
    }

    @ViewBuilder
    private func content(store: IssueDetailStore) -> some View {
        let issue = store.issue.value ?? seed
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        StateIcon(state: issue.state, size: 16)
                        Text(issue.state.name)
                            .monoFont(11, weight: .medium)
                            .foregroundStyle(Theme.hex(issue.state.color))
                        Text("·").foregroundStyle(Theme.eyebrowText)
                        Text("\(issue.team.key) · \(issue.team.name)")
                            .monoFont(11)
                            .foregroundStyle(Theme.eyebrowText)
                    }

                    Text(issue.title)
                        .displayFont(24, weight: .semibold)
                        .foregroundStyle(Theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    if !issue.description.isEmpty {
                        Text(issue.description)
                            .bodyFont(14)
                            .foregroundStyle(Theme.textSecondary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .staggerRise(0)

                VStack(alignment: .leading, spacing: 8) {
                    properties(issue: issue, store: store)
                    if let error = store.propertyError {
                        InlineErrorLabel(text: error.displayMessage)
                    }
                }
                .padding(.top, 22)
                .staggerRise(1)

                comments(store: store)
                    .padding(.top, 22)
                    .staggerRise(2)
            }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private func properties(issue: Issue, store: IssueDetailStore) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            MonoEyebrow(text: "Properties")
            Card {
                VStack(spacing: 0) {
                    statusRow(issue: issue, store: store)
                    HairlineDivider().padding(.horizontal, 16)
                    priorityRow(issue: issue, store: store)
                    HairlineDivider().padding(.horizontal, 16)
                    assigneeRow(issue: issue, store: store)
                    if !issue.labels.isEmpty {
                        HairlineDivider().padding(.horizontal, 16)
                        HStack {
                            Text("Labels")
                                .bodyFont(14)
                                .foregroundStyle(Theme.textSecondary)
                            Spacer()
                            HStack(spacing: 4) {
                                ForEach(issue.labels) { LabelChip(label: $0) }
                            }
                        }
                        .padding(16)
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
            .padding(16)
        } else {
            statusPicker(issue: issue, store: store, states: states)
        }
    }

    private func statusPicker(
        issue: Issue,
        store: IssueDetailStore,
        states: [WorkflowState]
    ) -> some View {
        Picker(
            selection: Binding(
                get: { issue.state.id },
                set: { newId in
                    guard let next = states.first(where: { $0.id == newId }) else { return }
                    Task { await store.setState(next) }
                }
            )
        ) {
            ForEach(states) { state in
                SwiftUI.Label(state.name, systemImage: state.category.symbolName).tag(state.id)
            }
        } label: {
            Text("Status").bodyFont(14).foregroundStyle(Theme.textSecondary)
        }
        .tint(Theme.accentBright)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    private func priorityRow(issue: Issue, store: IssueDetailStore) -> some View {
        Picker(
            selection: Binding(
                get: { issue.priority },
                set: { next in Task { await store.setPriority(next) } }
            )
        ) {
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

    private func assigneeRow(issue: Issue, store: IssueDetailStore) -> some View {
        let people = model.workspaceData.users.value ?? []
        return Picker(
            selection: Binding<String?>(
                get: { issue.assignee?.id },
                set: { newId in
                    let user = people.first { $0.id == newId }
                    Task { await store.setAssignee(user) }
                }
            )
        ) {
            Text("Unassigned").tag(String?.none)
            ForEach(people) { person in
                Text(person.displayName).tag(String?.some(person.id))
            }
        } label: {
            Text("Assignee").bodyFont(14).foregroundStyle(Theme.textSecondary)
        }
        .tint(Theme.accentBright)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func comments(store: IssueDetailStore) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            MonoEyebrow(text: "Comments")

            switch store.comments {
            case .idle, .loading:
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small).tint(Theme.accentBright)
                    Text("Loading comments")
                        .bodyFont(12.5)
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.vertical, 8)

            case .failed(let error):
                InlineErrorLabel(text: error.displayMessage)

            case .loaded(let comments) where comments.isEmpty:
                Text("No comments yet.")
                    .bodyFont(12.5)
                    .foregroundStyle(Theme.eyebrowText)
                    .padding(.vertical, 4)

            case .loaded(let comments):
                VStack(spacing: 8) {
                    ForEach(comments) { comment in
                        Card(radius: 14) {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 6) {
                                    Text(authorName(for: comment))
                                        .bodyFont(12.5, weight: .bold)
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(comment.createdAt.formatted(date: .abbreviated, time: .shortened))
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
                            .padding(14)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }

            composer(store: store)
                .padding(.top, 6)

            if let error = store.commentError {
                InlineErrorLabel(text: error.displayMessage)
            }
        }
    }

    private func composer(store: IssueDetailStore) -> some View {
        HStack(spacing: 8) {
            TextField(
                "",
                text: $draftComment,
                prompt: Text("Add a comment").foregroundStyle(Color.white.opacity(0.4)),
                axis: .vertical
            )
            .lineLimit(1...4)
            .darkField()
            .focused($commentFocused)

            Button {
                let body = draftComment
                commentFocused = false
                Task {
                    // Cleared only once it has landed. Clearing first destroyed what the
                    // reader typed the moment the server refused.
                    if await store.postComment(body) { draftComment = "" }
                }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Theme.accent)
                    .clipShape(Circle())
            }
            .buttonStyle(PressableStyle())
            .disabled(
                draftComment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || store.isPostingComment
            )
            .opacity(
                draftComment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || store.isPostingComment ? 0.5 : 1
            )
            .accessibilityLabel("Post comment")
        }
    }

    private func authorName(for comment: Comment) -> String {
        switch comment.actor.type {
        case .user, .appUser:
            // A former member, or anyone absent from `users()`, has no name to show. "Someone"
            // reads like a placeholder that failed to fill in; naming the condition does not.
            model.workspaceData.user(id: comment.actor.id)?.displayName ?? "Former member"
        case .integration: "Integration"
        case .system: "Polaris"
        }
    }
}
