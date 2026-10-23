import XCTest
import PolarisCore
@testable import Polaris

/// The sheet's two pure pieces: the AST a set of chips composes, and the chips a collection
/// offers.
///
/// The evaluator itself is pinned against `schema/filter-conformance.json` in
/// `PolarisCoreTests`. What is asserted here is the half that lives in the view layer and
/// that the conformance fixture cannot see: whether the chips somebody tapped turn into the
/// filter they meant, and whether a filter bound for the server can only contain fields the
/// server has heard of.
final class FilterDraftTests: XCTestCase {
    private func fields(in node: JSONValue) -> Set<String> {
        guard case .object(let object) = node else { return [] }
        if case .string(let field)? = object["field"] { return [field] }
        guard case .array(let children)? = object["nodes"] else { return [] }
        return children.reduce(into: Set<String>()) { $0.formUnion(fields(in: $1)) }
    }

    private func clauses(in node: JSONValue) -> [[String: JSONValue]] {
        guard case .object(let object) = node else { return [] }
        if object["field"] != nil { return [object] }
        guard case .array(let children)? = object["nodes"] else { return [] }
        return children.flatMap(clauses(in:))
    }

    private func issue(
        _ id: String,
        priority: Priority = .none,
        assignee: User? = nil,
        labels: [PolarisCore.Label] = [],
        project: ProjectRef? = nil,
        cycle: CycleRef? = nil,
        state: WorkflowState = FixtureData.states[1]
    ) -> PolarisCore.Issue {
        PolarisCore.Issue(
            id: id,
            identifier: "ENG-\(id)",
            title: "Issue \(id)",
            priority: priority,
            state: state,
            team: FixtureData.team,
            assignee: assignee,
            creator: FixtureData.users[0],
            labels: labels,
            projectId: project?.id,
            cycleId: cycle?.id,
            project: project,
            cycle: cycle
        )
    }

    // MARK: - What the chips compose

    /// Nothing selected is nil, not an empty group. An empty `and` matches everything, so
    /// sending one is a clause the server evaluates for no reason and applying one locally is
    /// a pass over the list for no reason.
    func testAnEmptyDraftIsNoFilterAtAll() {
        let draft = IssueFilterDraft()
        XCTAssertNil(draft.filter)
        XCTAssertTrue(draft.isEmpty)
        XCTAssertEqual(draft.activeFields, 0)
    }

    func testOneFieldPerSelectionRegardlessOfHowManyChips() {
        var draft = IssueFilterDraft()
        draft.priorities = [1, 2, 3]
        XCTAssertEqual(draft.activeFields, 1, "three priorities are one narrowing, not three")
        draft.labels = ["l1"]
        draft.dueDate = .overdue
        XCTAssertEqual(draft.activeFields, 3)
    }

    /// Several chips in one section are an `in`, which is the grammar's "any of these".
    func testSeveralChipsInOneSectionBecomeAnInList() throws {
        var draft = IssueFilterDraft()
        draft.priorities = [1, 2]
        let node = try XCTUnwrap(draft.filter)
        let clause = try XCTUnwrap(clauses(in: node).first)
        XCTAssertEqual(clause["field"], .string("priority"))
        XCTAssertEqual(clause["op"], .string("in"))
        // Sorted, so the same selection is the same bytes — a filter that differs only by
        // dictionary order is a cache key that misses and a diff that reads as a change.
        XCTAssertEqual(clause["values"], .array([.string("1"), .string("2")]))
    }

    /// "Ada or nobody" has to be an `or`: `assignee in [ada]` cannot express the unassigned,
    /// because there is no id for having none.
    func testUnassignedIsAnOrAndNotASentinelId() throws {
        var draft = IssueFilterDraft()
        draft.assignees = ["u1"]
        draft.unassigned = true
        let node = try XCTUnwrap(draft.filter)
        let ops = clauses(in: node).compactMap { $0["op"]?.stringValue }
        XCTAssertEqual(Set(ops), ["in", "isNull"])
        XCTAssertEqual(draft.activeFields, 1, "assignee is one field however it is spelled")
    }

