import Foundation
import Observation

/// One issue, everything hanging off it, and every write the detail screen can make.
///
/// `issue` and `detail` are held separately on purpose. `issue` is what the screen was
/// opened with — the row the reader tapped — and stays on screen through a failed refresh;
/// `detail` is the fuller read that arrives afterwards. Every write keeps the two agreeing.
@MainActor
@Observable
public final class IssueDetailStore {
    public private(set) var issue: Loadable<Issue>
    public private(set) var detail: Loadable<IssueDetail> = .idle
    public private(set) var history: Loadable<[IssueHistoryEntry]> = .idle
    public private(set) var comments: Loadable<[Comment]> = .idle
    public private(set) var isPostingComment = false
    /// True while an archive is in flight, so the screen can close itself once it lands.
    public private(set) var isArchived = false
    /// Same, for the trash.
    public private(set) var isDeleted = false
    /// Whether the viewer follows this issue. Derived from `detail.subscribers` on load and
    /// toggled optimistically after — held as its own value so the toggle can move before
    /// the subscriber list is rewritten.
    public private(set) var isSubscribed = false
    public private(set) var commentError: PolarisError?
    /// The last refused property write. Separate from `commentError` because they appear in
    /// different places on the screen and one must not clear the other.
    public private(set) var propertyError: PolarisError?

    private let api: any PolarisAPI
    private let issueID: String
    /// Who is reading, for the writes that are about the reader: subscribe, react. Nil when
    /// the composition root did not say, and then those two stay possible but blind.
    private let viewerId: String?
    /// Called whenever a write succeeds, so the list this screen was opened from can stop
    /// showing the old value.
    private let onChange: (@MainActor (Issue) -> Void)?
    /// The operation id for the comment currently being composed.
    ///
    /// Minted once per draft and held until that draft lands, so a retry after a timeout —
    /// or a second tap that races the disable — is recognised by the server as the same
    /// comment rather than posting a duplicate. The transport used to mint this itself, which
    /// made the id different on every attempt and the idempotency guarantee a fiction for
    /// comments specifically.
    private var pendingCommentOpId: String?
    /// Called on a refused read, so the app can react to a session that expired while the
    /// screen was open instead of showing an error with no way out.
    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    public init(
        api: any PolarisAPI,
        issue: Issue,
        viewerId: String? = nil,
        onChange: (@MainActor (Issue) -> Void)? = nil
    ) {
        self.api = api
        self.issueID = issue.id
        self.viewerId = viewerId
        self.onChange = onChange
        // Seeded from the row the user tapped, so the detail screen opens with content instead
        // of a spinner over data the app already had.
        self.issue = .loaded(issue)
    }

    public init(api: any PolarisAPI, issueID: String, viewerId: String? = nil) {
        self.api = api
        self.issueID = issueID
        self.viewerId = viewerId
        self.onChange = nil
        self.issue = .idle
    }

    public func load() async {
        if issue.value == nil { issue = .loading }
        if detail.value == nil { detail = .loading }
        if history.value == nil { history = .loading }
        comments = comments.value == nil ? .loading : comments

        // `Result`, not `try?`. Discarding the error here flattened every failure into two
        // fixed sentences: an offline load of a deep-linked issue read "That's not here any
        // more." — the one message guaranteed to be wrong — and `notFound.isRetryable` is
        // false, so it also removed the Try again button that would have fixed it. Comments
        // reported `.badResponse` for the same reason, including when the reader was simply
        // offline.
        // Bound to locals so the child tasks capture only Sendable values rather than this
        // @MainActor store.
        let api = self.api
        let id = issueID
        async let fetchedDetail = attempt { try await api.issueDetail(id: id) }
        async let fetchedHistory = attempt { try await api.issueHistory(issueId: id) }
        async let fetchedComments = attempt { try await api.comments(issueId: id) }

        switch await fetchedDetail {
        case .success(let refreshed):
            detail = .loaded(refreshed)
            issue = .loaded(refreshed.issue)
            if let viewerId { isSubscribed = refreshed.isSubscribed(viewerId) }
        case .failure(let error):
            let mapped = PolarisError.mapped(error)
            if issue.value == nil { issue = .failed(mapped) }
            if detail.value == nil { detail = .failed(mapped) }
            report(mapped)
        }

        switch await fetchedHistory {
        case .success(let entries):
            history = .loaded(entries.sorted { $0.createdAt < $1.createdAt })
        case .failure(let error):
            let mapped = PolarisError.mapped(error)
            if history.value == nil { history = .failed(mapped) }
            report(mapped)
        }

        switch await fetchedComments {
        case .success(let loaded):
            comments = .loaded(loaded.sorted { $0.createdAt < $1.createdAt })
        case .failure(let error):
            let mapped = PolarisError.mapped(error)
            if comments.value == nil { comments = .failed(mapped) }
            report(mapped)
        }
    }

