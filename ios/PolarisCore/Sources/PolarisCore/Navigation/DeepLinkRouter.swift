import Foundation
import Observation

/// Holds links until there is a signed-in shell to open them in.
///
/// A link can arrive at any moment — on a cold launch before `start()` has restored the
/// session, on the welcome screen, or while the app is already showing an issue. The router
/// takes every one of them and the shell drains the queue whenever it is on screen, so a link
/// tapped while signed out opens the moment sign-in finishes rather than being lost.
///
/// Queued as parsed `DeepLink`s rather than URLs, so a URL this client does not understand is
/// dropped where it arrives instead of sitting in a queue nobody can act on.
///
/// Beside `DeepLink` rather than in the app target, because a queue that hands things over
/// exactly once is worth a test and the app target's tests need a simulator.
@MainActor
@Observable
public final class DeepLinkRouter {
    /// Links not yet applied, oldest first. The shell empties it.
    public private(set) var pending: [DeepLink] = []
    /// A `/search?q=` query waiting for the search screen to pick it up. Written here rather
    /// than into the screen because the screen's store belongs to the screen.
    ///
    /// Readable so the screen can watch it — a second link arriving while the search tab is
    /// already up moves this and nothing else — but only the router clears it, in
    /// `takePendingSearchQuery()`. A query left parked would be re-run every time the reader
    /// came back to the tab.
    public private(set) var pendingSearchQuery: String?

    public init() {}

    /// Parses and queues. Returns whether the URL was a link this client knows.
    @discardableResult
    public func open(_ url: URL) -> Bool {
        guard let link = DeepLink.parse(url) else { return false }
        pending.append(link)
        return true
    }

    /// Hands over everything queued and clears the queue.
    public func drain() -> [DeepLink] {
        defer { pending.removeAll() }
        return pending
    }

    /// Parks a `/search?q=` query for the search screen. Nil is a `search` link with no query
    /// at all, which drops whatever an earlier link left unclaimed rather than opening the tab
    /// on somebody else's search.
    public func park(searchQuery: String?) {
        pendingSearchQuery = searchQuery
    }

    /// Hands the parked query over, once. Nil when there is nothing waiting.
    public func takePendingSearchQuery() -> String? {
        defer { pendingSearchQuery = nil }
        return pendingSearchQuery
    }
}
