import Foundation

/// The API origin this install talks to, remembered across launches.
///
/// Same class of preference as appearance: device-local `UserDefaults`, not Keychain. It is
/// not a secret — it is an address — and it must be readable before there is a session.
public enum ServerPreference: Sendable {
    public static let storageKey = "polaris.apiBaseURL"

    /// The EU-hosted Polaris Cloud origin. Keep equal to web `HOSTED_CLOUD_ORIGIN`
    /// (`web/src/sync/hostedOrigin.ts`) by review — there is no shared package.
    public static let hostedCloudOrigin = URL(string: "https://polaris.peixotolabs.com")!

    public static func load(defaults: UserDefaults = .standard) -> URL? {
        guard let raw = defaults.string(forKey: storageKey)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let url = URL(string: raw),
              url.scheme != nil,
              url.host != nil
        else { return nil }
        return url
    }

    public static func save(_ url: URL, defaults: UserDefaults = .standard) {
        defaults.set(url.absoluteString, forKey: storageKey)
    }

    public static func clear(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: storageKey)
    }

    /// Whether the host is loopback, so Debug auto-login may run and plain HTTP is allowed.
    public static func isLoopback(_ url: URL) -> Bool {
        let host = (url.host ?? "").lowercased()
        return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    }

    /// Turn typed input into an origin the way desktop `normaliseServerUrl` does.
    ///
    /// Defaults to `https://`. Plain `http://` is accepted only for loopback — HTTPS
    /// self-host is the v1 path; arbitrary LAN HTTP needs ATS work that is not in this cut.
    public static func normaliseServerURL(_ raw: String) -> Result<URL, ServerURLError> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return .failure(.empty)
        }

        let withScheme: String
        if trimmed.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil {
            withScheme = trimmed
        } else {
            withScheme = "https://\(trimmed)"
        }

        guard let url = URL(string: withScheme),
              let scheme = url.scheme?.lowercased(),
              (scheme == "https" || scheme == "http"),
              let host = url.host,
              !host.isEmpty
        else {
            return .failure(.invalid)
        }

        if scheme == "http", !isLoopback(url) {
            return .failure(.httpNotLoopback)
        }

        // Origin only: path, query and fragment are whatever page somebody copied.
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        guard let origin = components.url else {
            return .failure(.invalid)
        }
        return .success(origin)
    }
}

public enum ServerURLError: Error, Equatable, Sendable {
    case empty
    case invalid
    case httpNotLoopback

    public var message: String {
        switch self {
        case .empty:
            String(localized: "Enter the address your administrator gave you.")
        case .invalid:
            String(localized: "That does not look like a web address. Try something like polaris.acme.com.")
        case .httpNotLoopback:
            String(localized: "Use an https:// address for your server. Plain http is only for localhost.")
        }
    }
}

/// Inputs that decide which `PolarisEnvironment` a launch uses, factored out of process
/// arguments so the priority order is unit-tested without launching the app.
public struct EnvironmentResolution: Sendable, Equatable {
    public var persistedOrigin: URL?
    public var forcedServer: URL?
    public var forcedHosted: Bool
    public var forceConnect: Bool
    public var usesFixtures: Bool
    public var syncHubURL: URL?

    public init(
        persistedOrigin: URL? = nil,
        forcedServer: URL? = nil,
        forcedHosted: Bool = false,
        forceConnect: Bool = false,
        usesFixtures: Bool = false,
        syncHubURL: URL? = nil
    ) {
        self.persistedOrigin = persistedOrigin
        self.forcedServer = forcedServer
        self.forcedHosted = forcedHosted
        self.forceConnect = forceConnect
        self.usesFixtures = usesFixtures
        self.syncHubURL = syncHubURL
    }

    /// Priority: launch-arg server → persisted → `-polaris-hosted` → fixtures harness →
    /// else `nil` (show connect). Never silently assumes Release=hosted or Debug=localhost
    /// without a pick.
    public func resolve() -> PolarisEnvironment? {
        if forceConnect { return nil }

        if let forced = forcedServer {
            return PolarisEnvironment.from(persistedOrigin: forced, syncHubURL: syncHubURL)
        }
        if let persisted = persistedOrigin {
            return PolarisEnvironment.from(persistedOrigin: persisted, syncHubURL: syncHubURL)
        }
        if forcedHosted {
            return applyHub(PolarisEnvironment.hosted)
        }
        // UI tests and fixture previews need a settled environment without a first-run pick.
        if usesFixtures {
            return applyHub(PolarisEnvironment.localDevelopment)
        }
        return nil
    }

    private func applyHub(_ base: PolarisEnvironment) -> PolarisEnvironment {
        guard let hub = syncHubURL else { return base }
        return PolarisEnvironment(
            apiBaseURL: base.apiBaseURL,
            allowsDevSession: base.allowsDevSession,
            syncHubURL: hub
        )
    }
}

extension PolarisEnvironment {
    /// Build an environment from a chosen origin. Dev-session only on loopback so Cloud and
    /// customer self-hosts never get Debug auto-login.
    public static func from(persistedOrigin origin: URL, syncHubURL: URL? = nil) -> PolarisEnvironment {
        PolarisEnvironment(
            apiBaseURL: origin,
            allowsDevSession: ServerPreference.isLoopback(origin),
            syncHubURL: syncHubURL
        )
    }
}
