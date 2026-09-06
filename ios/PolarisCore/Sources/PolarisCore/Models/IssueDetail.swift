import Foundation

// Everything that hangs off one issue and is only worth fetching when it is open.

/// One row of the activity feed. `fromValue`/`toValue` are `JSON` scalars whose shape
/// depends on `kind`, so they are kept as values rather than typed here.
public struct IssueHistoryEntry: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let kind: String
    public let actor: Actor
    public let fromValue: JSONValue?
    public let toValue: JSONValue?
    public let createdAt: Date

    enum CodingKeys: String, CodingKey { case id, kind, actor, fromValue, toValue, createdAt }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        actor = try c.decode(Actor.self, forKey: .actor)
        fromValue = try c.decodeIfPresent(JSONValue.self, forKey: .fromValue)
        toValue = try c.decodeIfPresent(JSONValue.self, forKey: .toValue)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
    }
}

/// One person's emoji on one comment.
public struct Reaction: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let commentId: String
    public let userId: String
    public let emoji: String
    public let createdAt: Date

    enum CodingKeys: String, CodingKey { case id, commentId, userId, emoji, createdAt }

    public init(id: String, commentId: String, userId: String, emoji: String, createdAt: Date) {
        self.id = id
        self.commentId = commentId
        self.userId = userId
        self.emoji = emoji
        self.createdAt = createdAt
    }
}

/// A link card on an issue.
public struct Attachment: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let url: String
    public let title: String
    public let subtitle: String?
    public let iconUrl: String?
    public let createdAt: Date

    enum CodingKeys: String, CodingKey { case id, url, title, subtitle, iconUrl, createdAt }

    public init(id: String, url: String, title: String, subtitle: String?, iconUrl: String?, createdAt: Date) {
        self.id = id
        self.url = url
        self.title = title
        self.subtitle = subtitle
        self.iconUrl = iconUrl
        self.createdAt = createdAt
    }
}

/// Mirrors `enum RelationType`.
public enum RelationType: String, Codable, Sendable, Hashable, CaseIterable {
    case blocks = "BLOCKS"
    case related = "RELATED"
    case duplicate = "DUPLICATE"

    /// Unknown kinds read as `.related` — the one that claims nothing about direction.
    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RelationType(rawValue: raw) ?? .related
    }
}

/// One relation row, read from either end.
///
/// `BLOCKS` is the only direction stored: on `relations` this issue is `issue` and the
/// other end is `relatedIssue`; on `blockedBy` the same row arrives with the blocker as
/// `issue` and this issue as `relatedIssue`. `counterpart(of:)` hides which end a caller
/// is holding.
public struct IssueRelation: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let type: RelationType
    public let issue: IssueRef?
    public let relatedIssue: IssueRef

    enum CodingKeys: String, CodingKey { case id, type, issue, relatedIssue }

    public init(id: String, type: RelationType, issue: IssueRef?, relatedIssue: IssueRef) {
        self.id = id
        self.type = type
        self.issue = issue
        self.relatedIssue = relatedIssue
    }

    /// The end that is not `issueId`.
    public func counterpart(of issueId: String) -> IssueRef {
        if relatedIssue.id == issueId, let issue { return issue }
        return relatedIssue
    }
}

/// Why somebody is subscribed. Kept as the wire string: the inbox only ever displays it.
public struct IssueSubscription: Codable, Sendable, Hashable {
    public let userId: String
    public let unsubscribed: Bool
    public let reason: String

    enum CodingKeys: String, CodingKey { case userId, unsubscribed, reason }

    public init(userId: String, unsubscribed: Bool, reason: String) {
        self.userId = userId
        self.unsubscribed = unsubscribed
        self.reason = reason
    }

    /// A row with `unsubscribed` set is an explicit opt-out, not a missing row.
    public var isActive: Bool { !unsubscribed }
}

/// The detail screen's whole read, in one query.
public struct IssueDetail: Codable, Sendable, Hashable {
    public var issue: Issue
    public var children: [Issue]
    public var attachments: [Attachment]
    public var relations: [IssueRelation]
    public var blockedBy: [IssueRelation]
    public var subscribers: [IssueSubscription]

    enum CodingKeys: String, CodingKey {
        case issue, children, attachments, relations, blockedBy, subscribers
    }

    public init(
        issue: Issue,
        children: [Issue] = [],
        attachments: [Attachment] = [],
        relations: [IssueRelation] = [],
        blockedBy: [IssueRelation] = [],
        subscribers: [IssueSubscription] = []
    ) {
        self.issue = issue
        self.children = children
        self.attachments = attachments
        self.relations = relations
        self.blockedBy = blockedBy
        self.subscribers = subscribers
    }

    /// The wire shape is the issue itself with the extra selections on it, not a wrapper —
    /// so this reads the issue from the same container and then the lists beside it.
    public init(from decoder: any Decoder) throws {
        issue = try Issue(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        children = try c.decodeIfPresent([Issue].self, forKey: .children) ?? []
        attachments = try c.decodeIfPresent([Attachment].self, forKey: .attachments) ?? []
        relations = try c.decodeIfPresent([IssueRelation].self, forKey: .relations) ?? []
        blockedBy = try c.decodeIfPresent([IssueRelation].self, forKey: .blockedBy) ?? []
        subscribers = try c.decodeIfPresent([IssueSubscription].self, forKey: .subscribers) ?? []
    }

    public func encode(to encoder: any Encoder) throws {
        try issue.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(children, forKey: .children)
        try c.encode(attachments, forKey: .attachments)
        try c.encode(relations, forKey: .relations)
        try c.encode(blockedBy, forKey: .blockedBy)
        try c.encode(subscribers, forKey: .subscribers)
    }

    /// Whether `userId` is subscribed and has not opted out.
    public func isSubscribed(_ userId: String) -> Bool {
        subscribers.contains { $0.userId == userId && $0.isActive }
    }
}
