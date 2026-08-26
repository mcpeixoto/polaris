import Foundation

/// Where this build talks to.
///
/// The simulator shares the host network stack, so `localhost` reaches a `make dev` stack on
/// the developer's Mac and `/auth/dev-session` passes the server's loopback check. A physical
/// device does not: both of those fail there, which is why `devSession` is a capability of the
/// environment rather than something the sign-in screen assumes.
public struct PolarisEnvironment: Sendable, Hashable {
    public let apiBaseURL: URL
    public let allowsDevSession: Bool

    public init(apiBaseURL: URL, allowsDevSession: Bool) {
        self.apiBaseURL = apiBaseURL
        self.allowsDevSession = allowsDevSession
    }

    /// A `make dev` stack on the same machine. Points at the API directly rather than through
    /// Vite: one fewer moving part, and the app has no use for the SPA's origin.
    public static let localDevelopment = PolarisEnvironment(
        apiBaseURL: URL(string: "http://localhost:8088")!,
        allowsDevSession: true
    )

    public static let hosted = PolarisEnvironment(
        apiBaseURL: URL(string: "https://polaris.peixotolabs.com")!,
        allowsDevSession: false
    )
}

enum PolarisJSON {
    /// Go's `time.Time` marshals as RFC3339, and whether fractional seconds appear depends on
    /// whether the value had any — the same field arrives both ways from one server. A single
    /// `.iso8601` strategy therefore fails intermittently on real data, which is the worst
    /// shape of bug: it looks like a flaky network. Both forms are tried explicitly.
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = parseRFC3339(raw) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "not RFC3339: \(raw)")
            )
        }
        return decoder
    }

    /// Parsed by hand rather than with a Foundation formatter.
    ///
    /// `ISO8601DateFormatter` is a reference type Foundation does not declare Sendable, so
    /// capturing one in the decoding closure is a data race; `ISO8601FormatStyle` is Sendable
    /// but its parse strategy is fussy about which components it was configured to expect,
    /// which turns "the server omitted fractional seconds" into a decode failure. The grammar
    /// here is small and fixed — Go emits RFC3339 — so reading it directly is both cheaper and
    /// more predictable than configuring a formatter to accept both shapes.
    ///
    /// Accepts `2026-08-25T10:00:00Z`, `2026-08-25T10:00:00.512Z`, and numeric offsets
    /// (`+01:00`). Returns nil for anything else rather than guessing.
    static func parseRFC3339(_ raw: String) -> Date? {
        var scalars = Array(raw.utf8)
        guard scalars.count >= 20 else { return nil }

        func number(_ range: Range<Int>) -> Int? {
            var value = 0
            for index in range {
                let digit = Int(scalars[index]) - 48
                guard (0...9).contains(digit) else { return nil }
                value = value * 10 + digit
            }
            return value
        }

        guard
            let year = number(0..<4), scalars[4] == UInt8(ascii: "-"),
            let month = number(5..<7), scalars[7] == UInt8(ascii: "-"),
            let day = number(8..<10),
            scalars[10] == UInt8(ascii: "T") || scalars[10] == UInt8(ascii: " "),
            let hour = number(11..<13), scalars[13] == UInt8(ascii: ":"),
            let minute = number(14..<16), scalars[16] == UInt8(ascii: ":"),
            let second = number(17..<19)
        else { return nil }

        var index = 19
        var fraction = 0.0
        if index < scalars.count, scalars[index] == UInt8(ascii: ".") {
            index += 1
            var scale = 0.1
            while index < scalars.count, (48...57).contains(scalars[index]) {
                fraction += Double(Int(scalars[index]) - 48) * scale
                scale /= 10
                index += 1
            }
        }

        var offsetSeconds = 0
        guard index < scalars.count else { return nil }
        switch scalars[index] {
        case UInt8(ascii: "Z"), UInt8(ascii: "z"):
            offsetSeconds = 0
        case UInt8(ascii: "+"), UInt8(ascii: "-"):
            let sign = scalars[index] == UInt8(ascii: "-") ? -1 : 1
            guard
                index + 6 <= scalars.count,
                let offsetHour = number((index + 1)..<(index + 3)),
                scalars[index + 3] == UInt8(ascii: ":"),
                let offsetMinute = number((index + 4)..<(index + 6))
            else { return nil }
            offsetSeconds = sign * (offsetHour * 3600 + offsetMinute * 60)
        default:
            return nil
        }

        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        components.second = second

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let base = calendar.date(from: components) else { return nil }
        return base.addingTimeInterval(fraction - Double(offsetSeconds))
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
