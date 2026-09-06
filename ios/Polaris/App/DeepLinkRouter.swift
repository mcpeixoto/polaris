import Foundation
import Observation
import PolarisCore

/// Holds links until there is a signed-in shell to open them in.
///
/// A link can arrive at any moment — on a cold launch before `start()` has restored the
/// session, on the welcome screen, or while the app is already showing an issue. The router
/// takes every one of them and the shell drains the queue whenever it is on screen, so a link
/// tapped while signed out opens the moment sign-in finishes rather than being lost.
///
/// Queued as parsed `DeepLink`s rather than URLs, so a URL this client does not understand is
/// dropped where it arrives instead of sitting in a queue nobody can act on.
@MainActor
@Observable
final class DeepLinkRouter {
    /// Links not yet applied, oldest first. The shell empties it.
    private(set) var pending: [DeepLink] = []
    /// A `/search?q=` query waiting for the search screen to pick it up. Written here rather
    /// than into the screen because the screen's store belongs to the screen; it reads and
    /// clears this on appearance.
    var pendingSearchQuery: String?

    /// Parses and queues. Returns whether the URL was a link this client knows.
    @discardableResult
    func open(_ url: URL) -> Bool {
        guard let link = DeepLink.parse(url) else { return false }
        pending.append(link)
        return true
    }

    /// Hands over everything queued and clears the queue.
    func drain() -> [DeepLink] {
        defer { pending.removeAll() }
        return pending
    }
}
