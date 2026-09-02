import Foundation

/// Mirrors `enum NotificationType` in schema/schema.graphql.
///
/// Named with the product prefix because `Notification` alone is `Foundation.Notification`,
/// and a type that shadows it inside a module that imports Foundation is a trap for every
/// future reader of this file.
public enum PolarisNotificationType: String, Codable, Sendable, Hashable {
    case issueAssigned = "ISSUE_ASSIGNED"
    case issueStatusChanged = "ISSUE_STATUS_CHANGED"
    case issuePriorityRaised = "ISSUE_PRIORITY_RAISED"
    case issueDue = "ISSUE_DUE"
    case issueBlocked = "ISSUE_BLOCKED"
    case comment = "COMMENT"
    case mention = "MENTION"
    case subIssueCompleted = "SUB_ISSUE_COMPLETED"
    case other = "OTHER"

    /// The server's enum is far longer than the cases this client renders differently, and it
    /// grows between releases. Anything unrecognised becomes `.other`, which reads as an
    /// ordinary inbox row rather than emptying somebody's inbox.
    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PolarisNotificationType(rawValue: raw) ?? .other
    }

    public var symbolName: String {
        switch self {
        case .issueAssigned: "person.crop.circle.badge.checkmark"
        case .issueStatusChanged: "arrow.triangle.swap"
        case .issuePriorityRaised: "exclamationmark.triangle"
        case .issueDue: "calendar.badge.exclamationmark"
        case .issueBlocked: "hand.raised"
        case .comment: "bubble.left"
        case .mention: "at"
        case .subIssueCompleted: "checkmark.circle"
        case .other: "bell"
        }
    }

    /// What happened, in the words a person would use. The issue itself is rendered beside
    /// this, so the sentence deliberately does not repeat the identifier.
    public var summary: String {
        switch self {
        case .issueAssigned: String(localized: "Assigned to you")
        case .issueStatusChanged: String(localized: "Status changed")
        case .issuePriorityRaised: String(localized: "Priority raised")
        case .issueDue: String(localized: "Due soon")
        case .issueBlocked: String(localized: "Blocked")
        case .comment: String(localized: "New comment")
        case .mention: String(localized: "You were mentioned")
        case .subIssueCompleted: String(localized: "Sub-issue completed")
        case .other: String(localized: "Update")
        }
    }
}

/// One inbox row.
///
/// `payload` is deliberately not decoded: it is a `JSON` scalar whose shape varies by
/// notification type, and every field this client renders is either on the row itself or on
/// the issue it hangs off.
public struct PolarisNotification: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let type: PolarisNotificationType
    public let issueId: String?
    public let commentId: String?
    public let actor: Actor
    /// How many events collapsed into this row. 1 for an ordinary notification.
    public let count: Int
    /// `var` so an optimistic read/snooze can build a modified copy before the server
    /// replies, the same way `Issue.state` does.
    public var readAt: Date?
    public var snoozedUntil: Date?
    public let createdAt: Date
    /// Present when the server could resolve it. Absent for a notification about something
    /// the reader can no longer see.
    public let issue: Issue?

    enum CodingKeys: String, CodingKey {
        case id, type, issueId, commentId, actor, count, readAt, snoozedUntil, createdAt, issue
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decode(PolarisNotificationType.self, forKey: .type)
        issueId = try c.decodeIfPresent(String.self, forKey: .issueId)
        commentId = try c.decodeIfPresent(String.self, forKey: .commentId)
        actor = try c.decode(Actor.self, forKey: .actor)
        count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 1
        readAt = try c.decodeIfPresent(Date.self, forKey: .readAt)
        snoozedUntil = try c.decodeIfPresent(Date.self, forKey: .snoozedUntil)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        issue = try c.decodeIfPresent(Issue.self, forKey: .issue)
    }

    public var isRead: Bool { readAt != nil }

    /// The line under the summary: the issue this is about, or an honest admission that the
    /// row outlived what it pointed at.
    public var subtitle: String {
        if let issue { return "\(issue.identifier) · \(issue.title)" }
        return String(localized: "This issue is no longer available")
    }
}

/// What `search` hands back. `comments` is not selected: a phone-sized result list shows
/// issues, and asking for comments would double the response for a section with nowhere to go.
public struct SearchResults: Codable, Sendable, Hashable {
    public let issues: [Issue]
    /// Total matches before the limit, so the list can say "showing 25 of 400".
    public let issueCount: Int

    enum CodingKeys: String, CodingKey { case issues, issueCount }

    public init(issues: [Issue], issueCount: Int) {
        self.issues = issues
        self.issueCount = issueCount
    }
}
