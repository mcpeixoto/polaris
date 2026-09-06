import Foundation

// The small shapes one entity carries when it points at another.
//
// An issue's parent is an `Issue` on the wire, and so is a relation's other end. Decoding
// them as the full type would make `Issue` recursive and drag a second team, state and
// assignee into every row that has a parent. What a row needs to *show* a parent is its
// identifier and title, so that is what these hold — and the full entity is one tap away.

public struct IssueRef: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let identifier: String
    public let title: String

    enum CodingKeys: String, CodingKey { case id, identifier, title }

    public init(id: String, identifier: String, title: String) {
        self.id = id
        self.identifier = identifier
        self.title = title
    }
}

public struct ProjectRef: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let color: String
    public let icon: String?

    enum CodingKeys: String, CodingKey { case id, name, color, icon }

    public init(id: String, name: String, color: String, icon: String?) {
        self.id = id
        self.name = name
        self.color = color
        self.icon = icon
    }
}

public struct CycleRef: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let number: Int
    public let name: String
    public let startsAt: Date
    public let endsAt: Date

    enum CodingKeys: String, CodingKey { case id, number, name, startsAt, endsAt }

    public init(id: String, number: Int, name: String, startsAt: Date, endsAt: Date) {
        self.id = id
        self.number = number
        self.name = name
        self.startsAt = startsAt
        self.endsAt = endsAt
    }

    /// "Cycle 12", or the name when the team gave it one.
    public var displayName: String {
        name.isEmpty ? "Cycle \(number)" : name
    }
}

/// Sub-issue completion, rolled up server-side over direct children.
public struct IssueProgress: Codable, Sendable, Hashable {
    public let total: Int
    public let completed: Int
    public let canceled: Int
    /// completed / (total - canceled), rounded, 0–100. Cancelled work is not incomplete work.
    public let percent: Int

    enum CodingKeys: String, CodingKey { case total, completed, canceled, percent }

    public init(total: Int, completed: Int, canceled: Int, percent: Int) {
        self.total = total
        self.completed = completed
        self.canceled = canceled
        self.percent = percent
    }
}
