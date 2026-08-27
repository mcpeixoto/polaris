import Foundation
import Observation

/// One issue and its comments.
@MainActor
@Observable
public final class IssueDetailStore {
    public private(set) var issue: Loadable<Issue>
    public private(set) var comments: Loadable<[Comment]> = .idle
    public private(set) var isPostingComment = false
    public private(set) var commentError: PolarisError?
    /// The last refused property write. Separate from `commentError` because they appear in
    /// different places on the screen and one must not clear the other.
    public private(set) var propertyError: PolarisError?

    private let api: any PolarisAPI
    private let issueID: String
    /// Called whenever a write succeeds, so the list this screen was opened from can stop
    /// showing the old value.
    private let onChange: (@MainActor (Issue) -> Void)?

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

        async let fetchedIssue = try? api.issue(id: issueID)
        async let fetchedComments = try? api.comments(issueId: issueID)

        if let refreshed = await fetchedIssue {
            issue = .loaded(refreshed)
        } else if issue.value == nil {
            issue = .failed(.notFound)
        }

        if let loaded = await fetchedComments {
            comments = .loaded(loaded.sorted { $0.createdAt < $1.createdAt })
        } else if comments.value == nil {
            comments = .failed(.badResponse)
        }
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
            let created = try await api.createComment(issueId: issueID, body: trimmed)
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

    public func setState(_ state: WorkflowState) async {
        guard let current = issue.value else { return }
        propertyError = nil
        // Applied before the round trip, so the picker moves when it is touched. The previous
        // assignment of `current` here was a no-op: it re-set the value the view already had,
        // which made the write look optimistic while it waited on the server.
        var optimistic = current
        optimistic.state = state
        issue = .loaded(optimistic)
        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, stateId: state.id))
            issue = .loaded(updated)
            onChange?(updated)
        } catch {
            issue = .loaded(current)
            propertyError = (error as? PolarisError) ?? .badResponse
        }
    }

    public func setPriority(_ priority: Priority) async {
        guard let current = issue.value else { return }
        propertyError = nil
        var optimistic = current
        optimistic.priority = priority
        issue = .loaded(optimistic)
        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, priority: priority))
            issue = .loaded(updated)
            onChange?(updated)
        } catch {
            issue = .loaded(current)
            propertyError = (error as? PolarisError) ?? .badResponse
        }
    }

    public func setAssignee(_ user: User?) async {
        guard let current = issue.value else { return }
        propertyError = nil
        var optimistic = current
        optimistic.assignee = user
        issue = .loaded(optimistic)
        do {
            let change = IssueChange(
                id: issueID,
                assigneeId: user?.id,
                clearAssignee: user == nil
            )
            let updated = try await api.updateIssue(change)
            issue = .loaded(updated)
            onChange?(updated)
        } catch {
            issue = .loaded(current)
            propertyError = (error as? PolarisError) ?? .badResponse
        }
    }
}