    /// Unassigned on its own is the single clause, not an `or` with one branch.
    func testUnassignedAloneIsOneClause() throws {
        var draft = IssueFilterDraft()
        draft.unassigned = true
        let node = try XCTUnwrap(draft.filter)
        let clause = try XCTUnwrap(clauses(in: node).first)
        XCTAssertEqual(clause["field"], .string("assignee"))
        XCTAssertEqual(clause["op"], .string("isNull"))
        XCTAssertNil(clause["values"], "isNull carries no values key at all")
    }

    /// `dueDate lt now` is what makes a filter mean overdue — `now` is the only token that
    /// names an instant rather than the start of a day.
    func testOverdueIsDueDateLessThanNow() throws {
        var draft = IssueFilterDraft()
        draft.dueDate = .overdue
        let clause = try XCTUnwrap(clauses(in: try XCTUnwrap(draft.filter)).first)
        XCTAssertEqual(clause["field"], .string("dueDate"))
        XCTAssertEqual(clause["op"], .string("lt"))
        XCTAssertEqual(clause["values"], .array([.string("now")]))
    }

    /// Relative tokens, not resolved dates. A window stored as "2026-10-23 to 2026-10-30"
    /// would be a filter that means the week it was built in — the bug the grammar's own
    /// "resolved at evaluation time" rule exists to prevent.
    func testTheNextSevenDaysStaysRelative() throws {
        var draft = IssueFilterDraft()
        draft.dueDate = .soon
        let values = clauses(in: try XCTUnwrap(draft.filter))
            .compactMap { $0["values"] }
        XCTAssertEqual(values, [.array([.string("today")]), .array([.string("+7d")])])
    }

    /// The due-date windows are mutually exclusive readings of one column, so the draft holds
    /// one of them rather than a set.
    func testDueDateWindowsAreSingleSelect() throws {
        var draft = IssueFilterDraft()
        draft.dueDate = .overdue
        draft.dueDate = .none
        let clause = try XCTUnwrap(clauses(in: try XCTUnwrap(draft.filter)).first)
        XCTAssertEqual(clause["op"], .string("isNull"))
        XCTAssertEqual(clauses(in: try XCTUnwrap(draft.filter)).count, 1)
    }

    // MARK: - The line between local and server

    /// Everything the search sheet can set is a field the grammar has. This is the assertion
    /// that stands between the sheet and a search that fails with a hard error: `project` and
    /// `cycle` are answerable here and nowhere else, and the search sheet is built from
    /// `IssueFilterOptions(forServerSearch:)` precisely so they cannot be selected.
    func testEverythingTheSearchSheetOffersIsSendable() throws {
        let options = IssueFilterOptions(
            forServerSearch: FixtureData.users,
            labels: FixtureData.labels
        )
        XCTAssertFalse(options.offersLocalFields)
        XCTAssertTrue(options.projects.isEmpty)
        XCTAssertTrue(options.cycles.isEmpty)

        // A draft holding every field that sheet can reach.
        var draft = IssueFilterDraft()
        draft.assignees = [FixtureData.users[0].id]
        draft.unassigned = true
        draft.creators = [FixtureData.users[1].id]
        draft.priorities = [1]
        draft.categories = ["started"]
        draft.labels = [FixtureData.labels[0].id]
        draft.dueDate = .overdue

        let node = try XCTUnwrap(draft.filter)
        XCTAssertTrue(
            fields(in: node).isSubset(of: IssueFilterEvaluator.serverFields),
            "the search sheet composed \(fields(in: node)), which is not all sendable"
        )
    }

    /// And the local sheet does offer them, because they are the reason it exists.
    func testTheLocalSheetOffersProjectAndCycle() throws {
        var draft = IssueFilterDraft()
        draft.projects = ["p1"]
        draft.cycles = ["c1"]
        XCTAssertEqual(fields(in: try XCTUnwrap(draft.filter)), ["project", "cycle"])
        XCTAssertTrue(
            IssueFilterEvaluator.serverFields.isDisjoint(with: ["project", "cycle"]),
            "neither may ever be sent"
        )
    }

    // MARK: - What a collection offers

