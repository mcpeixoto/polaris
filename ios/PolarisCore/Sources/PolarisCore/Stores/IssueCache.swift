import Foundation

/// Last-known issues, so a cold launch with no network is last week's list rather than an
/// error screen.
///
/// This is deliberately *not* the local replica the web and desktop clients hold, and it is
/// not a step towards one. It answers exactly one question — "what did this list look like the
/// last time it loaded?" — and it is overwritten wholesale on every successful load. No merge,
/// no deltas, no per-entity store; the app opened on the Tube shows what it saw last, marked
/// as what it is, and replaces it the moment a request succeeds.
public protocol IssueCache: Sendable {
    func read() -> [Issue]?
    func write(_ issues: [Issue])
    func clear()
}

/// A JSON file in Application Support.
///
/// Application Support rather than Caches: the system may evict Caches under pressure, and an
/// offline read that works on a full phone and not on an empty one is worse than none.
/// Excluded from backup, because it is derived data the server can always re-serve.
public struct FileIssueCache: IssueCache {
    private let url: URL

    /// One file per key. The app passes a single key and clears the cache when the workspace
    /// changes, rather than keeping a file per workspace: the alternative is an unbounded set
    /// of files for workspaces somebody visited once, to save one request each.
    public init?(key: String = "issues") {
        guard let directory = try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) else { return nil }
        let folder = directory.appending(path: "PolarisCache", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // The key could in principle contain a path separator, so it is not spliced into a
        // filename as-is.
        let safe = key.replacingOccurrences(
            of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression
        )
        self.url = folder.appending(path: "issues-\(safe).json")
    }

    public func read() -> [Issue]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        // A cache written by an older build that cannot be read is not an error worth
        // surfacing — it is simply a cold start.
        return try? PolarisJSON.decoder().decode([Issue].self, from: data)
    }

    public func write(_ issues: [Issue]) {
        guard let data = try? PolarisJSON.encoder().encode(issues) else { return }
        try? data.write(to: url, options: .atomic)
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        var mutable = url
        try? mutable.setResourceValues(resource)
    }

    public func clear() {
        try? FileManager.default.removeItem(at: url)
    }
}

/// For tests, and for the fixture app, where writing to the host's disk buys nothing.
public final class InMemoryIssueCache: IssueCache, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [Issue]?

    public init(seed: [Issue]? = nil) {
        self.stored = seed
    }

    public func read() -> [Issue]? {
        lock.lock(); defer { lock.unlock() }
        return stored
    }

    public func write(_ issues: [Issue]) {
        lock.lock(); defer { lock.unlock() }
        stored = issues
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        stored = nil
    }
}