    private func report(_ error: PolarisError) {
        if case .unauthorized = error { onUnauthorized?(error) }
    }

    /// Writes the issue to both places it is held.
    private func setIssue(_ updated: Issue) {
        issue = .loaded(updated)
        if var current = detail.value {
            current.issue = updated
            detail = .loaded(current)
        }
    }

    // MARK: - Comments

    /// Posts a comment, and reports whether it landed.
    ///
    /// The caller clears its draft only on success. Clearing before the await destroyed what
    /// the reader had typed the moment the server refused — the error was shown, and the words
    /// it was about were gone and unrecoverable.
    @discardableResult
    public func postComment(_ body: String) async -> Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        isPostingComment = true
        commentError = nil
        defer { isPostingComment = false }

        do {
            let opId = pendingCommentOpId ?? UUIDv7.string()
            pendingCommentOpId = opId
            let created = try await api.createComment(issueId: issueID, body: trimmed, opId: opId)
            // Cleared only once it landed: the next comment is a new operation, but every
            // retry of *this* one has to keep the id it started with.
            pendingCommentOpId = nil
            var current = comments.value ?? []
            current.append(created)
            comments = .loaded(current)
            return true
        } catch let error as PolarisError {
            commentError = error
            return false
        } catch {
            commentError = .badResponse
            return false
        }
    }

    /// Rewrites a comment's body. The new text shows at once and the old one comes back if
    /// the server refuses — with the reason beside it, so the reader can copy what they typed.
    @discardableResult
    public func editComment(id: String, body: String) async -> Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, var list = comments.value,
              let index = list.firstIndex(where: { $0.id == id })
        else { return false }
        let original = list[index]
        guard trimmed != original.body else { return true }
        commentError = nil
        list[index].body = trimmed
        list[index].editedAt = Date()
        comments = .loaded(list)
        do {
            let updated = try await api.updateComment(id: id, body: trimmed, opId: UUIDv7.string())
            replaceComment(updated)
            return true
        } catch {
            replaceComment(original)
            commentError = PolarisError.mapped(error)
            report(commentError!)
            return false
        }
    }

    /// Removes a comment. Restored in place — not appended — if refused, for the reason the
    /// inbox gives: a row that reappears at the bottom reads as a new comment.
    @discardableResult
    public func deleteComment(id: String) async -> Bool {
        guard var list = comments.value, let index = list.firstIndex(where: { $0.id == id }) else {
            return false
        }
        commentError = nil
        let removed = list.remove(at: index)
        comments = .loaded(list)
        do {
            try await api.deleteComment(id: id, opId: UUIDv7.string())
            return true
        } catch {
            var restored = comments.value ?? []
            restored.insert(removed, at: min(index, restored.count))
            comments = .loaded(restored)
            commentError = PolarisError.mapped(error)
            report(commentError!)
            return false
        }
    }

    /// Adds the viewer's emoji if it is not there, removes it if it is.
    ///
    /// `viewerId` is a parameter rather than the stored one because a reaction is a
    /// signature: the screen must say whose it is, and a store built without a viewer must
    /// not guess.
    public func toggleReaction(commentId: String, emoji: String, viewerId: String) async {
        guard var list = comments.value, let index = list.firstIndex(where: { $0.id == commentId }) else {
            return
        }
        commentError = nil
        let original = list[index]
        let opId = UUIDv7.string()
        if original.hasReaction(emoji, by: viewerId) {
            list[index].reactions.removeAll { $0.emoji == emoji && $0.userId == viewerId }
            comments = .loaded(list)
            do {
                try await api.removeReaction(commentId: commentId, emoji: emoji, opId: opId)
            } catch {
                replaceComment(original)
                commentError = PolarisError.mapped(error)
                report(commentError!)
            }
        } else {
            let placeholder = Reaction(
                id: "pending-\(opId)", commentId: commentId, userId: viewerId, emoji: emoji, createdAt: Date()
            )
            list[index].reactions.append(placeholder)
            comments = .loaded(list)
            do {
                let created = try await api.addReaction(commentId: commentId, emoji: emoji, opId: opId)
                if var current = comments.value,
                   let position = current.firstIndex(where: { $0.id == commentId }) {
                    current[position].reactions = current[position].reactions.map {
                        $0.id == placeholder.id ? created : $0
                    }
                    comments = .loaded(current)
                }
            } catch {
                replaceComment(original)
                commentError = PolarisError.mapped(error)
                report(commentError!)
            }
        }
    }

    private func replaceComment(_ comment: Comment) {
        guard var current = comments.value,
              let position = current.firstIndex(where: { $0.id == comment.id })
        else { return }
        current[position] = comment
        comments = .loaded(current)
    }

    // MARK: - Properties

    /// Renames the issue.
    ///
    /// A no-op when the text is unchanged or blank, because the field commits on focus loss
    /// as well as on return — so simply tapping away from a title nobody edited must not
    /// mint a write, and clearing it entirely must not save an issue with no name.
    public func setTitle(_ title: String) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let current = issue.value, !trimmed.isEmpty, trimmed != current.title else { return }
        await apply(current) { $0.title = trimmed } change: { IssueChange(id: $0, title: trimmed) }
    }

    /// An empty description is legitimate — it is how you delete one — so unlike the title
    /// this only skips a write when nothing actually changed.
    public func setDescription(_ description: String) async {
        guard let current = issue.value, description != current.description else { return }
        await apply(current) { $0.description = description } change: {
            IssueChange(id: $0, description: description)
        }
    }

    public func setState(_ state: WorkflowState) async {
        guard let current = issue.value else { return }
        await apply(current) { $0.state = state } change: { IssueChange(id: $0, stateId: state.id) }
    }

    public func setPriority(_ priority: Priority) async {
        guard let current = issue.value else { return }
        await apply(current) { $0.priority = priority } change: {
            IssueChange(id: $0, priority: priority)
        }
    }

    public func setAssignee(_ user: User?) async {
        guard let current = issue.value else { return }
        await apply(current) { $0.assignee = user } change: {
            IssueChange(id: $0, assigneeId: user?.id, clearAssignee: user == nil)
        }
    }

    /// A calendar day, `2006-01-02`, or nil to clear. Nil is sent as the clear flag, not as
    /// an absent key — see `IssueChange`.
    public func setDueDate(_ dueDate: String?) async {
        guard let current = issue.value, dueDate != current.dueDate else { return }
        await apply(current) { $0.dueDate = dueDate } change: {
            IssueChange(id: $0, dueDate: dueDate, clearDueDate: dueDate == nil)
        }
    }

    public func setEstimate(_ estimate: Int?) async {
        guard let current = issue.value, estimate != current.estimate else { return }
        await apply(current) { $0.estimate = estimate } change: {
            IssueChange(id: $0, estimate: estimate, clearEstimate: estimate == nil)
        }
    }

    public func setProject(_ project: ProjectRef?) async {
        guard let current = issue.value, project?.id != current.projectId else { return }
        await apply(current) {
            $0.project = project
            $0.projectId = project?.id
        } change: {
            IssueChange(id: $0, projectId: project?.id, clearProject: project == nil)
        }
    }

    public func setCycle(_ cycle: CycleRef?) async {
        guard let current = issue.value, cycle?.id != current.cycleId else { return }
        await apply(current) {
            $0.cycle = cycle
            $0.cycleId = cycle?.id
        } change: {
            IssueChange(id: $0, cycleId: cycle?.id, clearCycle: cycle == nil)
        }
    }

    public func setParent(_ parent: IssueRef?) async {
        guard let current = issue.value, parent?.id != current.parentId, parent?.id != current.id else { return }
        await apply(current) {
            $0.parent = parent
            $0.parentId = parent?.id
        } change: {
            IssueChange(id: $0, parentId: parent?.id, clearParent: parent == nil)
        }
    }

    /// One optimistic write, for every property this screen can change.
    ///
    /// The rule they share: apply before the round trip so the control moves when it is
    /// touched, replace with the server's issue rather than assuming the optimistic one was
    /// right — a server-side side effect (`startedAt`, an automation) is real — and roll
    /// the whole issue back if it is refused.
    private func apply(
        _ current: Issue,
        optimistically mutate: (inout Issue) -> Void,
        change: (String) -> IssueChange
    ) async {
        propertyError = nil
        var optimistic = current
        mutate(&optimistic)
        setIssue(optimistic)
        do {
            let updated = try await api.updateIssue(change(issueID))
            setIssue(updated)
            onChange?(updated)
        } catch {
            setIssue(current)
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
        }
    }

    // MARK: - Labels

    /// Adds one label — never sets the whole list, for the reason the schema gives: two
    /// people adding different labels a second apart must both win.
    public func addLabel(_ label: Label) async {
        guard let current = issue.value, !current.labels.contains(where: { $0.id == label.id }) else { return }
        propertyError = nil
        var optimistic = current
        optimistic.labels.append(label)
        setIssue(optimistic)
        do {
            let stored = try await api.addIssueLabel(issueId: issueID, labelId: label.id, opId: UUIDv7.string())
            if var latest = issue.value {
                latest.labels = latest.labels.map { $0.id == stored.id ? stored : $0 }
                setIssue(latest)
                onChange?(latest)
            }
        } catch {
            setIssue(current)
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
        }
    }

    public func removeLabel(_ label: Label) async {
        guard let current = issue.value, current.labels.contains(where: { $0.id == label.id }) else { return }
        propertyError = nil
        var optimistic = current
        optimistic.labels.removeAll { $0.id == label.id }
        setIssue(optimistic)
        do {
            try await api.removeIssueLabel(issueId: issueID, labelId: label.id, opId: UUIDv7.string())
            if let latest = issue.value { onChange?(latest) }
        } catch {
            setIssue(current)
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
        }
    }

    // MARK: - Subscription, links, triage, lifecycle

    public func setSubscribed(_ subscribed: Bool) async {
        guard subscribed != isSubscribed else { return }
        propertyError = nil
        let before = isSubscribed
        let beforeDetail = detail
        isSubscribed = subscribed
        if let viewerId, var current = detail.value {
            current.subscribers.removeAll { $0.userId == viewerId }
            current.subscribers.append(
                IssueSubscription(userId: viewerId, unsubscribed: !subscribed, reason: "MANUAL")
            )
            detail = .loaded(current)
        }
        do {
            let row = try await api.setIssueSubscription(issueId: issueID, subscribed: subscribed)
            isSubscribed = row.isActive
            if var current = detail.value {
                current.subscribers.removeAll { $0.userId == row.userId }
                current.subscribers.append(row)
                detail = .loaded(current)
            }
        } catch {
            isSubscribed = before
            detail = beforeDetail
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
        }
    }

    /// Attaches a link card. Shown at once under a provisional id and swapped for the
    /// server's row — which may be an *existing* card, because the same URL twice is one.
    @discardableResult
    public func addLink(url: String, title: String?) async -> Bool {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, var current = detail.value else { return false }
        propertyError = nil
        let before = current
        let placeholder = Attachment(
            id: "pending-\(UUIDv7.string())", url: trimmed,
            title: title?.isEmpty == false ? title! : trimmed,
            subtitle: nil, iconUrl: nil, createdAt: Date()
        )
        current.attachments.append(placeholder)
        detail = .loaded(current)
        do {
            let created = try await api.createAttachment(
                issueId: issueID, url: trimmed, title: title, opId: UUIDv7.string()
            )
            if var latest = detail.value {
                latest.attachments.removeAll { $0.id == placeholder.id || $0.id == created.id }
                latest.attachments.append(created)
                detail = .loaded(latest)
            }
            return true
        } catch {
            detail = .loaded(before)
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
            return false
        }
    }

    /// Accepts the issue out of triage. Nothing is applied ahead of the reply: the status it
    /// lands in is the team's default, which this client does not know.
    public func acceptTriage() async {
        await triage { try await self.api.acceptTriageIssue(id: $0, opId: UUIDv7.string()) }
    }

    public func declineTriage() async {
        await triage { try await self.api.declineTriageIssue(id: $0, opId: UUIDv7.string()) }
    }

    private func triage(_ operation: (String) async throws -> Issue) async {
        guard issue.value != nil else { return }
        propertyError = nil
        do {
            let updated = try await operation(issueID)
            setIssue(updated)
            onChange?(updated)
        } catch {
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
        }
    }

    /// Files a sub-issue under this one. The child appears in `detail.children` with a
    /// provisional identifier until the server assigns the number.
    @discardableResult
    public func createSubIssue(title: String) async -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let current = issue.value, var currentDetail = detail.value else { return false }
        propertyError = nil
        let before = currentDetail
        let draft = IssueDraft(teamId: current.team.id, title: trimmed, parentId: current.id)
        let placeholder = Issue(
            id: draft.id,
            identifier: "\(current.team.key)-…",
            title: trimmed,
            state: current.state,
            team: current.team,
            creator: nil,
            parentId: current.id,
            parent: current.ref
        )
        currentDetail.children.append(placeholder)
        detail = .loaded(currentDetail)
        do {
            let created = try await api.createIssue(draft)
            if var latest = detail.value {
                latest.children = latest.children.map { $0.id == placeholder.id ? created : $0 }
                detail = .loaded(latest)
            }
            return true
        } catch {
            detail = .loaded(before)
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
            return false
        }
    }

    /// Archives the issue and reports whether it landed, so the screen can pop itself.
    @discardableResult
    public func archive() async -> Bool {
        guard let current = issue.value else { return false }
        propertyError = nil
        do {
            try await api.archiveIssue(id: current.id, archived: true, opId: UUIDv7.string())
            isArchived = true
            return true
        } catch {
            propertyError = PolarisError.mapped(error)
            return false
        }
    }

    /// Moves the issue to the trash and reports whether it landed.
    @discardableResult
    public func delete() async -> Bool {
        guard let current = issue.value else { return false }
        propertyError = nil
        do {
            try await api.deleteIssue(id: current.id, opId: UUIDv7.string())
            isDeleted = true
            return true
        } catch {
            propertyError = PolarisError.mapped(error)
            return false
        }
    }
}
