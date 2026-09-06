import Foundation

/// A closed JSON value, used for GraphQL variables.
///
/// GraphQL variables are heterogeneous by nature — a `CreateIssueInput` mixes strings, ints,
/// booleans and nulls — and `[String: Any]` is neither `Encodable` nor `Sendable`. This keeps
/// the variable payloads type-checked and lets the whole client stay under strict concurrency.
public enum JSONValue: Codable, Sendable, Hashable {
    case string(String)
    case int(Int)
    /// Only ever produced by decoding: nothing this client sends is fractional, but the
    /// history feed's `fromValue`/`toValue` can be anything the server wrote.
    case double(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    /// Reads whatever is there. Order matters: an integer is tried before a double so `3`
    /// stays `.int(3)`, and both before `Bool` so the decoder is never asked whether `1`
    /// is `true`.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "not a JSON value")
            )
        }
    }

    /// The string inside, for a history entry that names a state or a person.
    public var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
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
