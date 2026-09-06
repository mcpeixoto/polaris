import Foundation

// Projects and cycles: the two ways work is grouped above the issue.

/// Mirrors `enum ProjectStatusCategory`. As with `StateCategory`, the category is what the
/// UI may branch on; the status name belongs to the workspace.
public enum ProjectStatusCategory: String, Codable, Sendable, Hashable {
    case backlog = "BACKLOG"
    case planned = "PLANNED"
    case started = "STARTED"
    case completed = "COMPLETED"
    case canceled = "CANCELED"

    /// Unknown values land in `.backlog` rather than failing the whole projects list.
    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ProjectStatusCategory(rawValue: raw) ?? .backlog
    }

    public var isOpen: Bool {
        switch self {
        case .completed, .canceled: false
        default: true
        }
    }

    public var symbolName: String {
        switch self {
        case .backlog: "circle.dotted"
        case .planned: "circle"
        case .started: "circle.lefthalf.filled"
        case .completed: "checkmark.circle.fill"
        case .canceled: "xmark.circle.fill"
        }
    }
}

public struct ProjectStatus: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let color: String
    public let category: ProjectStatusCategory

    enum CodingKeys: String, CodingKey { case id, name, color, category }
}

public struct ProjectMilestone: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    /// A calendar day, `2006-01-02`, like `Issue.dueDate`.
    public let targetDate: String?

    enum CodingKeys: String, CodingKey { case id, name, targetDate }
}

public struct Project: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let summary: String?
    public let description: String
    public let icon: String?
    public let color: String
    public let priority: Priority
    public let leadId: String?
    /// Calendar days, `2006-01-02`.
    public let startDate: String?
    public let targetDate: String?
    public let status: ProjectStatus
    public let lead: User?
    /// Flattened from `teams { team { … } }`: the join row carries nothing a phone renders.
    public let teams: [Team]
    public let milestones: [ProjectMilestone]

    enum CodingKeys: String, CodingKey {
        case id, name, summary, description, icon, color, priority, leadId
        case startDate, targetDate, status, lead, teams, milestones
    }

    /// The join row, only ever seen here.
    private struct TeamLink: Codable {
        let team: Team
        enum CodingKeys: String, CodingKey { case team }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#8A8F98"
        priority = Priority(rawValue: try c.decodeIfPresent(Int.self, forKey: .priority) ?? 0) ?? .none
        leadId = try c.decodeIfPresent(String.self, forKey: .leadId)
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate)
        targetDate = try c.decodeIfPresent(String.self, forKey: .targetDate)
        status = try c.decode(ProjectStatus.self, forKey: .status)
        lead = try c.decodeIfPresent(User.self, forKey: .lead)
        teams = try c.decodeIfPresent([TeamLink].self, forKey: .teams)?.map(\.team) ?? []
        milestones = try c.decodeIfPresent([ProjectMilestone].self, forKey: .milestones) ?? []
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encodeIfPresent(summary, forKey: .summary)
        try c.encode(description, forKey: .description)
        try c.encodeIfPresent(icon, forKey: .icon)
        try c.encode(color, forKey: .color)
        try c.encode(priority.rawValue, forKey: .priority)
        try c.encodeIfPresent(leadId, forKey: .leadId)
        try c.encodeIfPresent(startDate, forKey: .startDate)
        try c.encodeIfPresent(targetDate, forKey: .targetDate)
        try c.encode(status, forKey: .status)
        try c.encodeIfPresent(lead, forKey: .lead)
        // Round-trips through the same join shape it was read from, so an encoded project
        // decodes again — which is what a test that re-encodes fixtures relies on.
        try c.encode(teams.map(TeamLink.init(team:)), forKey: .teams)
        try c.encode(milestones, forKey: .milestones)
    }

    public var ref: ProjectRef { ProjectRef(id: id, name: name, color: color, icon: icon) }
}

/// A dated window on one team.
public struct Cycle: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let teamId: String
    public let number: Int
    public let name: String
    public let description: String?
    public let startsAt: Date
    public let endsAt: Date
    public let completedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, teamId, number, name, description, startsAt, endsAt, completedAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        teamId = try c.decode(String.self, forKey: .teamId)
        number = try c.decode(Int.self, forKey: .number)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description)
        startsAt = try c.decode(Date.self, forKey: .startsAt)
        endsAt = try c.decode(Date.self, forKey: .endsAt)
        completedAt = try c.decodeIfPresent(Date.self, forKey: .completedAt)
    }

    public var displayName: String { name.isEmpty ? "Cycle \(number)" : name }

    /// Running right now. `now` is a parameter so a test does not depend on the wall clock.
    public func isActive(at now: Date = Date()) -> Bool {
        completedAt == nil && startsAt <= now && now < endsAt
    }

    public func isUpcoming(at now: Date = Date()) -> Bool {
        completedAt == nil && startsAt > now
    }

    public var ref: CycleRef {
        CycleRef(id: id, number: number, name: name, startsAt: startsAt, endsAt: endsAt)
    }
}
