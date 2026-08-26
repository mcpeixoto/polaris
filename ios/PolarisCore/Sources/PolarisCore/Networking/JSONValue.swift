import Foundation

/// A closed JSON value, used for GraphQL variables.
///
/// GraphQL variables are heterogeneous by nature — a `CreateIssueInput` mixes strings, ints,
/// booleans and nulls — and `[String: Any]` is neither `Encodable` nor `Sendable`. This keeps
/// the variable payloads type-checked and lets the whole client stay under strict concurrency.
public enum JSONValue: Encodable, Sendable, Hashable {
    case string(String)
    case int(Int)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    /// Drops nil entries rather than encoding them as JSON null.
    ///
    /// This distinction is the whole reason the type exists: in a Polaris partial update, an
    /// explicit null means "set this to null" while an absent key means "leave it alone".
    /// Building an input dictionary by assigning optionals would silently clear every field
    /// the user did not touch.
    public static func object(compacting entries: [String: JSONValue?]) -> JSONValue {
        .object(entries.compactMapValues { $0 })
    }
}
