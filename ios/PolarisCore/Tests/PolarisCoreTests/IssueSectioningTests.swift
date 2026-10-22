import Foundation
import Testing

@testable import PolarisCore

/// What a list of issues looks like once the display schema has been applied to it: nine
/// groupings, seven orderings, two directions, and the three rules that have to hold across all
/// of them — an empty group is not emitted, a nil group is a named section, and every ordering
/// is total.
///
/// Host-side, with no simulator and no view in the loop, which is why the whole matrix is
/// affordable to assert rather than clicked through on a phone.
@Suite("Issue sectioning")
struct IssueSectioningTests {
    /// UTC, so a due-date bucket asserts the same in Lisbon as in Auckland, and a fixed first
    /// weekday so "this week" is a fact rather than a locale.
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.firstWeekday = 2
        return calendar
    }()

    /// A Wednesday, so "this week" has days on both sides of it.
    private static let today = Self.utc.startOfDay(for: ISO8601DateFormatter().date(from: "2026-09-09T12:00:00Z")!)

    private func context(statesFor: @escaping (PolarisCore.Issue) -> [WorkflowState] = { _ in FixtureData.states }) -> IssueSectioning.Context {
        IssueSectioning.Context(statesFor: statesFor, today: Self.today, calendar: Self.utc)
    }

    /// Built with the memberwise initialiser rather than through `FixtureData`, because several
    /// of these cases need a field `FixtureData.issue` does not take — a second team, a parent
    /// ref, a created date — and the point here is the sectioning, not the decoder.
    private func issue(
        _ identifier: String,
        state: WorkflowState = FixtureData.states[1],
        priority: Priority = .none,
        assignee: User? = nil,
        labels: [Label] = [],
        team: Team = FixtureData.team,
        estimate: Int? = nil,
        dueDate: String? = nil,
        title: String = "Title",
        parent: IssueRef? = nil,
        createdAt: Date = Self.today,
        updatedAt: Date = Self.today
    ) -> PolarisCore.Issue {
        PolarisCore.Issue(
            id: identifier, identifier: identifier, title: title, priority: priority,
            estimate: estimate, dueDate: dueDate, state: state, team: team, assignee: assignee,
            labels: labels, parentId: parent?.id, parent: parent,
            createdAt: createdAt, updatedAt: updatedAt
        )
    }

    private static let otherTeam: Team = {
        let json = ##"{"id":"t2","key":"DES","name":"Design","icon":null,"color":"#B65BEF","triageEnabled":false,"cyclesEnabled":false}"##
        return try! PolarisJSON.decoder().decode(Team.self, from: Data(json.utf8))
    }()

    // MARK: - Every grouping

    @Test("every groupBy in the schema cuts the list, and loses nothing out of it")
    func everyGroupingKeepsEveryIssue() {
        let issues = [
            issue("ENG-1", state: FixtureData.states[2], priority: .urgent,
                  assignee: FixtureData.users[0], labels: [FixtureData.labels[0]], dueDate: "2026-09-01"),
            issue("ENG-2", state: FixtureData.states[1], priority: .medium),
            issue("DES-1", state: FixtureData.states[0], priority: .high,
                  assignee: FixtureData.users[1], labels: [FixtureData.labels[1]],
                  team: Self.otherTeam, dueDate: "2026-09-09",
                  parent: IssueRef(id: "ENG-1", identifier: "ENG-1", title: "Title")),
            issue("ENG-4", state: FixtureData.states[3]),
        ]

        for groupBy in ListDisplay.GroupBy.allCases {
            let sections = IssueSectioning.sections(
                issues, display: ListDisplay(groupBy: groupBy), context: context()
            )
            #expect(!sections.isEmpty, "\(groupBy.rawValue) produced no sections at all")
            // Only `label` may repeat an issue, and only because an issue can carry several.
            let seen = sections.flatMap { $0.issues.map(\.identifier) }
            #expect(Set(seen) == Set(issues.map(\.identifier)), "\(groupBy.rawValue) lost or invented an issue")
            #expect(sections.allSatisfy { !$0.issues.isEmpty }, "\(groupBy.rawValue) emitted an empty group")
        }
    }

    @Test("no grouping is one section holding the whole list")
    func noGroupingIsOneSection() {
        let issues = [issue("ENG-1"), issue("ENG-2")]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .none), context: context())

        #expect(sections.count == 1)
        #expect(sections[0].key == .none)
        #expect(sections[0].issues.map(\.identifier) == ["ENG-1", "ENG-2"])
    }

    @Test("an empty list is no sections, not one empty one")
    func nothingIsNothing() {
        for groupBy in ListDisplay.GroupBy.allCases {
            let sections = IssueSectioning.sections([], display: ListDisplay(groupBy: groupBy), context: context())
            #expect(sections.isEmpty, "\(groupBy.rawValue) made a section out of nothing")
        }
    }

    @Test("a state with no issues in it is not a group")
    func emptyStateGroupIsNotEmitted() {
        let open = FixtureData.baseIssues.filter { $0.state.category.isOpen }
        let sections = IssueSectioning.sections(open, display: ListDisplay(groupBy: .state), context: context())

        #expect(!sections.contains { $0.key.name == "Done" }, "an empty group is not a group")
        #expect(sections.count == 3)
    }

    @Test("state groups run triage, started, unstarted, backlog, then closed")
    func stateGroupsFollowTheCategoryRank() {
        let issues = IssueOrder.sorted(FixtureData.baseIssues)
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .state), context: context())

        #expect(sections.map(\.key.name) == ["In Progress", "Todo", "Backlog", "Done"])
    }

    @Test("two states in one category follow the workspace's own order of them")
    func stateGroupsWithinACategoryFollowTheWorkspaceOrder() throws {
        let decoder = PolarisJSON.decoder()
        let later = try decoder.decode(WorkflowState.self, from: Data(
            ##"{"id":"u1","name":"Later","color":"#9AA0A6","category":"UNSTARTED","position":"a"}"##.utf8))
        let soon = try decoder.decode(WorkflowState.self, from: Data(
            ##"{"id":"u2","name":"Soon","color":"#9AA0A6","category":"UNSTARTED","position":"b"}"##.utf8))
        let issues = [issue("ENG-1", state: soon), issue("ENG-2", state: later)]

        let sections = IssueSectioning.sections(
            issues, display: ListDisplay(groupBy: .state), context: context { _ in [later, soon] }
        )

        #expect(sections.map(\.key.name) == ["Later", "Soon"])
    }

    @Test("category groups collapse the states that share a category")
    func categoryGroupsCollapseStates() {
        let issues = [
            issue("ENG-1", state: FixtureData.states[2]),
            issue("ENG-2", state: FixtureData.states[6]),
            issue("ENG-3", state: FixtureData.states[1]),
        ]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .stateCategory), context: context())

        #expect(sections.map(\.key.name) == ["In progress", "Unstarted"])
        #expect(sections[0].issues.map(\.identifier) == ["ENG-1", "ENG-2"], "both started states, one group")
    }

    @Test("priority groups run urgent first and no-priority last")
    func priorityGroupsRunUrgentFirst() {
        let issues = [
            issue("ENG-1", priority: Priority.none),
            issue("ENG-2", priority: .low),
            issue("ENG-3", priority: .urgent),
        ]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .priority), context: context())

        #expect(sections.map(\.key.name) == ["Urgent", "Low", "No priority"])
    }

    @Test("an issue with several labels is under each of them")
    func labelGroupingFansOut() {
        let issues = [
            issue("ENG-1", labels: [FixtureData.labels[0], FixtureData.labels[1]]),
            issue("ENG-2", labels: [FixtureData.labels[1]]),
        ]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .label), context: context())

        #expect(sections.map(\.key.name) == ["backend", "needs-design"])
        #expect(sections[0].issues.map(\.identifier) == ["ENG-1"])
        #expect(sections[1].issues.map(\.identifier) == ["ENG-1", "ENG-2"], "one issue, two labels, two groups")
    }

    @Test("teams group by key")
    func teamGroupsByKey() {
        let issues = [issue("ENG-1"), issue("DES-1", team: Self.otherTeam)]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .team), context: context())

        #expect(sections.map(\.key.name) == ["Design", "Engineering"])
    }

    @Test("due dates bucket as overdue, today, tomorrow, this week, next week, later, none")
    func dueDateBuckets() {
        let issues = [
            issue("ENG-1", dueDate: "2026-09-01"),   // last week
            issue("ENG-2", dueDate: "2026-09-09"),   // today, a Wednesday
            issue("ENG-3", dueDate: "2026-09-10"),   // tomorrow
            issue("ENG-4", dueDate: "2026-09-13"),   // Sunday, still this week
            issue("ENG-5", dueDate: "2026-09-16"),   // next week
            issue("ENG-6", dueDate: "2026-11-01"),   // later
            issue("ENG-7", dueDate: nil),
            issue("ENG-8", dueDate: "not a date"),
        ]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .dueDate), context: context())

        #expect(sections.map(\.key.name) == [
            "Overdue", "Today", "Tomorrow", "This week", "Next week", "Later", "No due date",
        ])
        #expect(
            sections.last?.issues.map(\.identifier) == ["ENG-7", "ENG-8"],
            "a malformed date is no date, not a date in the far past"
        )
    }

    @Test("parents group by identifier, and an issue with none gets a section of its own")
    func parentGroups() {
        let parent = IssueRef(id: "ENG-1", identifier: "ENG-1", title: "Title")
        let issues = [issue("ENG-1"), issue("ENG-91", parent: parent), issue("ENG-92", parent: parent)]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .parent), context: context())

        #expect(sections.map(\.key.name) == ["ENG-1", "No parent"])
        #expect(sections[0].issues.map(\.identifier) == ["ENG-91", "ENG-92"])
    }

    // MARK: - A nil group is a section, not a disappearance

    @Test("an unassigned issue groups under a real No assignee section")
    func unassignedIsASection() {
        let issues = [
            issue("ENG-1", assignee: FixtureData.users[0]),
            issue("ENG-2"),
        ]
        let sections = IssueSectioning.sections(issues, display: ListDisplay(groupBy: .assignee), context: context())

        #expect(sections.map(\.key.name) == ["Miguel Peixoto", "No assignee"])
        #expect(sections.last?.issues.map(\.identifier) == ["ENG-2"], "the unassigned issue is in the list, not gone")
        #expect(sections.last?.key == .assignee(nil))
    }

    @Test("every grouping that can be absent puts its nil section last and names it")
    func nilSectionsAreNamedAndLast() {
        let withSomething = [
            ListDisplay.GroupBy.assignee: issue("ENG-1", assignee: FixtureData.users[0]),
            .label: issue("ENG-1", labels: [FixtureData.labels[0]]),
            .parent: issue("ENG-1", parent: IssueRef(id: "p", identifier: "ENG-9", title: "Title")),
            .dueDate: issue("ENG-1", dueDate: "2026-09-09"),
        ]
        for (groupBy, present) in withSomething {
            let sections = IssueSectioning.sections(
                [present, issue("ENG-2")], display: ListDisplay(groupBy: groupBy), context: context()
            )
            #expect(sections.count == 2, "\(groupBy.rawValue) should have both a group and a nil group")
            let last = try! #require(sections.last)
            #expect(!last.key.name.isEmpty, "\(groupBy.rawValue)'s nil group needs a name")
            #expect(last.issues.map(\.identifier) == ["ENG-2"], "\(groupBy.rawValue) put its nil group first")
        }
    }

    // MARK: - Every ordering is total

    @Test("every ordering is total: issues tied on the sort key come out in identifier order")
    func everyOrderingIsTotal() {
        // Every issue identical on every sort key but the identifier, so only the final tiebreak
        // can decide — and it has to decide the same way whichever order they arrive in.
        let tied = ["ENG-3", "ENG-1", "ENG-2"].map { issue($0) }
        for orderBy in ListDisplay.OrderBy.allCases where orderBy != .manual {
            for direction in ListDisplay.Direction.allCases {
                let display = ListDisplay(groupBy: .none, orderBy: orderBy, direction: direction)
                let forwards = IssueSectioning.sections(tied, display: display, context: context())
                let backwards = IssueSectioning.sections(tied.reversed(), display: display, context: context())

                #expect(
                    forwards[0].issues.map(\.identifier) == ["ENG-1", "ENG-2", "ENG-3"],
                    "\(orderBy.rawValue)/\(direction.rawValue) left tied rows in the order they arrived"
                )
                #expect(
                    forwards[0].issues.map(\.identifier) == backwards[0].issues.map(\.identifier),
                    "\(orderBy.rawValue)/\(direction.rawValue) shuffles tied rows with the input order"
                )
            }
        }
    }

    @Test("sectioning the same list twice gives the same answer, for every ordering")
    func sectioningIsDeterministic() {
        let issues = [
            issue("ENG-1", priority: .urgent, estimate: 3, dueDate: "2026-09-01", title: "beta"),
            issue("ENG-2", priority: .urgent, title: "Alpha"),
            issue("ENG-3", priority: .low, estimate: 3, dueDate: "2026-10-01", title: "alpha"),
            issue("ENG-4", estimate: 1, title: "Gamma"),
        ]
        for orderBy in ListDisplay.OrderBy.allCases {
            let display = ListDisplay(groupBy: .none, orderBy: orderBy)
            let first = IssueSectioning.sections(issues, display: display, context: context())
            let again = IssueSectioning.sections(issues, display: display, context: context())
            #expect(
                first[0].issues.map(\.identifier) == again[0].issues.map(\.identifier),
                "\(orderBy.rawValue) is not stable across two runs"
            )
        }
    }

    @Test("each ordering orders by the thing it names")
    func orderingsOrderByWhatTheyName() {
        let early = ISO8601DateFormatter().date(from: "2026-01-01T00:00:00Z")!
        let late = ISO8601DateFormatter().date(from: "2026-06-01T00:00:00Z")!
        let issues = [
            issue("ENG-1", priority: .low, estimate: 8, dueDate: "2026-10-01", title: "Zebra",
                  createdAt: late, updatedAt: late),
            issue("ENG-2", priority: .urgent, estimate: 1, dueDate: "2026-09-01", title: "Apple",
                  createdAt: early, updatedAt: early),
        ]
        func order(_ orderBy: ListDisplay.OrderBy) -> [String] {
            IssueSectioning.sections(
                issues, display: ListDisplay(groupBy: .none, orderBy: orderBy), context: context()
            )[0].issues.map(\.identifier)
        }

        #expect(order(.manual) == ["ENG-1", "ENG-2"], "manual is the order the caller handed in")
        #expect(order(.priority) == ["ENG-2", "ENG-1"], "urgent before low")
        #expect(order(.dueDate) == ["ENG-2", "ENG-1"], "the sooner deadline first")
        #expect(order(.estimate) == ["ENG-2", "ENG-1"], "the smaller estimate first")
        #expect(order(.createdAt) == ["ENG-2", "ENG-1"], "ascending is oldest first")
        #expect(order(.updatedAt) == ["ENG-2", "ENG-1"])
        #expect(order(.title) == ["ENG-2", "ENG-1"], "Apple before Zebra, whatever the case")
    }

    @Test("an issue with no estimate or due date sinks in both directions")
    func absenceIsNotAValue() {
        let issues = [issue("ENG-1"), issue("ENG-2", estimate: 5, dueDate: "2026-09-01")]
        for orderBy in [ListDisplay.OrderBy.estimate, .dueDate] {
            for direction in ListDisplay.Direction.allCases {
                let sections = IssueSectioning.sections(
                    issues,
                    display: ListDisplay(groupBy: .none, orderBy: orderBy, direction: direction),
                    context: context()
                )
                #expect(
                    sections[0].issues.map(\.identifier) == ["ENG-2", "ENG-1"],
                    "\(orderBy.rawValue)/\(direction.rawValue): an absent value is not an extreme one"
                )
            }
        }
    }

    // MARK: - Direction

    @Test("direction reverses within a group without reshuffling ties")
    func directionReversesWithinAGroup() {
        let state = FixtureData.states[1]
        let issues = [
            issue("ENG-1", state: state, priority: .urgent),
            issue("ENG-2", state: state, priority: .low),
            issue("ENG-3", state: state, priority: .low),
        ]
        let ascending = IssueSectioning.sections(
            issues, display: ListDisplay(groupBy: .state, orderBy: .priority, direction: .asc),
            context: context()
        )
        let descending = IssueSectioning.sections(
            issues, display: ListDisplay(groupBy: .state, orderBy: .priority, direction: .desc),
            context: context()
        )

        #expect(ascending.map(\.key.name) == ["Todo"], "the groups themselves do not move")
        #expect(descending.map(\.key.name) == ["Todo"])
        #expect(ascending[0].issues.map(\.identifier) == ["ENG-1", "ENG-2", "ENG-3"])
        #expect(
            descending[0].issues.map(\.identifier) == ["ENG-2", "ENG-3", "ENG-1"],
            "the priorities reverse; the two low rows keep their identifier order"
        )
    }

    // MARK: - The two filters

    @Test("showCompleted false drops finished work and the group it was in")
    func showCompletedFalseDropsFinishedWork() {
        let sections = IssueSectioning.sections(
            FixtureData.baseIssues,
            display: ListDisplay(groupBy: .state, showCompleted: false),
            context: context()
        )

        #expect(!sections.contains { $0.key.name == "Done" })
        #expect(sections.flatMap { $0.issues.map(\.identifier) } == ["ENG-1", "ENG-2", "ENG-3"])
    }

    @Test("showSubIssues false hides a child whose parent is in the same view")
    func showSubIssuesFalseHidesChildrenOfVisibleParents() {
        let parent = issue("ENG-1")
        let child = issue("ENG-91", parent: parent.ref)
        let orphan = issue("ENG-92", parent: IssueRef(id: "elsewhere", identifier: "ENG-50", title: "Title"))

        let hidden = IssueSectioning.sections(
            [parent, child, orphan],
            display: ListDisplay(groupBy: .none, showSubIssues: false),
            context: context()
        )
        #expect(
            hidden[0].issues.map(\.identifier) == ["ENG-1", "ENG-92"],
            "a child whose parent is not in the view is not a nested row, so it stays"
        )

        let shown = IssueSectioning.sections(
            [parent, child, orphan], display: ListDisplay(groupBy: .none), context: context()
        )
        #expect(shown[0].issues.count == 3, "showSubIssues is true by default")
    }

    // MARK: - Decoding the display schema

    @Test("the defaults are the ones the filter grammar states")
    func defaultsMatchTheSchema() {
        let display = ListDisplay()

        #expect(display.layout == .list)
        #expect(display.groupBy == .state)
        #expect(display.orderBy == .manual)
        #expect(display.direction == .asc)
        #expect(display.showSubIssues)
        #expect(display.showCompleted)
        #expect(display.properties == ["priority", "assignee", "labels", "estimate", "dueDate", "project"])
    }

    @Test("an empty display object is the default display")
    func absenceMeansTheDefault() throws {
        let display = try PolarisJSON.decoder().decode(ListDisplay.self, from: Data("{}".utf8))

        #expect(display == ListDisplay())
    }

    @Test("a groupBy this build has never heard of decodes to the default rather than throwing")
    func unknownValuesDegradeRatherThanBreak() throws {
        let json = """
        {"layout":"calendar","groupBy":"cycle","orderBy":"vibes","direction":"sideways",
         "showSubIssues":false,"properties":["priority","somethingNew"]}
        """
        let display = try PolarisJSON.decoder().decode(ListDisplay.self, from: Data(json.utf8))

        #expect(display.layout == .list)
        #expect(display.groupBy == .state, "an unknown grouping renders the default view, not none at all")
        #expect(display.orderBy == .manual)
        #expect(display.direction == .asc)
        #expect(!display.showSubIssues, "the keys it does understand still apply")
        #expect(display.properties == ["priority", "somethingNew"], "a property it cannot draw still round-trips")

        // And an unknown grouping still sections the list rather than emptying it.
        let sections = IssueSectioning.sections(FixtureData.baseIssues, display: display, context: context())
        #expect(sections.flatMap(\.issues).count == FixtureData.baseIssues.count)
    }

    @Test("a display round-trips through JSON with every key written out")
    func encodingWritesEveryKey() throws {
        let display = ListDisplay(groupBy: .assignee, orderBy: .dueDate, direction: .desc, showCompleted: false)
        let data = try PolarisJSON.encoder().encode(display)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect(Set(object.keys) == [
            "layout", "groupBy", "orderBy", "direction", "showSubIssues", "showCompleted", "properties",
        ], "a key this client omitted is a key the web client would re-default")
        #expect(try PolarisJSON.decoder().decode(ListDisplay.self, from: data) == display)
    }
}
