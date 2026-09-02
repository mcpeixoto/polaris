import Foundation

/// Errors a screen can actually act on. `URLError` and raw status codes are mapped into this
/// before they leave the client, so no view ever has to interpret a transport detail — and
/// every case carries copy that is safe to put in front of a user.
public enum PolarisError: Error, Equatable, Sendable {
    case offline
    case timedOut
    /// 401. Carries the server's own sentence when it sent one, because the two things that
    /// produce a 401 need opposite copy: a mistyped password is "incorrect email or password",
    /// an expired token is "sign in again". Flattening both into the second tells somebody who
    /// simply fat-fingered their password that their session expired.
    case unauthorized(String?)
    case forbidden
    case notFound
    case rateLimited(retryAfter: TimeInterval?)
    case validation(message: String, field: String?)
    case server(status: Int, message: String?)
    case decoding(String)
    case badResponse

    public var displayMessage: String {
        switch self {
        case .offline:
            "You're offline. Polaris will retry when the connection comes back."
        case .timedOut:
            "That took too long. Try again."
        case .unauthorized(let message):
            message ?? "Your session expired. Sign in again."
        case .forbidden:
            "You don't have access to that."
        case .notFound:
            "That's not here any more."
        case .rateLimited(let retryAfter):
            if let retryAfter {
                "Too many requests. Try again in \(Int(retryAfter.rounded(.up)))s."
            } else {
                "Too many requests. Try again shortly."
            }
        case .validation(let message, _):
            message
        case .server(_, let message):
            message ?? "Polaris had a problem handling that."
        case .decoding:
            "Polaris sent something this version of the app can't read."
        case .badResponse:
            "Polaris sent an unexpected response."
        }
    }

    /// Whether retrying the identical request could plausibly succeed. Drives whether a
    /// failed screen offers a Retry button or just explains itself.
    public var isRetryable: Bool {
        switch self {
        case .offline, .timedOut, .rateLimited, .server: true
        case .unauthorized, .forbidden, .notFound, .validation, .decoding, .badResponse: false
        }
    }

    /// Anything thrown by the API layer, as the one error type a screen understands.
    ///
    /// Every store had its own `(error as? PolarisError) ?? .badResponse` before this; the
    /// duplication is how one of them ended up mapping a refused read to `.notFound`.
    public static func mapped(_ error: any Error) -> PolarisError {
        if let polaris = error as? PolarisError { return polaris }
        if let urlError = error as? URLError { return .from(urlError: urlError) }
        return .badResponse
    }

    static func from(urlError: URLError) -> PolarisError {
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
            .offline
        case .timedOut:
            .timedOut
        default:
            .badResponse
        }
    }
}
