import Foundation
import Testing
@testable import PolarisCore

/// The fixture as the parity screens see it: the four rows the UI tests count are unchanged,
/// the detail of ENG-1 has everything a detail screen renders, and every mutation that the
/// server treats as idempotent is idempotent here too — a retry must not double anything.
@Suite("Fixture parity")
struct FixtureParityTests {
    @Test("the default list is still the four rows the UI tests count, in their states")
    func baseRowsUnchanged() async throws {
        let api = FixturePolarisClient()
        let rows = try await api.issues(teamId: "t1")
        #expect(rows.map(\.identifier) == ["ENG-1", "ENG-2", "ENG-3", "ENG-4"])
        #expect(rows.map(\.state.category) == [.started, .unstarted, .backlog, .completed])
        #expect(rows.map(\.priority) == [.urgent, .medium, .high, Priority.none])
        #expect(rows.map { $0.assignee?.id } == ["u1", nil, "u2", nil])
        // Every open row, as it always was: the UI tests count "3 OPEN".
        #expect(try await api.myIssues(includeCompleted: false).map(\.identifier) == ["ENG-1", "ENG-2", "ENG-3"])
        // The sub-issues are reachable, and not in the list.
        #expect(try await api.issue(id: "i1a").identifier == "ENG-91")
        #expect(try await api.issueByIdentifier("eng-92").id == "i1b")
    }

    @Test("ENG-1's detail carries a project, the running cycle, labels, dates, children and links")
    func richDetail() async throws {
        let api = FixturePolarisClient()
        let detail = try await api.issueDetail(id: "i1")
        #expect(detail.issue.project?.id == "p1")
        #expect(detail.issue.cycle?.id == FixtureData.activeCycle.id)
        #expect(FixtureData.activeCycle.isActive())
        #expect(FixtureData.upcomingCycle.isUpcoming())
        #expect(detail.issue.labels.map(\.name) == ["backend", "regression"])
        #expect(detail.issue.dueDate == "2026-09-12" && detail.issue.estimate == 3)
        #expect(detail.issue.progress?.total == 2)
        #expect(detail.children.map(\.identifier) == ["ENG-91", "ENG-92"])
        #expect(detail.attachments.first?.title == "Pull request #481")
        #expect(detail.relations.count == 1 && detail.blockedBy.isEmpty)
        #expect(detail.isSubscribed("u1") && detail.isSubscribed("u2"))
        #expect(try await api.issueHistory(issueId: "i1").count == 3)

        // The other end of the same relation.
        let blocked = try await api.issueDetail(id: "i2")
        #expect(blocked.blockedBy.first?.counterpart(of: "i2").identifier == "ENG-1")
        #expect(blocked.relations.isEmpty)
    }

    @Test("the scopes pick by creator and by active subscription")
    func scopes() async throws {
        let api = FixturePolarisClient()
        #expect(try await api.myIssues(scope: .created, includeCompleted: false).map(\.identifier) == ["ENG-2", "ENG-3"])
        #expect(try await api.myIssues(scope: .created, includeCompleted: true).map(\.identifier) == ["ENG-2", "ENG-3"])
        // ENG-3 carries an explicit opt-out and is left out.
        #expect(try await api.myIssues(scope: .subscribed, includeCompleted: true).map(\.identifier) == ["ENG-1", "ENG-2"])
    }

    @Test("reference data is what the workspace screens expect")
    func referenceData() async throws {
        let api = FixturePolarisClient()
        #expect(try await api.labels().count == 5)
        #expect(try await api.projects().map(\.name) == ["Mobile parity", "Sync v2"])
        #expect(try await api.projectStatuses().map(\.category) == [.backlog, .planned, .started, .completed, .canceled])
        #expect(try await api.cycles(teamId: "t1").map(\.number) == [7, 8])
        #expect(try await api.cycles(teamId: "other").isEmpty)
        #expect(try await api.favorites().count == 1)
        #expect(try await api.notificationPrefs().isMuted(.pulseDigest))
        #expect(try await api.comments(issueId: "i2").first?.hasReaction("👍", by: "u1") == true)
        #expect(try await api.comments(issueId: "i1").isEmpty)
        #expect(try await api.accessToken() == "fixture")
        #expect(api.syncSocketURL().absoluteString == "ws://localhost:8088/sync")
    }

    @Test("a retried create with the same opId is one issue")
    func createIsIdempotent() async throws {
        let api = FixturePolarisClient()
        let draft = IssueDraft(teamId: "t1", title: "once", labelIds: ["lab2"], dueDate: "2026-09-30", projectId: "p2")
        let first = try await api.createIssue(draft)
        let second = try await api.createIssue(draft)
        #expect(first == second)
        #expect(try await api.issues(teamId: "t1").count == 5)
        #expect(first.labels.map(\.id) == ["lab2"])
        #expect(first.dueDate == "2026-09-30" && first.project?.id == "p2")
        #expect(first.creator?.id == "u1")
    }

