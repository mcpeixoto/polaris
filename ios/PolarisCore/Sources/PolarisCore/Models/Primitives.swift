import Foundation

/// Priority is a fixed 0–4 scale on the wire, not an enum, so it arrives as an `Int` and is
/// given meaning here rather than at each call site. The order is deliberately *not* the
/// numeric order: 0 ("no priority") sorts last for a human, first for a database.
public enum Priority: Int, Codable, Sendable, CaseIterable, Hashable {
    case none = 0
    case urgent = 1
    case high = 2
    case medium = 3
    case low = 4

    public var label: String {
        switch self {
        case .none: "No priority"
        case .urgent: "Urgent"
        case .high: "High"
        case .medium: "Medium"
        case .low: "Low"
        }
    }

    /// SF Symbol name. Urgent gets a filled glyph because it is the one a scanning eye must
    /// catch without reading the label.
    public var symbolName: String {
        switch self {
        case .none: "minus"
        case .urgent: "exclamationmark.square.fill"
        case .high: "chart.bar.fill"
        case .medium: "chart.bar"
        case .low: "chart.bar.doc.horizontal"
        }
    }

    /// Sort weight for a human-facing list: urgent first, "none" last.
    public var sortWeight: Int { self == .none ? Int.max : rawValue }
}

/// Mirrors `enum StateCategory` in schema/schema.graphql. The category — not the state name —
/// is what the UI may branch on: a workspace can rename "In Progress" to anything it likes,
/// but it cannot move it out of `STARTED`.
public enum StateCategory: String, Codable, Sendable, Hashable {
    case triage = "TRIAGE"
    case backlog = "BACKLOG"
    case unstarted = "UNSTARTED"
    case started = "STARTED"
    case completed = "COMPLETED"
    case canceled = "CANCELED"
    case duplicate = "DUPLICATE"

    /// Decoding an unknown category must not fail the whole response: the server may add one
    /// before this app ships again. Unknown values land in `.backlog`, which renders as an
    /// ordinary open issue rather than silently disappearing from a list.
    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = StateCategory(rawValue: raw) ?? .backlog
    }

    public var isOpen: Bool {
        switch self {
        case .completed, .canceled, .duplicate: false
        default: true
        }
    }

    public var symbolName: String {
        switch self {
        case .triage: "tray"
        case .backlog: "circle.dotted"
        case .unstarted: "circle"
        case .started: "circle.lefthalf.filled"
        case .completed: "checkmark.circle.fill"
        case .canceled: "xmark.circle.fill"
        case .duplicate: "doc.on.doc"
        }
    }
}

public enum ActorType: String, Codable, Sendable, Hashable {
    case user = "USER"
    case appUser = "APP_USER"
    case integration = "INTEGRATION"
    case system = "SYSTEM"

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ActorType(rawValue: raw) ?? .system
    }
}

public struct Actor: Codable, Sendable, Hashable {
    public let type: ActorType
    public let id: String?

    public init(type: ActorType, id: String?) {
        self.type = type
        self.id = id
    }
}
