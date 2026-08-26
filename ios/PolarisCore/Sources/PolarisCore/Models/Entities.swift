import Foundation

// Wire types for schema/schema.graphql. Every one spells out its CodingKeys rather than
// leaning on a key-decoding strategy, so the mapping stays greppable against the contract —
// when a field is renamed server-side, the diff points at the line that has to change.
//
// `id` is a `String`, not a `Foundation.UUID`: ids are opaque to this client, and the one
// thing it does with them is put them back on the wire. Parsing them into UUID would buy
// nothing and would make a server that ever widens the format a decoding crash.

public struct User: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let displayName: String
    public let avatarUrl: String?
    public let email: String?

    enum CodingKeys: String, CodingKey {
        case id, name, displayName, avatarUrl, email
    }

    /// Two letters at most, from the display name — the fallback when `avatarUrl` is nil,
    /// which it is for most seeded accounts.
    public var initials: String {
        let parts = displayName.split(separator: " ").prefix(2)
        let letters = parts.compactMap(\.first).map(String.init)
        return letters.isEmpty ? "?" : letters.joined().uppercased()
    }
}

public struct Workspace: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let urlKey: String
    /// `free` / `pro` / `enterprise` / `self_hosted`. A raw string rather than an enum: the
    /// server may add a plan before this app ships again, and an unknown value must render as
    /// itself rather than crash a decode or silently become the wrong tier.
    public let plan: String

    enum CodingKeys: String, CodingKey { case id, name, urlKey, plan }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        urlKey = try c.decode(String.self, forKey: .urlKey)
        // Absent on the create-workspace response, which returns the row before the plan is
        // selected in the projection.
        plan = try c.decodeIfPresent(String.self, forKey: .plan) ?? "free"
    }

    /// Title-cased for display. `self_hosted` -> `Self-hosted`.
    public var planLabel: String {
        switch plan {
        case "self_hosted": "Self-hosted"
        case "free": "Free"
        case "pro": "Pro"
        case "enterprise": "Enterprise"
        default: plan.capitalized
        }
    }
}

public struct Team: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let key: String
    public let name: String
    public let icon: String?
    public let color: String?

    enum CodingKeys: String, CodingKey { case id, key, name, icon, color }
}

public struct WorkflowState: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let color: String
    public let category: StateCategory
    public let position: String

    enum CodingKeys: String, CodingKey { case id, name, color, category, position }
}

public struct Label: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let color: String

    enum CodingKeys: String, CodingKey { case id, name, color }
}

public struct Issue: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let identifier: String
    public let title: String
    public let description: String
    public var priority: Priority
    public let estimate: Int?
    /// A calendar day, `2006-01-02`, deliberately not a `Time` — see the schema comment on
    /// `Issue.dueDate`. Kept as the wire string so a date with no timezone never acquires one.
    public let dueDate: String?
    /// `var` so an optimistic write can build a modified copy before the server replies.
    public var state: WorkflowState
    public let team: Team
    public var assignee: User?
    public let creator: User?
    public let labels: [Label]
    public let createdAt: Date
    public let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, identifier, title, description, priority, estimate, dueDate
        case state, team, assignee, creator, labels, createdAt, updatedAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        identifier = try c.decode(String.self, forKey: .identifier)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        // An unrecognised priority is clamped rather than thrown: the scale is fixed at 0–4
        // today, and a sixth value should not empty somebody's issue list.
        priority = Priority(rawValue: try c.decodeIfPresent(Int.self, forKey: .priority) ?? 0) ?? .none
        estimate = try c.decodeIfPresent(Int.self, forKey: .estimate)
        dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        state = try c.decode(WorkflowState.self, forKey: .state)
        team = try c.decode(Team.self, forKey: .team)
        assignee = try c.decodeIfPresent(User.self, forKey: .assignee)
        creator = try c.decodeIfPresent(User.self, forKey: .creator)
        labels = try c.decodeIfPresent([Label].self, forKey: .labels) ?? []
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
    }
}

public struct Comment: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let body: String
    public let actor: Actor
    public let editedAt: Date?
    public let createdAt: Date

    enum CodingKeys: String, CodingKey { case id, body, actor, editedAt, createdAt }
}

/// `viewer` is one call that hands back everything the client needs on boot.
public struct Viewer: Codable, Sendable, Hashable {
    public let user: User
    public let workspace: Workspace
    public let workspaces: [Workspace]
    /// The sync watermark at the time of this response. This client does not hold a replica;
    /// it polls this number and refetches only when it moves. See PollingFreshness.
    public let syncVersion: Int

    enum CodingKeys: String, CodingKey { case user, workspace, workspaces, syncVersion }
}
