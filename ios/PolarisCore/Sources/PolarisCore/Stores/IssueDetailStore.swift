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

    private let api: any PolarisAPI
    private let issueID: String

    public init(api: any PolarisAPI, issue: Issue) {
        self.api = api
        self.issueID = issue.id
        // Seeded from the row the user tapped, so the detail screen opens with content instead
        // of a spinner over data the app already had.
        self.issue = .loaded(issue)
    }

    public init(api: any PolarisAPI, issueID: String) {
        self.api = api
        self.issueID = issueID
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

    public func postComment(_ body: String) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isPostingComment = true
        commentError = nil
        defer { isPostingComment = false }

        do {
            let created = try await api.createComment(issueId: issueID, body: trimmed)
            var current = comments.value ?? []
            current.append(created)
            comments = .loaded(current)
        } catch let error as PolarisError {
            commentError = error
        } catch {
            commentError = .badResponse
        }
    }

    public func setState(_ state: WorkflowState) async {
        guard let current = issue.value else { return }
        issue = .loaded(current)
        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, stateId: state.id))
            issue = .loaded(updated)
        } catch {
            issue = .loaded(current)
        }
    }

    public func setPriority(_ priority: Priority) async {
        guard let current = issue.value else { return }
        do {
            let updated = try await api.updateIssue(IssueChange(id: issueID, priority: priority))
            issue = .loaded(updated)
        } catch {
            issue = .loaded(current)
        }
    }

    public func setAssignee(_ user: User?) async {
        guard let current = issue.value else { return }
        do {
            let change = IssueChange(
                id: issueID,
                assigneeId: user?.id,
                clearAssignee: user == nil
            )
            issue = .loaded(try await api.updateIssue(change))
        } catch {
            issue = .loaded(current)
        }
    }
}
