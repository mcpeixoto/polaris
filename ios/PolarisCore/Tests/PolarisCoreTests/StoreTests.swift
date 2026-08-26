import Foundation
import Testing
@testable import PolarisCore

// Store behaviour, driven against the fixture client.
//
// These cover the logic that has no other check on it: what the list is ordered by, and what
// happens to an optimistic write when the server refuses. The rollback path in particular is
// impossible to exercise against a real server without breaking one, which is exactly why the
// fixture client can be told to fail the next write.

@MainActor
@Suite("Issue list")
struct IssuesStoreTests {
    private func store() -> (IssuesStore, FixturePolarisClient) {
        let api = FixturePolarisClient()
        return (IssuesStore(api: api), api)
    }

    @Test("orders open work first, by priority, and sinks finished work")
    func ordering() async {
        let (store, _) = store()
        await store.setIncludeCompleted(true)

        let list = try! #require(store.issues.value)
        // Open before closed, regardless of priority: a completed urgent issue is still done.
        #expect(list.last?.state.category == .completed)
        // Among open issues, urgent leads.
        #expect(list.first?.priority == Priority.urgent)

        let openPriorities = list
            .filter { $0.state.category.isOpen }
            .map(\.priority.sortWeight)
        #expect(openPriorities == openPriorities.sorted())
    }

    @Test("hides completed work unless asked")
    func filtersCompleted() async {
        let (store, _) = store()
        await store.load()
        #expect(store.issues.value?.contains { $0.state.category == .completed } == false)

        await store.setIncludeCompleted(true)
        #expect(store.issues.value?.contains { $0.state.category == .completed } == true)
    }

    @Test("a status change replaces the row with what the server returned")
    func optimisticSuccess() async {
        let (store, _) = store()
        await store.load()
        let target = try! #require(store.issues.value?.first { $0.state.category == .started })
        let done = FixtureData.states[3]

        await store.setState(issueID: target.id, to: done)

        let updated = store.issues.value?.first { $0.id == target.id }
        #expect(updated?.state.category == .completed)
        // Cleared even though the write succeeded — a row stuck in "settling" is its own bug.
        #expect(store.pendingIssueIDs.isEmpty)
    }

    @Test("a refused status change rolls the row back")
    func optimisticRollback() async {
        let (store, api) = store()
        await store.load()
        let target = try! #require(store.issues.value?.first { $0.state.category == .started })
        let originalStateID = target.state.id

        await api.setFailNextWrite(.forbidden)
        await store.setState(issueID: target.id, to: FixtureData.states[3])

        let after = store.issues.value?.first { $0.id == target.id }
        #expect(after?.state.id == originalStateID)
        #expect(store.pendingIssueIDs.isEmpty)
    }

    @Test("a failed refresh keeps the list the user is reading")
    func refreshFailureKeepsData() async {
        // The trade this asserts: a pull-to-refresh that fails must not blank the screen.
        // Only an empty list is allowed to surface the error.
        let (store, _) = store()
        await store.load()
        let before = store.issues.value?.count

        await store.load()
        #expect(store.issues.value?.count == before)
        #expect(store.issues.error == nil)
    }
}

@MainActor
@Suite("Issue detail")
struct IssueDetailStoreTests {
    @Test("opens with the row it was given, before any request")
    func seedsFromRow() {
        let api = FixturePolarisClient()
        let seed = FixtureData.issues[0]
        let store = IssueDetailStore(api: api, issue: seed)
        // Not .loading: the app already had this issue, and spinnering over it would be a
        // self-inflicted delay.
        #expect(store.issue.value?.id == seed.id)
    }

    @Test("a posted comment appears")
    func postComment() async {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.issues[0])
        await store.load()

        await store.postComment("  Looks right to me.  ")

        let comments = try! #require(store.comments.value)
        #expect(comments.count == 1)
        // Trimmed on the way out, so a stray newline does not become a stored comment body.
        #expect(comments.last?.body == "Looks right to me.")
        #expect(store.commentError == nil)
    }

    @Test("an empty comment is not sent")
    func ignoresEmptyComment() async {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.issues[0])
        await store.load()

        await store.postComment("   \n  ")
        #expect(store.comments.value?.isEmpty == true)
    }

    @Test("a refused comment surfaces the reason and is not shown as posted")
    func commentFailure() async {
        let api = FixturePolarisClient()
        let store = IssueDetailStore(api: api, issue: FixtureData.issues[0])
        await store.load()

        await api.setFailNextWrite(.validation(message: "Comment is too long", field: "body"))
        await store.postComment("...")

        #expect(store.commentError?.displayMessage == "Comment is too long")
        #expect(store.comments.value?.isEmpty == true)
        #expect(store.isPostingComment == false)
    }
}
