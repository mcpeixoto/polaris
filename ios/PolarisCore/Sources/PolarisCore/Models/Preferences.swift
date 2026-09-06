import Foundation

/// Mirrors `enum FavoriteKind`.
public enum FavoriteKind: String, Codable, Sendable, Hashable, CaseIterable {
    case view = "VIEW"
    case team = "TEAM"
    case issue = "ISSUE"
    case label = "LABEL"
    case folder = "FOLDER"
    /// A kind this build does not know. Kept rather than dropped so the row still counts
    /// as a favourite — and so removing it removes the right one.
    case other = "OTHER"

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = FavoriteKind(rawValue: raw) ?? .other
    }
}

public struct Favorite: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let kind: FavoriteKind
    public let targetId: String
    /// The heading, for a folder. Nil for every other kind.
    public let name: String?

    enum CodingKeys: String, CodingKey { case id, kind, targetId, name }

    public init(id: String, kind: FavoriteKind, targetId: String, name: String?) {
        self.id = id
        self.kind = kind
        self.targetId = targetId
        self.name = name
    }
}

/// The whole of `user.notificationPrefs`, mirroring
/// services/internal/domain/notification_prefs.go.
///
/// Every field is optional and an absent key means its default, so a client built before a
/// preference existed keeps working and adding one is not a schema change. The bag is sent
/// back whole on `updateNotificationPrefs`, which is why this is a struct and not four
/// separate setters: the server replaces, it does not merge.
public struct NotificationPrefs: Codable, Sendable, Hashable {
    /// Notification types switched off in every channel, as their wire names.
    public var muted: [String]
    /// `off` / `hourly` / `daily` / `weekly`. Absent means daily.
    public var emailDigest: String?
    /// One email per notification instead of the digest.
    public var emailPerNotification: Bool?
    /// Browser and Electron system notifications. Absent means off.
    public var desktop: Bool?

    enum CodingKeys: String, CodingKey { case muted, emailDigest, emailPerNotification, desktop }

    public init(
        muted: [String] = [],
        emailDigest: String? = nil,
        emailPerNotification: Bool? = nil,
        desktop: Bool? = nil
    ) {
        self.muted = muted
        self.emailDigest = emailDigest
        self.emailPerNotification = emailPerNotification
        self.desktop = desktop
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        muted = try c.decodeIfPresent([String].self, forKey: .muted) ?? []
        emailDigest = try c.decodeIfPresent(String.self, forKey: .emailDigest)
        emailPerNotification = try c.decodeIfPresent(Bool.self, forKey: .emailPerNotification)
        desktop = try c.decodeIfPresent(Bool.self, forKey: .desktop)
    }

    public func isMuted(_ type: PolarisNotificationType) -> Bool {
        muted.contains(type.rawValue)
    }

    public mutating func setMuted(_ type: PolarisNotificationType, _ isMuted: Bool) {
        muted.removeAll { $0 == type.rawValue }
        if isMuted { muted.append(type.rawValue) }
    }

    /// The bag as GraphQL variables, with every absent preference left out rather than sent
    /// as null — the server reads per key, and a null it did not need is a key it has to
    /// ignore.
    public var jsonValue: JSONValue {
        .object(compacting: [
            "muted": .array(muted.map(JSONValue.string)),
            "emailDigest": emailDigest.map(JSONValue.string),
            "emailPerNotification": emailPerNotification.map(JSONValue.bool),
            "desktop": desktop.map(JSONValue.bool),
        ])
    }
}

/// A profile edit. Every field optional, absent means untouched — the same partial-update
/// rule as `IssueChange`.
public struct ProfileChange: Sendable, Hashable {
    public var name: String?
    public var displayName: String?
    public var avatarUrl: String?
    public var timezone: String?

    public init(
        name: String? = nil,
        displayName: String? = nil,
        avatarUrl: String? = nil,
        timezone: String? = nil
    ) {
        self.name = name
        self.displayName = displayName
        self.avatarUrl = avatarUrl
        self.timezone = timezone
    }
}
