import Foundation

/// The filter AST from docs/03-architecture/06-filter-grammar.md, as this client builds it.
///
/// One grammar, shared with the web client and the server's SQL compiler, and carried as a
/// `JSON` scalar in `SearchInput.filter`. A node is either a clause — `field`, `op`,
/// `values` — or a group — `conj`, `nodes`. Only the handful of clauses a phone asks for
/// are spelled out as helpers; anything else goes through `clause(_:_:_:)` with the field
/// name written as the grammar spells it, because an unknown field is a hard error on the
/// server and a typo here should be visible in a test, not in a screen.
public enum IssueFilter {
    public enum Op: String, Sendable {
        case eq, neq, `in`, notIn, contains, notContains, gt, gte, lt, lte, isNull, isNotNull
    }

    public static func clause(_ field: String, _ op: Op, _ values: [String] = []) -> JSONValue {
        var node: [String: JSONValue] = [
            "field": .string(field),
            "op": .string(op.rawValue),
        ]
        // `isNull` / `isNotNull` must carry no `values` at all — a present-but-empty array
        // is refused by the server's validator.
        if !values.isEmpty { node["values"] = .array(values.map(JSONValue.string)) }
        return .object(node)
    }

    public static func and(_ nodes: [JSONValue]) -> JSONValue {
        .object(["conj": .string("and"), "nodes": .array(nodes)])
    }

    public static func or(_ nodes: [JSONValue]) -> JSONValue {
        .object(["conj": .string("or"), "nodes": .array(nodes)])
    }

    /// Issues `userId` filed.
    public static func createdBy(_ userId: String) -> JSONValue {
        clause("creator", .eq, [userId])
    }

    /// Issues `userId` is subscribed to and has not unsubscribed from — the grammar's
    /// `subscriber` field already folds the opt-out flag in.
    public static func subscribedBy(_ userId: String) -> JSONValue {
        clause("subscriber", .eq, [userId])
    }

    /// Issues `userId` is assigned to.
    public static func assignedTo(_ userId: String) -> JSONValue {
        clause("assignee", .eq, [userId])
    }

    /// The three closed categories, by name, so the clause survives a team renaming its
    /// statuses. The grammar spells categories in lowercase.
    public static var openOnly: JSONValue {
        clause("stateCategory", .notIn, ["completed", "canceled", "duplicate"])
    }

    /// The list a "My issues" scope asks for, when it is asked of the server.
    public static func myIssues(scope: MyIssuesScope, viewerId: String, includeCompleted: Bool) -> JSONValue {
        let who: JSONValue
        switch scope {
        case .assigned: who = assignedTo(viewerId)
        case .created: who = createdBy(viewerId)
        case .subscribed: who = subscribedBy(viewerId)
        }
        return includeCompleted ? and([who]) : and([who, openOnly])
    }
}