    /// Options come from the collection, which is both less plumbing and more honest: a
    /// person, label, project or cycle that appears in no row cannot narrow the list, and
    /// offering it is a chip that empties the screen.
    func testOptionsAreDerivedFromTheCollection() {
        let ada = FixtureData.users[0]
        let project = ProjectRef(id: "p1", name: "Alpha", color: "#f00", icon: nil)
        let options = IssueFilterOptions(from: [
            issue("1", priority: .urgent, assignee: ada, project: project),
            issue("2", priority: .urgent),
            issue("3", assignee: ada, labels: [FixtureData.labels[0]]),
        ])
        XCTAssertEqual(options.people.map(\.id), [ada.id], "one person, not one per row")
        XCTAssertEqual(options.projects.map(\.id), ["p1"])
        XCTAssertEqual(options.labels.map(\.id), [FixtureData.labels[0].id])
        XCTAssertEqual(options.priorities, [.none, .urgent])
        XCTAssertTrue(options.hasUnassigned)
        XCTAssertTrue(options.hasUnfiled)
        XCTAssertTrue(options.cycles.isEmpty, "no cycle in the list, so no cycle section")
        XCTAssertTrue(options.offersLocalFields)
    }

    /// A list with everybody assigned offers no "Unassigned" chip, for the same reason.
    func testNoUnassignedChipWhenEverythingIsAssigned() {
        let options = IssueFilterOptions(from: [
            issue("1", assignee: FixtureData.users[0]),
            issue("2", assignee: FixtureData.users[1]),
        ])
        XCTAssertFalse(options.hasUnassigned)
        XCTAssertEqual(options.people.count, 2)
    }

    /// Status categories keep the workspace's lifecycle order rather than an alphabetical
    /// one, which would scatter it: Backlog, Canceled, Done, In progress…
    func testCategoriesStayInLifecycleOrder() {
        let states = FixtureData.states
        let done = states.first { $0.category == .completed }!
        let doing = states.first { $0.category == .started }!
        let backlog = states.first { $0.category == .backlog }!
        let options = IssueFilterOptions(from: [
            issue("1", state: done),
            issue("2", state: doing),
            issue("3", state: backlog),
        ])
        XCTAssertEqual(options.categories, [.backlog, .started, .completed])
    }

    // MARK: - End to end, over a complete collection

    /// The whole point: chips in, the right rows out, exactly — because the collection is
    /// complete.
    func testTheDraftNarrowsACompleteCollectionExactly() {
        let ada = FixtureData.users[0]
        let project = ProjectRef(id: "p1", name: "Alpha", color: "#f00", icon: nil)
        let list = [
            issue("1", priority: .urgent, assignee: ada, project: project),
            issue("2", priority: .urgent, assignee: FixtureData.users[1], project: project),
            issue("3", priority: .low, assignee: ada),
            issue("4", priority: .urgent),
        ]
        var draft = IssueFilterDraft()
        draft.priorities = [Priority.urgent.rawValue]
        XCTAssertEqual(draft.apply(to: list).map(\.id), ["1", "2", "4"])

        draft.assignees = [ada.id]
        XCTAssertEqual(draft.apply(to: list).map(\.id), ["1"])

        draft.assignees = []
        draft.unassigned = true
        XCTAssertEqual(draft.apply(to: list).map(\.id), ["4"])

        draft = IssueFilterDraft()
        draft.projects = [project.id]
        XCTAssertEqual(draft.apply(to: list).map(\.id), ["1", "2"])

        draft = IssueFilterDraft()
        draft.noProject = true
        XCTAssertEqual(draft.apply(to: list).map(\.id), ["3", "4"])
    }

    /// The order the list arrived in survives the filter. Ordering is a display option, and
    /// a filter that also re-ordered would make a change to one look like a bug in the other.
    func testFilteringKeepsTheOrderTheListArrivedIn() {
        let ada = FixtureData.users[0]
        let list = (1...6).map { index in
            issue("\(index)", assignee: index.isMultiple(of: 2) ? ada : nil)
        }
        var draft = IssueFilterDraft()
        draft.assignees = [ada.id]
        XCTAssertEqual(draft.apply(to: list).map(\.id), ["2", "4", "6"])
    }
}
