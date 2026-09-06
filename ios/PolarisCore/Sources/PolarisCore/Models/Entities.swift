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
    /// Selected on `viewer.user` only. The directory query leaves it out: it is one person's
    /// settings, and forty copies of somebody else's are forty things nobody may read.
    public let notificationPrefs: NotificationPrefs?

    enum CodingKeys: String, CodingKey {
        case id, name, displayName, avatarUrl, email, notificationPrefs
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        displayName = try c.decode(String.self, forKey: .displayName)
        avatarUrl = try c.decodeIfPresent(String.self, forKey: .avatarUrl)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        // `try?`: the bag is an opaque JSON scalar on the wire, and one this build cannot
        // read must not take the whole viewer — and with it the sign-in — down with it.
        notificationPrefs = (try? c.decodeIfPresent(NotificationPrefs.self, forKey: .notificationPrefs)) ?? nil
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
        case "": "Unknown"
        default:
            // Any plan the server adds before this app ships again. Underscores become spaces
            // so `wildcat_tier` reads as "Wildcat tier" rather than keeping a visible
            // separator, and an empty string never renders an empty badge.
            plan.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

public struct Team: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let key: String
    public let name: String
    public let icon: String?
    public let color: String?
    /// Whether the team has a Triage status. Drives whether a triage list is offered at all:
    /// a triage tab on a team that cannot triage is a tab that is always empty.
    public let triageEnabled: Bool
    /// Whether the team runs cycles. Same reasoning as `triageEnabled`.
    public let cyclesEnabled: Bool

    enum CodingKeys: String, CodingKey { case id, key, name, icon, color, triageEnabled, cyclesEnabled }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        key = try c.decode(String.self, forKey: .key)
        name = try c.decode(String.self, forKey: .name)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        // Defaulted rather than required: the two flags were added to the selection after
        // the first release, and a cached list written by that build must still decode.
        triageEnabled = try c.decodeIfPresent(Bool.self, forKey: .triageEnabled) ?? false
        cyclesEnabled = try c.decodeIfPresent(Bool.self, forKey: .cyclesEnabled) ?? false
    }
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
    /// Nil is a workspace label, offered to every team.
    public let teamId: String?
    /// The group this label sits in, one level deep.
    public let parentId: String?
    /// A group is a heading in the picker, never something applied to an issue.
    public let isGroup: Bool

    enum CodingKeys: String, CodingKey { case id, name, color, teamId, parentId, isGroup }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        color = try c.decode(String.self, forKey: .color)
        // The scope fields are absent from every fixture written before they existed, and
        // from a cached issue list an older build wrote to disk.
        teamId = try c.decodeIfPresent(String.self, forKey: .teamId)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        isGroup = try c.decodeIfPresent(Bool.self, forKey: .isGroup) ?? false
    }

    /// Whether a picker for this team should offer the label.
    public func applies(toTeam teamId: String) -> Bool {
        !isGroup && (self.teamId == nil || self.teamId == teamId)
    }
}

public struct Issue: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let identifier: String
    /// `var` for the same reason `state` is: the detail screen edits both in place and shows
    /// the new value before the server has confirmed it.
    public var title: String
    public var description: String
    public var priority: Priority
    public var estimate: Int?
    /// A calendar day, `2006-01-02`, deliberately not a `Time` — see the schema comment on
    /// `Issue.dueDate`. Kept as the wire string so a date with no timezone never acquires one.
    public var dueDate: String?
    /// `var` so an optimistic write can build a modified copy before the server replies.
    public var state: WorkflowState
    public let team: Team
    public var assignee: User?
    public let creator: User?
    public var labels: [Label]
    public var parentId: String?
    public var projectId: String?
    public var cycleId: String?
    /// One level only. A parent's own parent is a second request, which is the trade that
    /// keeps a list of five hundred rows from carrying a tree.
    public var parent: IssueRef?
    public var project: ProjectRef?
    public var cycle: CycleRef?
    /// Sub-issue completion. Nil when there are no children, which is not zero per cent.
    public let progress: IssueProgress?
    public let createdAt: Date
    public let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, identifier, title, description, priority, estimate, dueDate
        case state, team, assignee, creator, labels, createdAt, updatedAt
        case parentId, projectId, cycleId, parent, project, cycle, progress
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
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId)
        cycleId = try c.decodeIfPresent(String.self, forKey: .cycleId)
        parent = try c.decodeIfPresent(IssueRef.self, forKey: .parent)
        project = try c.decodeIfPresent(ProjectRef.self, forKey: .project)
        cycle = try c.decodeIfPresent(CycleRef.self, forKey: .cycle)
        progress = try c.decodeIfPresent(IssueProgress.self, forKey: .progress)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
    }

    /// For an issue that exists only on this device so far — the optimistic sub-issue a
    /// detail screen shows while `createIssue` is in flight. Everything the server would
    /// decide is a parameter, so the caller cannot forget that the identifier it shows is
    /// provisional.
    public init(
        id: String,
        identifier: String,
        title: String,
        description: String = "",
        priority: Priority = .none,
        estimate: Int? = nil,
        dueDate: String? = nil,
        state: WorkflowState,
        team: Team,
        assignee: User? = nil,
        creator: User? = nil,
        labels: [Label] = [],
        parentId: String? = nil,
        projectId: String? = nil,
        cycleId: String? = nil,
        parent: IssueRef? = nil,
        project: ProjectRef? = nil,
        cycle: CycleRef? = nil,
        progress: IssueProgress? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.identifier = identifier
        self.title = title
        self.description = description
        self.priority = priority
        self.estimate = estimate
        self.dueDate = dueDate
        self.state = state
        self.team = team
        self.assignee = assignee
        self.creator = creator
        self.labels = labels
        self.parentId = parentId
        self.projectId = projectId
        self.cycleId = cycleId
        self.parent = parent
        self.project = project
        self.cycle = cycle
        self.progress = progress
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// The one-line form another issue points at.
    public var ref: IssueRef { IssueRef(id: id, identifier: identifier, title: title) }
}

public struct Comment: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    /// `var` so an edit can show its new text before the server confirms it.
    public var body: String
    public let actor: Actor
    public var editedAt: Date?
    public let createdAt: Date
    /// The comment this one replies to. Nil at the top level.
    public let parentId: String?
    public let resolvedAt: Date?
    /// Oldest first, as the server orders them. `var` for the optimistic toggle.
    public var reactions: [Reaction]

    enum CodingKeys: String, CodingKey {
        case id, body, actor, editedAt, createdAt, parentId, resolvedAt, reactions
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        body = try c.decode(String.self, forKey: .body)
        actor = try c.decode(Actor.self, forKey: .actor)
        editedAt = try c.decodeIfPresent(Date.self, forKey: .editedAt)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        resolvedAt = try c.decodeIfPresent(Date.self, forKey: .resolvedAt)
        // Defaulted: a fixture comment written before reactions existed still decodes, and
        // a comment with none is the ordinary case.
        reactions = try c.decodeIfPresent([Reaction].self, forKey: .reactions) ?? []
    }

    /// Whether `userId` has left this emoji, which decides whether a tap adds or removes it.
    public func hasReaction(_ emoji: String, by userId: String) -> Bool {
        reactions.contains { $0.emoji == emoji && $0.userId == userId }
    }
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
