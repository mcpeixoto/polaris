import Foundation
import Testing

@testable import PolarisCore

/// What the router hands over, and how many times.
///
/// `polaris://search?q=…` used to open the search tab with an empty field: the query was
/// written to `pendingSearchQuery` and nothing ever read it. Reading it would not have been
/// enough — a query left parked is one the tab re-runs every time the reader comes back to it,
/// and a second link carrying the same query would be no change at all for the screen to
/// notice. So it is taken, exactly once, and that is what these hold.
@MainActor
@Suite("Deep link router")
struct DeepLinkRouterTests {
    private func url(_ string: String) -> URL { URL(string: string)! }

    @Test("a known link is queued; an unknown one is refused where it arrives")
    func queuesWhatItUnderstands() {
        let router = DeepLinkRouter()

        #expect(router.open(url("polaris://inbox")))
        #expect(router.open(url("polaris://nonsense/42")) == false)

        #expect(router.pending == [.inbox])
    }

    @Test("draining hands over everything queued and empties the queue")
    func drainEmpties() {
        let router = DeepLinkRouter()
        router.open(url("polaris://inbox"))
        router.open(url("polaris://my-issues"))

        #expect(router.drain() == [.inbox, .myIssues])
        #expect(router.pending.isEmpty)
        #expect(router.drain().isEmpty)
    }

    @Test("a parked search query is handed over once")
    func searchQueryIsTakenOnce() {
        let router = DeepLinkRouter()

        router.park(searchQuery: "auth timeout")

        #expect(router.pendingSearchQuery == "auth timeout")
        #expect(router.takePendingSearchQuery() == "auth timeout")
        #expect(router.pendingSearchQuery == nil)
        #expect(router.takePendingSearchQuery() == nil)
    }

    /// Returning to the search tab an hour later must not re-run the link's search.
    @Test("nothing is waiting when no link parked a query")
    func nothingParkedIsNil() {
        let router = DeepLinkRouter()

        #expect(router.takePendingSearchQuery() == nil)
    }

    @Test("a second link replaces the query the first one parked")
    func secondLinkWins() {
        let router = DeepLinkRouter()

        router.park(searchQuery: "first")
        router.park(searchQuery: "second")

        #expect(router.takePendingSearchQuery() == "second")
    }

    @Test("a search link with no query drops the one nobody claimed")
    func queryLessLinkClears() {
        let router = DeepLinkRouter()

        router.park(searchQuery: "first")
        router.park(searchQuery: nil)

        #expect(router.takePendingSearchQuery() == nil)
    }

    /// The whole path the fix restores: parse, queue, drain, park, take.
    @Test("a search link ends with the query in the screen's hands")
    func searchLinkRoundTrip() {
        let router = DeepLinkRouter()

        #expect(router.open(url("polaris://search?q=cold%20start")))
        guard case .search(let query) = router.drain().first else {
            // Spelled out: `@testable import PolarisCore` also brings an `Issue` into scope.
            Testing.Issue.record("the search link was not queued")
            return
        }
        router.park(searchQuery: query)

        #expect(router.takePendingSearchQuery() == "cold start")
    }
}
