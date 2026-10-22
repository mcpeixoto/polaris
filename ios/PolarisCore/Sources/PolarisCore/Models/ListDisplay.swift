import Foundation

/// How a list of issues is laid out, grouped and ordered — the display schema from
/// `docs/03-architecture/06-filter-grammar.md`, stored beside a filter and shared between the
/// web client, the server and this one.
///
/// Spelled exactly as the document spells it, keys and values, because this type is also the
/// decoder for a saved view's `display` JSON. A value this client invented, or a key it spelled
/// its own way, would be a view that reads differently on the phone than on the web — which is
/// the one thing a shared schema exists to prevent. In particular there is no `project` and no
/// `cycle` grouping: the schema does not have them, and adding them here would make the phone
/// the only client that could save such a view.
///
/// "Every key is optional and absence means the default. A client built before an option existed
/// must render a view that uses it — degraded, never broken." So decoding is lenient twice over:
/// a missing key takes the default, and so does a value this build has never heard of. A
/// `groupBy` the server grows next year must not empty somebody's issue list.
public struct ListDisplay: Codable, Sendable, Hashable {
    /// Declared because the schema has it, and unused: there is no board on the phone. A list
    /// view that silently dropped the key would turn a saved board into a saved list the next
    /// time this client wrote the view back.
    public enum Layout: String, Codable, Sendable, CaseIterable, Hashable {
        case list, board
    }

    public enum GroupBy: String, Codable, Sendable, CaseIterable, Hashable {
        case none, state, stateCategory, assignee, priority, label, team, dueDate, parent
    }

    public enum OrderBy: String, Codable, Sendable, CaseIterable, Hashable {
        case manual, priority, dueDate, estimate, createdAt, updatedAt, title
    }

    public enum Direction: String, Codable, Sendable, CaseIterable, Hashable {
        case asc, desc
    }

    public var layout: Layout
    public var groupBy: GroupBy
    public var orderBy: OrderBy
    public var direction: Direction
    /// False hides children whose parent is in the same view.
    public var showSubIssues: Bool
    public var showCompleted: Bool
    /// Which row properties are drawn. A free list of strings rather than an enum, for the same
    /// reason `Workspace.plan` is a string: a property the server adds must round-trip through
    /// this client rather than be dropped from a view somebody saved on the web.
    public var properties: [String]

    /// The schema's own defaults, named once so no call site has to restate them.
    public static let defaultProperties = ["priority", "assignee", "labels", "estimate", "dueDate", "project"]

    public init(
        layout: Layout = .list,
        groupBy: GroupBy = .state,
        orderBy: OrderBy = .manual,
        direction: Direction = .asc,
        showSubIssues: Bool = true,
        showCompleted: Bool = true,
        properties: [String] = ListDisplay.defaultProperties
    ) {
        self.layout = layout
        self.groupBy = groupBy
        self.orderBy = orderBy
        self.direction = direction
        self.showSubIssues = showSubIssues
        self.showCompleted = showCompleted
        self.properties = properties
    }

    enum CodingKeys: String, CodingKey {
        case layout, groupBy, orderBy, direction, showSubIssues, showCompleted, properties
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = ListDisplay()
        // Decoded as the raw string and then mapped, rather than as the enum: each field has a
        // different default, so leniency cannot live in the enums themselves without one of them
        // claiming another's fallback.
        layout = Layout(rawValue: try c.decodeIfPresent(String.self, forKey: .layout) ?? "") ?? fallback.layout
        groupBy = GroupBy(rawValue: try c.decodeIfPresent(String.self, forKey: .groupBy) ?? "") ?? fallback.groupBy
        orderBy = OrderBy(rawValue: try c.decodeIfPresent(String.self, forKey: .orderBy) ?? "") ?? fallback.orderBy
        direction = Direction(rawValue: try c.decodeIfPresent(String.self, forKey: .direction) ?? "") ?? fallback.direction
        showSubIssues = try c.decodeIfPresent(Bool.self, forKey: .showSubIssues) ?? fallback.showSubIssues
        showCompleted = try c.decodeIfPresent(Bool.self, forKey: .showCompleted) ?? fallback.showCompleted
        properties = try c.decodeIfPresent([String].self, forKey: .properties) ?? fallback.properties
    }

    /// Every key written out, including the ones at their default. A saved view is read by the
    /// web client too, and a key this client omitted would be a key the web client re-defaulted
    /// — so "group by assignee" could survive a round trip through the phone as "group by state".
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(layout, forKey: .layout)
        try c.encode(groupBy, forKey: .groupBy)
        try c.encode(orderBy, forKey: .orderBy)
        try c.encode(direction, forKey: .direction)
        try c.encode(showSubIssues, forKey: .showSubIssues)
        try c.encode(showCompleted, forKey: .showCompleted)
        try c.encode(properties, forKey: .properties)
    }
}
