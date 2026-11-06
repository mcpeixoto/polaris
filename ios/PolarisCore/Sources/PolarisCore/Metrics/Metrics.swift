import Foundation

/// One anonymous ping a day: how many installs there are, on which version and OS, and how
/// much they are used. The whole payload is `Payload` — a random id, the app's version, the
/// language setting and three counts. Never an issue, a comment, a name or a workspace. The
/// server reads the country from the connection and does not store the address.
///
/// Off with one switch, in Settings and on the first connect screen. Off also forgets the id
/// and anything still waiting to be sent.
///
/// The same contract as Ata's `Metrics.swift` and every other app in this account: one row
/// per (app, id, UTC day) in the shared `ata-metrics` Worker.
public enum Metrics {
    public static let app = "polaris"

    /// What is counted. Only how many times something happened — never what it was.
    public enum Counter: String, CaseIterable, Sendable {
        /// The app came to the foreground.
        case sessions
        /// An issue the server accepted from this device.
        case issuesCreated = "issues_created"
        /// A comment the server accepted from this device.
        case commentsPosted = "comments_posted"
    }

    public struct Payload: Codable, Equatable, Sendable {
        public let app: String
        public let id: String
        public let platform: String
        public let version: String
        public let build: String
        public let os: String
        public let locale: String
        public let counts: [String: Int]
    }

    public enum Keys {
        /// The switch. Absent means on.
        public static let share = "polaris.metrics.share"
        static let id = "polaris.metrics.id"
        static let lastSent = "polaris.metrics.lastSent"
        static func pending(_ counter: Counter) -> String { "polaris.metrics.pending.\(counter.rawValue)" }
    }

    public static let maxCount = 10_000

    public static func isOn(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: Keys.share) as? Bool ?? true
    }

    public static func count(_ counter: Counter, defaults: UserDefaults = .standard) {
        guard isOn(defaults) else { return }
        let key = Keys.pending(counter)
        defaults.set(min(maxCount, defaults.integer(forKey: key) + 1), forKey: key)
    }

    /// Whether the person has been through the connect screen, which is where the switch is
    /// first shown. A picked server is what that screen leaves behind.
    static func onboarded(_ defaults: UserDefaults) -> Bool {
        ServerPreference.load(defaults: defaults) != nil
    }

    /// Today's ping, or nil: switched off, not yet past the connect screen (the person has
    /// not seen the switch), or already sent today.
    public static func due(now: Date = Date(), defaults: UserDefaults = .standard) -> Payload? {
        guard isOn(defaults) else {
            forget(defaults)
            return nil
        }
        guard onboarded(defaults) else { return nil }
        guard defaults.string(forKey: Keys.lastSent) != day(now) else { return nil }
        let id: String
        if let saved = defaults.string(forKey: Keys.id) {
            id = saved
        } else {
            // Its own id, never `ClientIdentity`: that one goes to the server with every
            // write, and would tie these numbers to a workspace's history.
            id = UUID().uuidString
            defaults.set(id, forKey: Keys.id)
        }
        var counts: [String: Int] = [:]
        for counter in Counter.allCases {
            counts[counter.rawValue] = min(maxCount, max(0, defaults.integer(forKey: Keys.pending(counter))))
        }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return Payload(
            app: app,
            id: id,
            platform: platform,
            version: info("CFBundleShortVersionString"),
            build: info("CFBundleVersion"),
            os: "\(os.majorVersion).\(os.minorVersion)",
            locale: locale(),
            counts: counts
        )
    }

    /// The server took it: take what it covered off the counters, so anything counted while
    /// it was in flight waits for tomorrow.
    public static func sent(_ payload: Payload, now: Date = Date(), defaults: UserDefaults = .standard) {
        defaults.set(day(now), forKey: Keys.lastSent)
        for counter in Counter.allCases {
            let key = Keys.pending(counter)
            defaults.set(max(0, defaults.integer(forKey: key) - (payload.counts[counter.rawValue] ?? 0)), forKey: key)
        }
    }

    public static func forget(_ defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: Keys.id)
        defaults.removeObject(forKey: Keys.lastSent)
        for counter in Counter.allCases {
            defaults.removeObject(forKey: Keys.pending(counter))
        }
    }

    /// Where pings go. No `MetricsURL` in the Info.plist (a fork, `swift test`) means nothing
    /// is sent, and neither is anything from the fixture app or a test host — those would
    /// count every CI run as an install. `POLARIS_METRICS_URL` points a dev run elsewhere.
    public static func endpoint(
        env: [String: String] = ProcessInfo.processInfo.environment,
        arguments: [String] = ProcessInfo.processInfo.arguments,
        plist: String? = Bundle.main.object(forInfoDictionaryKey: "MetricsURL") as? String
    ) -> URL? {
        if let custom = env["POLARIS_METRICS_URL"], !custom.isEmpty { return URL(string: custom) }
        if arguments.contains("-polaris-fixtures") || env["XCTestConfigurationFilePath"] != nil { return nil }
        guard let plist, !plist.isEmpty else { return nil }
        return URL(string: plist)
    }

    @MainActor private static var sending = false

    /// On every foreground. Silent: a failure is retried on the next one.
    @MainActor
    public static func sendIfDue(session: URLSession = .shared) {
        guard !sending, let url = endpoint(), let payload = due() else { return }
        sending = true
        Task { @MainActor in
            defer { sending = false }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Polaris/\(payload.version)", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 15
            request.httpBody = try? JSONEncoder().encode(payload)
            guard let (_, response) = try? await session.data(for: request),
                  let code = (response as? HTTPURLResponse)?.statusCode,
                  (200..<300).contains(code)
            else { return }
            sent(payload)
        }
    }

    public static func day(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static var platform: String {
        #if os(macOS)
        "mac"
        #else
        "ios"
        #endif
    }

    /// Language and region only, "pt-PT": the full identifier can carry a calendar, a
    /// numbering system and more, which say nothing useful and can pass the server's limit.
    public static func locale(_ l: Locale = .current) -> String {
        let language = l.language.languageCode?.identifier ?? "und"
        guard let region = l.region?.identifier else { return language }
        return "\(language)-\(region)"
    }

    private static func info(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "0"
    }
}
