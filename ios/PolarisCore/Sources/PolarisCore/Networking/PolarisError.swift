import Foundation

/// Errors a screen can actually act on. `URLError` and raw status codes are mapped into this
/// before they leave the client, so no view ever has to interpret a transport detail — and
/// every case carries copy that is safe to put in front of a user.
public enum PolarisError: Error, Equatable, Sendable {
    case offline
    case timedOut
    /// The device has a network and nothing answered at the server's address: the API
    /// container is stopped, or a self-hosted address is wrong or no longer resolves.
    ///
    /// Separate from `.offline` because the two want opposite sentences. Telling somebody
    /// sitting on full-strength Wi-Fi that they are offline sends them to reset a router that
    /// is working perfectly, and hides the one fact that would help them.
    case serverUnreachable
    /// TLS would not come up: a certificate this device does not trust, one that expired, or
    /// a plain `http://` address App Transport Security refuses to open.
    ///
    /// Deliberately not `.offline` — the network is fine, the connection to *this server* is
    /// what is refused — and deliberately not retryable: a device that rejects a certificate
    /// rejects it identically every time, and the fix is on the server or in the address.
    case insecureConnection
    /// The request was stopped, not refused — a screen dismissed mid-load, a search
    /// superseded by the next keystroke. Nothing went wrong and nobody needs telling; it is
    /// a case rather than a silent `nil` so a store can recognise it and stay quiet, which is
    /// what `WorkspaceDataStore` does with it.
    case cancelled
    /// 401. Carries the server's own sentence when it sent one, because the two things that
    /// produce a 401 need opposite copy: a mistyped password is "incorrect email or password",
    /// an expired token is "sign in again". Flattening both into the second tells somebody who
    /// simply fat-fingered their password that their session expired.
    case unauthorized(String?)
    case forbidden
    case notFound
    case rateLimited(retryAfter: TimeInterval?)
    /// The server priced one operation over its per-query complexity ceiling and refused it.
    ///
    /// Separate from `rateLimited`, which it used to arrive as. A rate limit passes; this does
    /// not — the same document with the same variables is refused every time, so the copy must
    /// not invite a retry and `isRetryable` must not offer a button. Nothing the person holding
    /// the phone can do reaches it either: the fix is a smaller query in a later build.
    case queryTooComplex
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
        case .serverUnreachable:
            "Polaris isn't answering. The server may be down, or its address may be wrong."
        case .insecureConnection:
            "Polaris couldn't open a secure connection to that server. Check the address, and that its certificate is valid."
        case .cancelled:
            "That stopped before it finished."
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
        case .queryTooComplex:
            "This version of the app asked for more than the server will send. Updating should fix it."
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
        case .offline, .timedOut, .rateLimited, .server, .serverUnreachable, .cancelled: true
        case .unauthorized, .forbidden, .notFound, .queryTooComplex, .validation, .decoding,
             .insecureConnection, .badResponse: false
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

    /// What a client that does not implement an operation throws. A 501, because that is
    /// what it is; `.server` rather than a new case, so nothing switching on this enum has
    /// to change.
    static func unsupported(_ what: String) -> PolarisError {
        .server(status: 501, message: "This client cannot handle \(what).")
    }

    /// Every `URLError` a phone can actually hit against this API, grouped by what the reader
    /// should do about it rather than by what the URL loading system called it.
    ///
    /// Four codes were named here and everything else fell through to `.badResponse` —
    /// "Polaris sent an unexpected response", not retryable. So a stopped API container, a
    /// mistyped self-hosted address and an expired certificate all read as a bug in the app:
    /// no Retry button on the screen, no Offline pill in the shell, and a sentence that
    /// blamed the server for something it never sent. Anything genuinely unrecognised still
    /// lands on `.badResponse`, but the default now means "we do not know" rather than
    /// "we did not look".
    static func from(urlError: URLError) -> PolarisError {
        switch urlError.code {
        // No usable path off the device. Nothing at all is known about the server here, and
        // this is the only group the Offline pill is about. `.cannotLoadFromNetwork` joins it
        // because it means exactly that: the network was needed, and could not be used.
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed,
             .internationalRoamingOff, .callIsActive, .cannotLoadFromNetwork:
            .offline

        case .timedOut:
            .timedOut

        // The device is on a network and the address is not answering: a container that is
        // down, a host that no longer resolves, a proxy looping. Retryable, because "the
        // server came back" is the ordinary ending of every one of them.
        case .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .resourceUnavailable,
             .httpTooManyRedirects, .redirectToNonExistentLocation:
            .serverUnreachable

        // Handshake and trust. Never `.offline`: the network works, and saying otherwise
        // about a self-hosted box with an expired certificate sends somebody to the wrong
        // problem entirely.
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
             .clientCertificateRejected, .clientCertificateRequired,
             .appTransportSecurityRequiresSecureConnection:
            .insecureConnection

        // Not failures. A screen torn down mid-load cancels its own request; putting a
        // sentence in front of somebody for that is noise about something they did on purpose.
        case .cancelled, .userCancelledAuthentication:
            .cancelled

        // Bytes arrived and were not usable. This is the one place "Polaris sent an
        // unexpected response" is literally what happened.
        case .badServerResponse, .cannotParseResponse, .cannotDecodeRawData,
             .cannotDecodeContentData, .zeroByteResource, .dataLengthExceedsMaximum:
            .badResponse

        // A URL this build assembled wrongly. Nothing the reader can act on — it is a bug
        // report, and bug reports go where the unknowns go.
        case .badURL, .unsupportedURL:
            .badResponse

        default:
            .badResponse
        }
    }
}
