import Foundation

/// A write that failed, held so that the retry is the *same* operation.
///
/// The server keys idempotency on the pair `(clientId, opId)` — see
/// `services/internal/domain/idempotency.go` — so a second attempt only replays the original
/// result instead of applying a second time when *both* halves of that pair survive.
/// `ClientIdentity` is the first half. This is the second: the store keeps the `opId` of the
/// attempt that failed and sends that one again, rather than letting `IssueChange`'s default
/// mint a fresh one and turn a retry into a new operation.
///
/// In memory, per store, for the life of the process — which is now exactly the window in
/// which the pair is safe, and safe across a relaunch too. Nothing here is written to disk,
/// deliberately: a durable outbox would mean showing unconfirmed values across six stores that
/// only fan out *confirmed* ones (`AppModel.issueDidChange`), offline reads that do not exist
/// (`IssueCache` holds one list and no detail, comments or search), and a queue drained after a
/// long weekend has no protection left anyway, because `IdempotencyTTL` is 24 hours.
public struct PendingWrite: Sendable, Equatable {
    public let operation: PendingWriteOperation
    /// The id the server pairs with this install's `clientId`. Read off the operation at
    /// construction, so the two cannot drift apart.
    public let opId: String
    public let attemptedAt: Date
    /// Why it failed, which is the whole of what decides whether a retry is honest.
    public let failure: PolarisError

    /// Whether a screen should offer Retry. `PolarisError.isRetryable` draws the line, and it
    /// is trustworthy because `PolarisError.from(urlError:)` groups the transport's codes by
    /// what the reader can do about them rather than by what the URL loading system called
    /// them. A refusal — `.forbidden`, a validation error — is refused identically every time,
    /// so a button that re-sends it is a button that lies.
    public var isRetryable: Bool { failure.isRetryable }

    public init(
        operation: PendingWriteOperation,
        failure: PolarisError,
        attemptedAt: Date = Date()
    ) {
        self.operation = operation
        self.opId = operation.opId
        self.attemptedAt = attemptedAt
        self.failure = failure
    }
}

/// What a store would send again.
///
/// A value rather than a closure: the `opId` has to be *inspectable* — it is the thing a test
/// pins and the thing the whole fix is about — and a captured closure hides it.
public enum PendingWriteOperation: Sendable, Hashable {
    /// Every property write on the detail screen and every status change from a list row.
    case issue(IssueChange)
    case bulk(BulkIssueEdit)
    case comment(issueId: String, body: String, opId: String)
    case addLabel(issueId: String, labelId: String, opId: String)
    case removeLabel(issueId: String, labelId: String, opId: String)

    public var opId: String {
        switch self {
        case .issue(let change): change.opId
        case .bulk(let edit): edit.change.opId
        case .comment(_, _, let opId): opId
        case .addLabel(_, _, let opId): opId
        case .removeLabel(_, _, let opId): opId
        }
    }

    /// The issues this write is about. No screen reads it yet: marking a kept optimistic row
    /// as pending-with-a-problem needs the stores to stop rolling back on a retryable failure,
    /// and four pre-existing tests pin that rollback. This is what that marking would read.
    public var issueIDs: Set<String> {
        switch self {
        case .issue(let change): [change.id]
        case .bulk(let edit): Set(edit.change.ids)
        case .comment(let issueId, _, _): [issueId]
        case .addLabel(let issueId, _, _): [issueId]
        case .removeLabel(let issueId, _, _): [issueId]
        }
    }

    /// Whether what this write asked for is already true of `issue`.
    ///
    /// A confirmed value reaches a store by routes that have nothing to do with the store's own
    /// write: `AppModel.issueDidChange` fanning out somebody else's, or the refetch a sync
    /// signal triggers. When it has, the question the retry would ask has been answered — so
    /// the pending write is dropped and the retry is a no-op, rather than a second guess.
    public func isSatisfied(by issue: Issue) -> Bool {
        switch self {
        case .issue(let change):
            change.id == issue.id && change.isSatisfied(by: issue)
        // One confirmed row out of ten is not the batch landing, and a store hears about them
        // one at a time. Left to the retry, which the server answers from the idempotency
        // record it already holds for this `opId`.
        case .bulk:
            false
        case .addLabel(let issueId, let labelId, _):
            issueId == issue.id && issue.labels.contains { $0.id == labelId }
        case .removeLabel(let issueId, let labelId, _):
            issueId == issue.id && !issue.labels.contains { $0.id == labelId }
        // A comment is not a property of the issue: nothing an arriving issue can answer.
        case .comment:
            false
        }
    }
}

extension IssueChange {
    /// Whether every field this change names already holds the asked-for value.
    ///
    /// Only the fields it names: a change that sets a status says nothing about the title, and
    /// comparing whole issues would call a confirmed status change unsatisfied because the
    /// server also moved `updatedAt`.
    func isSatisfied(by issue: Issue) -> Bool {
        if let title, issue.title != title { return false }
        if let description, issue.description != description { return false }
        if let stateId, issue.state.id != stateId { return false }
        if let priority, issue.priority != priority { return false }
        if clearAssignee {
            if issue.assignee != nil { return false }
        } else if let assigneeId, issue.assignee?.id != assigneeId {
            return false
        }
        if clearEstimate {
            if issue.estimate != nil { return false }
        } else if let estimate, issue.estimate != estimate {
            return false
        }
        if clearDueDate {
            if issue.dueDate != nil { return false }
        } else if let dueDate, issue.dueDate != dueDate {
            return false
        }
        if clearParent {
            if issue.parentId != nil { return false }
        } else if let parentId, issue.parentId != parentId {
            return false
        }
        if clearProject {
            if issue.projectId != nil { return false }
        } else if let projectId, issue.projectId != projectId {
            return false
        }
        if clearCycle {
            if issue.cycleId != nil { return false }
        } else if let cycleId, issue.cycleId != cycleId {
            return false
        }
        return true
    }
}
