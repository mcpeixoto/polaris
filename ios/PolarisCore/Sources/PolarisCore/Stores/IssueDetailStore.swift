import Foundation
import Observation

/// One issue and its comments.
@MainActor
@Observable
public final class IssueDetailStore {
    public private(set) var issue: Loadable<Issue>
    public private(set) var comments: Loadable<[Comment]> = .idle
    public private(set) var isPostingComment = false
    /// True while an archive is in flight, so the screen can close itself once it lands.
    public private(set) var isArchived = false
    public private(set) var commentError: PolarisError?
    /// The last refused property write. Separate from `commentError` because they appear in
    /// different places on the screen and one must not clear the other.
    public private(set) var propertyError: PolarisError?

    private let api: any PolarisAPI
    private let issueID: String
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
        onChange: (@MainActor (Issue) -> Void)? = nil
    ) {
        self.api = api
        self.issueID = issue.id
        self.onChange = onChange
        // Seeded from the row the user tapped, so the detail screen opens with content instead
        // of a spinner over data the app already had.
        self.issue = .loaded(issue)
    }

    public init(api: any PolarisAPI, issueID: String) {
        self.api = api
        self.issueID = issueID
        self.onChange = nil
        self.issue = .idle
    }

    public func load() async {
        if issue.value == nil { issue = .loading }
        comments = comments.value == nil ? .loading : comments

        // `Result`, not `try?`. Discarding the error here flattened every failure into two
        // fixed sentences: an offline load of a deep-linked issue read "That's not here any
        // more." — the one message guaranteed to be wrong — and `notFound.isRetryable` is
        // false, so it also removed the Try again button that would have fixed it. Comments
        // reported `.badResponse` for the same reason, including when the reader was simply
        // offline.
        // Bound to locals so the two child tasks capture only Sendable values rather than
        // this @MainActor store.
        let api = self.api
        let id = issueID
        async let fetchedIssue = attempt { try await api.issue(id: id) }
        async let fetchedComments = attempt { try await api.comments(issueId: id) }

        switch await fetchedIssue {
        case .success(let refreshed):
            issue = .loaded(refreshed)
        case .failure(let error):
            let mapped = PolarisError.mapped(error)
            if issue.value == nil { issue = .failed(mapped) }
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

    /// One optimistic write, for every property this screen can change.
    ///
    /// The four of these were the same twenty lines four times over, and the copies had already
    /// begun to differ. The rule they share: apply before the round trip so the control moves
    /// when it is touched, replace with the server's issue rather than assuming the optimistic
    /// one was right — a server-side side effect (`startedAt`, an automation) is real — and
    /// roll the whole issue back if it is refused.
    private func apply(
        _ current: Issue,
        optimistically mutate: (inout Issue) -> Void,
        change: (String) -> IssueChange
    ) async {
        propertyError = nil
        var optimistic = current
        mutate(&optimistic)
        issue = .loaded(optimistic)
        do {
            let updated = try await api.updateIssue(change(issueID))
            issue = .loaded(updated)
            onChange?(updated)
        } catch {
            issue = .loaded(current)
            let mapped = PolarisError.mapped(error)
            propertyError = mapped
            report(mapped)
        }
    }
}
