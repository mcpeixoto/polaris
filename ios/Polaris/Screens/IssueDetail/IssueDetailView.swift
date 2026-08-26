import SwiftUI
import PolarisCore

struct IssueDetailView: View {
    @Environment(AppModel.self) private var model
    @State private var store: IssueDetailStore?
    @State private var draftComment = ""

    private let seed: Issue

    init(issue: Issue) {
        self.seed = issue
    }

    var body: some View {
        Group {
            if let store {
                content(store: store)
            } else {
                LoadingView()
            }
        }
        .navigationTitle(seed.identifier)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Seeded from the row the user tapped so the screen opens with content, then
            // refreshed in place. A detail view that spinners over data the app already had
            // is the most common self-inflicted slowness in a list-detail app.
            if store == nil {
                store = IssueDetailStore(api: model.api, issue: seed)
            }
            await store?.load()
        }
    }

    @ViewBuilder
    private func content(store: IssueDetailStore) -> some View {
        let issue = store.issue.value ?? seed
        List {
            Section {
                Text(issue.title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)

                if !issue.description.isEmpty {
                    Text(issue.description)
                        .font(TypeScale.body)
                        .foregroundStyle(Theme.secondaryText)
                }
            }

            Section("Properties") {
                statusRow(issue: issue, store: store)
                priorityRow(issue: issue, store: store)
                assigneeRow(issue: issue, store: store)
                LabeledContent("Team", value: "\(issue.team.key) · \(issue.team.name)")

                if !issue.labels.isEmpty {
                    HStack {
                        Text("Labels")
                        Spacer()
                        HStack(spacing: 4) {
                            ForEach(issue.labels) { LabelChip(label: $0) }
                        }
                    }
                }
            }

            commentsSection(store: store)
        }
        .listStyle(.insetGrouped)
    }

    private func statusRow(issue: Issue, store: IssueDetailStore) -> some View {
        let states = model.workspaceData.states(forTeam: issue.team.id)
        return Picker(
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
            Text("Status")
        }
        .disabled(states.isEmpty)
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
            Text("Priority")
        }
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
            Text("Assignee")
        }
    }

    @ViewBuilder
    private func commentsSection(store: IssueDetailStore) -> some View {
        Section("Comments") {
            switch store.comments {
            case .idle, .loading:
                HStack {
                    ProgressView()
                    Text("Loading comments").foregroundStyle(Theme.secondaryText)
                }
            case .failed(let error):
                Text(error.displayMessage).foregroundStyle(Theme.secondaryText)
            case .loaded(let comments) where comments.isEmpty:
                Text("No comments yet.")
                    .font(TypeScale.rowMeta)
                    .foregroundStyle(Theme.secondaryText)
            case .loaded(let comments):
                ForEach(comments) { comment in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(authorName(for: comment))
                            .font(.footnote.weight(.semibold))
                        Text(comment.body)
                            .font(TypeScale.body)
                            .foregroundStyle(Theme.primaryText)
                        Text(comment.createdAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption2)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            }

            HStack {
                TextField("Add a comment", text: $draftComment, axis: .vertical)
                    .lineLimit(1...4)
                Button {
                    let body = draftComment
                    draftComment = ""
                    Task { await store.postComment(body) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .disabled(
                    draftComment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || store.isPostingComment
                )
                .accessibilityLabel("Post comment")
            }

            if let error = store.commentError {
                Text(error.displayMessage)
                    .font(TypeScale.rowMeta)
                    .foregroundStyle(.red)
            }
        }
    }

    private func authorName(for comment: Comment) -> String {
        switch comment.actor.type {
        case .user, .appUser:
            model.workspaceData.user(id: comment.actor.id)?.displayName ?? "Someone"
        case .integration:
            "Integration"
        case .system:
            "Polaris"
        }
    }
}