    @Test("a sub-issue joins its parent's children rather than the team list")
    func subIssueCreate() async throws {
        let api = FixturePolarisClient()
        let child = try await api.createIssue(IssueDraft(teamId: "t1", title: "child", parentId: "i1"))
        #expect(child.parentId == "i1" && child.parent?.identifier == "ENG-1")
        #expect(try await api.issues(teamId: "t1").count == 4)
        #expect(try await api.issueDetail(id: "i1").children.count == 3)
    }

    @Test("reactions, labels, links, relations and favourites do not double on a retry")
    func naturalKeyIdempotency() async throws {
        let api = FixturePolarisClient()
        let commentId = "c-eng2"
        let a = try await api.addReaction(commentId: commentId, emoji: "🎉", opId: "x")
        let b = try await api.addReaction(commentId: commentId, emoji: "🎉", opId: "y")
        #expect(a == b)
        #expect(try await api.comments(issueId: "i2").first?.reactions.count == 2)

        _ = try await api.addIssueLabel(issueId: "i1", labelId: "lab2", opId: "x")
        _ = try await api.addIssueLabel(issueId: "i1", labelId: "lab2", opId: "y")
        #expect(try await api.issue(id: "i1").labels.count == 3)

        let link = try await api.createAttachment(issueId: "i1", url: "https://example.com", title: "E", opId: "x")
        let again = try await api.createAttachment(issueId: "i1", url: "https://example.com", title: nil, opId: "y")
        #expect(link == again)
        #expect(try await api.issueDetail(id: "i1").attachments.count == 2)

        let rel = try await api.createIssueRelation(issueId: "i3", relatedIssueId: "i4", type: .related, opId: "x")
        let relAgain = try await api.createIssueRelation(issueId: "i3", relatedIssueId: "i4", type: .related, opId: "y")
        #expect(rel == relAgain)

        let fav = try await api.addFavorite(kind: .issue, targetId: "i3")
        #expect(fav.id == "fav1")
        #expect(try await api.favorites().count == 1)
    }

    @Test("the armed failure fires once, on whichever write comes first, including the new ones")
    func armedFailure() async throws {
        let api = FixturePolarisClient()
        await api.setFailNextWrite(.forbidden)
        await #expect(throws: PolarisError.forbidden) { try await api.deleteIssue(id: "i4", opId: "x") }
        try await api.deleteIssue(id: "i4", opId: "x")
        #expect(try await api.issues(teamId: "t1").count == 3)
    }

    @Test("an update honours every clear flag, and title and description")
    func updateHonoursFields() async throws {
        let api = FixturePolarisClient()
        let cleared = try await api.updateIssue(IssueChange(
            id: "i1", title: "Renamed", description: "Body", clearEstimate: true, clearDueDate: true,
            clearProject: true, clearCycle: true
        ))
        #expect(cleared.title == "Renamed" && cleared.description == "Body")
        #expect(cleared.estimate == nil && cleared.dueDate == nil)
        #expect(cleared.project == nil && cleared.projectId == nil && cleared.cycle == nil)
        #expect(cleared.labels.count == 2, "clearing planning fields dropped the labels")

        let set = try await api.updateIssue(IssueChange(id: "i2", estimate: 8, parentId: "i3", cycleId: "cy2"))
        #expect(set.estimate == 8 && set.parent?.identifier == "ENG-3" && set.cycle?.number == 8)
    }

    @Test("triage moves to the team's first unstarted status, or to canceled")
    func triage() async throws {
        let api = FixturePolarisClient()
        #expect(try await api.acceptTriageIssue(id: "i3", opId: "x").state.category == .unstarted)
        #expect(try await api.declineTriageIssue(id: "i2", opId: "x").state.category == .canceled)
    }

    @Test("a profile edit changes the viewer, and preferences round-trip")
    func profileAndPrefs() async throws {
        let api = FixturePolarisClient()
        let user = try await api.updateProfile(ProfileChange(displayName: "M. Peixoto"))
        #expect(user.displayName == "M. Peixoto")
        #expect(try await api.viewer().user.displayName == "M. Peixoto")
        #expect(try await api.users().first?.initials == "MP")

        var prefs = try await api.notificationPrefs()
        prefs.setMuted(.comment, true)
        prefs.desktop = true
        _ = try await api.updateNotificationPrefs(prefs)
        #expect(try await api.notificationPrefs().isMuted(.comment))
        #expect(try await api.notificationPrefs().desktop == true)
    }
}
