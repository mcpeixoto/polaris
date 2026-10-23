import Foundation
import Testing

@testable import PolarisCore

/// `schema/filter-conformance.json`, run against `IssueFilterEvaluator`.
///
/// The fixture holds a small workspace, a list of filters and the ids each must return. The
/// Go suite inserts that workspace into Postgres and runs its compiled SQL; the TypeScript
/// suite loads it into the web client's replica and runs its evaluator. Neither computes the
/// expected answer — it is recorded in the file — "so a change that makes both
/// implementations agree on something wrong still fails".
///
/// This makes Swift a third *conformant* implementation rather than a third opinion. Two
/// things about how it does that, because without either one the file would be decoration:
///
/// * The fixture is located from `#filePath` and its absence is a **failure**, not a skip. It
///   lives outside the SwiftPM package, two directories above it, so it cannot be a package
///   resource — and a suite that quietly passed when the file moved would be worse than no
///   suite at all.
/// * Fields this client cannot answer are skipped against a **named list** with an
///   **asserted count**. A field that stops being answered must fail this test rather than
///   grow that list silently.
@Suite("Filter conformance")
struct FilterConformanceTests {
    // MARK: - Locating the fixture

    /// Five components up from this file: `PolarisCoreTests`, `Tests`, `PolarisCore`, `ios`,
    /// and then the repository root. `ParityWireTests` reads `schema/schema.graphql` the same
    /// way, for the same reason: the schema directory is the contract, and copying a snapshot
    /// of it into the package would be a copy that goes stale without saying so.
    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appending(path: "schema/filter-conformance.json")

    static let fixture: Fixture = {
        guard let data = try? Data(contentsOf: fixtureURL) else {
            // Loud on purpose. A `withKnownIssue` or an early `return` here would turn a
            // moved fixture into a green run, which is the one outcome this suite must not
            // be able to produce.
            fatalError(
                "schema/filter-conformance.json not found at \(fixtureURL.path). "
                    + "It is the contract three implementations are pinned to; if it moved, "
                    + "fix this path rather than skipping the suite."
            )
        }
        do {
            return try JSONDecoder().decode(Fixture.self, from: data)
        } catch {
            fatalError("schema/filter-conformance.json does not decode: \(error)")
        }
    }()

    // MARK: - The fields this client cannot answer

    /// Named, counted, and deliberately written out here rather than read from
    /// `IssueFilterEvaluator.offDeviceFields`.
    ///
    /// Reading it from the evaluator would make this assertion tautological: a field dropped
    /// from `answerableFields` would move into the other set and the test would still pass.
    /// Spelled out, the same change fails here — which is the point.
    ///
    /// Every one of them is a column `IssueFields` does not select. There is no `archivedAt`,
    /// `deletedAt`, `completedAt`, `templateId` or `recurringIssueId` on this client's
    /// `Issue`; subscribers and the two ends of a `blocks` relation are not on a list row; and
    /// the phone has no customer data at all. `completedAt` is the one that looks answerable —
    /// `state.category == .completed` is right there — and is not: a category is not a
    /// timestamp, so `completedAt gte -7d` would need an answer this client cannot give, and
    /// answering only `isNull` would be a grammar that means something different here.
    static let unanswerableFields: Set<String> = [
        "archived",
        "blockedBy",
        "blocking",
        "completedAt",
        "customer",
        "customerCount",
        "customerImportant",
        "customerRevenue",
        "customerSize",
        "customerStatus",
        "customerTier",
        "deleted",
        "recurring",
        "subscriber",
        "template",
    ]

    /// How many of the fixture's cases those fields account for.
    ///
    /// Asserted, so that a new case on an unanswerable field is a decision somebody makes
    /// rather than a silent subtraction. A new case on a field this client *does* answer
    /// raises the count that runs and leaves this one alone.
    static let expectedSkippedCases = 21

    // MARK: - Decoding the fixture

    struct Fixture: Decodable, Sendable {
        let evaluatedAt: String
        let timezone: String
        let relativeTokens: [String: TokenEntry]
        let users: [FixtureUser]
        let teams: [FixtureTeam]
        let workflowStates: [FixtureState]
        let labels: [FixtureLabel]
        let issues: [FixtureIssue]
        let cases: [Case]
        let errors: [ErrorCase]
    }

    /// The token table carries a `$comment` whose value is an array of lines, beside the
    /// tokens themselves, whose values are instants. One type that reads either.
    enum TokenEntry: Decodable, Sendable {
        case instant(String)
        case comment

        init(from decoder: any Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let value = try? container.decode(String.self) {
                self = .instant(value)
            } else {
                self = .comment
            }
        }

        var instant: String? {
            if case .instant(let value) = self { return value }
            return nil
        }
    }

    struct FixtureUser: Decodable, Sendable {
        let id: String
        let name: String
    }

    struct FixtureTeam: Decodable, Sendable {
        let id: String
        let key: String
        let name: String
    }

    struct FixtureState: Decodable, Sendable {
        let id: String
        let teamId: String
        let name: String
        let category: String
        let position: String
    }

    struct FixtureLabel: Decodable, Sendable {
        let id: String
        let name: String
        let color: String
        let parentId: String?
        let isGroup: Bool?
    }

    struct FixtureIssue: Decodable, Sendable {
        let id: String
        let teamId: String
        let number: Int
        let title: String
        let description: String
        let stateId: String
        let assigneeId: String?
        let creatorId: String?
        let priority: Int
        let estimate: Int?
        let dueDate: String?
        let parentId: String?
        let labelIds: [String]
        let archivedAt: String?
        let deletedAt: String?
        let createdAt: String
        let updatedAt: String
    }

    struct Case: Decodable, Sendable {
        let name: String
        let filter: JSONValue
        let expect: [String]
    }

    struct ErrorCase: Decodable, Sendable {
        let name: String
        let filter: JSONValue
        let message: String
    }

    // MARK: - Short names

    /// `e1` is `01900000-0000-7000-8000-0000000000e1`, and `a11` is `…-000000000a11`.
    ///
    /// "Written out in full these arrays are unreadable, and an unreadable fixture is one
    /// nobody checks when it disagrees with them. Both loaders expand the same way" — three,
    /// now.
    static func expand(_ name: String) -> String {
        let prefix = "01900000-0000-7000-8000-"
        guard (1...12).contains(name.count),
              name.allSatisfy({ $0.isHexDigit && !$0.isUppercase })
        else { return name }
        return prefix + String(repeating: "0", count: 12 - name.count) + name
    }

    /// Fields whose `values` hold ids.
    ///
    /// Type-driven rather than shape-driven, exactly as the TypeScript loader is: `"1"` is a
    /// short name by any pattern you could write, and expanding a priority into a uuid would
    /// make the fixture's simplest case fail for a reason nobody would find.
    static let idFields: Set<String> = [
        "state", "assignee", "creator", "subscriber", "label", "team", "parent", "blockedBy",
        "blocking", "template", "customer", "project", "cycle", "status", "lead",
    ]

    static func expand(filter: JSONValue) -> JSONValue {
        guard case .object(let node) = filter else { return filter }
        if case .array(let children)? = node["nodes"] {
            var copy = node
            copy["nodes"] = .array(children.map(expand(filter:)))
            return .object(copy)
        }
        guard case .string(let field)? = node["field"], idFields.contains(field),
              case .array(let values)? = node["values"]
        else { return filter }
        var copy = node
        copy["values"] = .array(values.map { value in
            if case .string(let name) = value { return .string(expand(name)) }
            return value
        })
        return .object(copy)
    }

    // MARK: - The workspace, as this client's types

    static func decoded<T: Decodable>(_ value: JSONValue) -> T {
        do {
            return try PolarisJSON.decoder().decode(T.self, from: try JSONEncoder().encode(value))
        } catch {
            fatalError("fixture row does not decode as \(T.self): \(error)")
        }
    }

    static let teams: [String: Team] = Dictionary(
        uniqueKeysWithValues: fixture.teams.map { row in
            let team: Team = decoded(.object([
                "id": .string(row.id),
                "key": .string(row.key),
                "name": .string(row.name),
                "icon": .null,
                "color": .null,
                "triageEnabled": .bool(true),
                "cyclesEnabled": .bool(true),
            ]))
            return (row.id, team)
        }
    )

    static let users: [String: User] = Dictionary(
        uniqueKeysWithValues: fixture.users.map { row in
            let user: User = decoded(.object([
                "id": .string(row.id),
                "name": .string(row.name),
                "displayName": .string(row.name),
                "avatarUrl": .null,
                "email": .null,
            ]))
            return (row.id, user)
        }
    )

    static let labels: [String: PolarisCore.Label] = Dictionary(
        uniqueKeysWithValues: fixture.labels.map { row in
            let label: PolarisCore.Label = decoded(.object([
                "id": .string(row.id),
                "name": .string(row.name),
                "color": .string(row.color),
                "teamId": .null,
                "parentId": row.parentId.map(JSONValue.string) ?? .null,
                "isGroup": .bool(row.isGroup ?? false),
            ]))
            return (row.id, label)
        }
    )

    static let states: [String: WorkflowState] = Dictionary(
        uniqueKeysWithValues: fixture.workflowStates.map { row in
            // The fixture spells a category the way the *grammar* does, in lowercase; the
            // schema enum this client decodes is SCREAMING_CASE. Mapped here rather than in
            // the evaluator so a category the fixture grows is a decode failure with a name
            // in it, not a row that quietly reads as `.backlog`.
            let category = StateCategory(rawValue: row.category.uppercased())
            precondition(category != nil, "unknown state category \(row.category)")
            return (
                row.id,
                WorkflowState(
                    id: row.id,
                    name: row.name,
                    color: "#888888",
                    category: category ?? .backlog,
                    position: row.position
                )
            )
        }
    )

    /// The fixture's issues as this client holds them — **without** the archived and the
    /// soft-deleted ones.
    ///
    /// Not a shortcut, and not where the archived/deleted default is implemented. It is what
    /// the collection *is*: `ListIssuesForTeam` selects
    /// `WHERE team_id = $1 AND archived_at IS NULL AND deleted_at IS NULL`, so no list this
    /// client receives has ever contained either, and `Issue` has no column to hold the flag
    /// if it did. Every case in the fixture that does not mention `archived` or `deleted`
    /// expects exactly this set, and the two that do mention them are skipped above — the
    /// phone cannot turn a default off for rows it was never sent.
    static let issues: [PolarisCore.Issue] = fixture.issues
        .filter { $0.archivedAt == nil && $0.deletedAt == nil }
        .map { row in
            PolarisCore.Issue(
                id: row.id,
                identifier: "\(teams[row.teamId]?.key ?? "?")-\(row.number)",
                title: row.title,
                description: row.description,
                priority: Priority(rawValue: row.priority) ?? .none,
                estimate: row.estimate,
                dueDate: row.dueDate,
                state: states[row.stateId] ?? states.values.first!,
                team: teams[row.teamId] ?? teams.values.first!,
                assignee: row.assigneeId.flatMap { users[$0] },
                creator: row.creatorId.flatMap { users[$0] },
                labels: row.labelIds.compactMap { labels[$0] },
                parentId: row.parentId,
                createdAt: PolarisJSON.parseRFC3339(row.createdAt) ?? .distantPast,
                updatedAt: PolarisJSON.parseRFC3339(row.updatedAt) ?? .distantPast
            )
        }

    static let context = IssueFilterEvaluator.Context(
        now: PolarisJSON.parseRFC3339(fixture.evaluatedAt) ?? .distantPast,
        timeZone: TimeZone(identifier: fixture.timezone) ?? .gmt
    )

    /// Every field a filter names, so a case can be matched against the unanswerable list
    /// before it is run.
    static func fields(in filter: JSONValue) -> Set<String> {
        guard case .object(let node) = filter else { return [] }
        if case .string(let field)? = node["field"] { return [field] }
        guard case .array(let children)? = node["nodes"] else { return [] }
        return children.reduce(into: Set<String>()) { $0.formUnion(fields(in: $1)) }
    }

    // MARK: - The suite

    @Test("the fixture the Go and TypeScript suites run is on disk and loaded")
    func loadedFixture() {
        #expect(FileManager.default.fileExists(atPath: Self.fixtureURL.path))
        #expect(Self.fixture.cases.count >= 62)
        #expect(Self.fixture.errors.count >= 11)
        // Eight rows, two of which this client is never sent — see `issues`.
        #expect(Self.fixture.issues.count == 8)
        #expect(Self.issues.count == 6)
        #expect(Self.context.timeZone.identifier == "Europe/Lisbon")
    }

    /// The skip list, as a list, counted.
    ///
    /// Three assertions rather than one, because they fail for three different reasons: a
    /// field dropped from the evaluator widens the first, a field answered for the first time
    /// narrows it, and a new fixture case on an unanswerable field moves the count.
    @Test("exactly the named fields are skipped, and exactly that many cases")
    func skipList() {
        var skippedFields: Set<String> = []
        var skipped = 0
        for item in Self.fixture.cases {
            let unanswerable = Self.fields(in: item.filter).intersection(Self.unanswerableFields)
            guard !unanswerable.isEmpty else { continue }
            skippedFields.formUnion(unanswerable)
            skipped += 1
        }
        #expect(skippedFields == Self.unanswerableFields)
        #expect(skipped == Self.expectedSkippedCases)
        #expect(Self.fixture.cases.count - skipped > 0)
        // And the evaluator agrees about which fields those are: a field it answers must not
        // be on the list above, and nothing on the list may be answerable.
        #expect(Self.unanswerableFields.isDisjoint(with: IssueFilterEvaluator.answerableFields))
        #expect(Self.unanswerableFields == IssueFilterEvaluator.offDeviceFields)
    }

    @Test("every case the client can answer returns the ids the fixture records", arguments: Self.answerableCases)
    func conformance(_ item: Case) throws {
        let filter = Self.expand(filter: item.filter)
        let matched = try IssueFilterEvaluator.apply(filter, to: Self.issues, context: Self.context)
        // Compared as a set, sorted. "Ordering is a display option and is tested separately —
        // mixing the two here would make an ordering change look like a filter regression."
        #expect(matched.map { $0.id }.sorted() == item.expect.map(Self.expand).sorted())
    }

    static let answerableCases: [Case] = fixture.cases.filter {
        fields(in: $0.filter).isDisjoint(with: unanswerableFields)
    }

    /// A filter on a field this client cannot answer is refused, and refused as *that* — not
    /// as an unknown field, and never by matching everything.
    @Test("a field the client cannot answer is refused, not ignored", arguments: Self.unanswerableFields.sorted())
    func offDeviceRefused(_ field: String) {
        let filter = IssueFilter.clause(field, .isNotNull)
        #expect(throws: IssueFilterEvaluator.Refusal.offDevice(field)) {
            _ = try IssueFilterEvaluator.predicate(for: filter, context: Self.context)
        }
    }

    /// The fixture's error list, which pins a fragment of each message "so the two
    /// implementations cannot drift into rejecting the same input for different stated
    /// reasons". Three, again.
    ///
    /// Two are left out, both named:
    ///
    /// * the `customerStatus` one, because that field is refused here before its value is
    ///   ever looked at — asserting it says "customer status" would be asserting a message
    ///   this client has no business producing;
    /// * the uuid one, because this client does not parse ids. See `IssueFilterEvaluator`'s
    ///   `id(_:)`: ids are opaque here by the same decision `Entities.swift` records, and a
    ///   malformed one simply matches nothing. Named rather than quietly absent, because a
    ///   silent gap in an error list is how one implementation drifts into accepting what the
    ///   others reject.
    @Test("the filters the fixture says are errors are refused, with the reason it records", arguments: Self.answerableErrors)
    func errors(_ item: ErrorCase) {
        var refusal: Error?
        do {
            _ = try IssueFilterEvaluator.predicate(
                for: Self.expand(filter: item.filter),
                context: Self.context
            )
        } catch {
            refusal = error
        }
        let thrown = refusal as? IssueFilterEvaluator.Refusal
        #expect(thrown != nil, "\(item.name) was not refused")
        #expect(
            thrown.map { String(describing: $0).contains(item.message) } == true,
            "\(item.name): \(thrown.map(String.init(describing:)) ?? "nothing") does not say \"\(item.message)\""
        )
    }

    static let answerableErrors: [ErrorCase] = fixture.errors.filter {
        fields(in: $0.filter).isDisjoint(with: unanswerableFields) && $0.message != "uuid"
    }

    @Test("exactly two of the fixture's error cases are left out, for the two stated reasons")
    func errorSkips() {
        let left = Self.fixture.errors.filter { item in
            !Self.answerableErrors.contains { $0.name == item.name }
        }
        #expect(left.count == 2)
        #expect(Set(left.map(\.message)) == ["customer status", "uuid"])
    }

    /// Every relative token, against the exact instant the fixture records.
    ///
    /// A stricter question than the cases ask, and a different one: not "do the evaluators
    /// select the same issues" but "do they resolve the same token to the same instant". With
    /// six issues a great many wrong instants still select the right rows — a resolver that
    /// treated Lisbon's offset as constant would pass every date case above and fail
    /// `startOfYear` here, which is the only midnight in the table that is also midnight in
    /// UTC.
    @Test("every relative token resolves to the instant the fixture records", arguments: Self.recordedTokens)
    func relativeTokens(_ entry: RecordedToken) throws {
        let resolved = try IssueFilterEvaluator.RelativeDate.resolve(entry.token, context: Self.context)
        #expect(resolved.instant == PolarisJSON.parseRFC3339(entry.instant))
    }

    /// A named pair rather than a tuple: `arguments:` reads a collection of two-element
    /// tuples as two parameter lists, which is not what this is.
    struct RecordedToken: Sendable, CustomStringConvertible {
        let token: String
        let instant: String
        var description: String { "\(token) is \(instant)" }
    }

    static let recordedTokens: [RecordedToken] = fixture.relativeTokens
        .compactMap { key, value in value.instant.map { RecordedToken(token: key, instant: $0) } }
        .sorted { $0.token < $1.token }

    @Test("every keyword this client accepts has an instant recorded for it")
    func everyKeywordIsPinned() {
        // Otherwise a token can be added to all three implementations and pinned by none,
        // which is the state that produced the divergence the table exists for.
        let pinned = Set(Self.recordedTokens.map { $0.token })
        for keyword in IssueFilterEvaluator.RelativeDate.keywords {
            #expect(pinned.contains(keyword), "no instant recorded for \"\(keyword)\"")
        }
    }
}

/// `project` and `cycle`: the two fields this client answers and the shared grammar does not
/// have, so the conformance fixture structurally cannot cover them.
///
/// They are why a client-side evaluator is worth having at all rather than merely cheaper:
/// `schema/schema.graphql` refuses an unknown field outright, so there is no filter a phone
/// can send that narrows a list to one project. These are the direct tests that stand in for
/// the cases the fixture cannot hold.
@Suite("Filtering by project and cycle")
struct ProjectAndCycleFilterTests {
    private static let states = FixtureData.states
    // Real uuids, because the evaluator refuses a value that is not one — the grammar says a
    // uuid field takes a uuid, and a filter that smuggled a short name past the check here
    // would be a filter `CreateView` then declines to save.
    private static let alpha = UUID().uuidString
    private static let beta = UUID().uuidString
    private static let cycleOne = UUID().uuidString
    private static let cycleTwo = UUID().uuidString

    private func issue(_ id: String, project: String? = nil, cycle: String? = nil) -> PolarisCore.Issue {
        PolarisCore.Issue(
            id: id,
            identifier: "ENG-\(id)",
            title: "Issue \(id)",
            state: Self.states[1],
            team: FixtureData.team,
            projectId: project,
            cycleId: cycle
        )
    }

    private var list: [PolarisCore.Issue] {
        [
            issue("1", project: Self.alpha, cycle: Self.cycleOne),
            issue("2", project: Self.alpha),
            issue("3", project: Self.beta, cycle: Self.cycleTwo),
            issue("4"),
        ]
    }

    private let context = IssueFilterEvaluator.Context(timeZone: .gmt)

    private func matched(_ filter: JSONValue) throws -> [String] {
        try IssueFilterEvaluator.apply(filter, to: list, context: context).map { $0.id }
    }

    @Test("project eq, which no other implementation can answer")
    func projectEq() throws {
        #expect(try matched(IssueFilter.clause("project", .eq, [Self.alpha])) == ["1", "2"])
    }

    @Test("project isNull is how a list finds the unfiled")
    func projectIsNull() throws {
        #expect(try matched(IssueFilter.clause("project", .isNull)) == ["4"])
    }

    /// The null case `neq` gets wrong everywhere it is written in SQL: `NULL <> 'alpha'` is
    /// `NULL`, so the straightforward comparison drops the unfiled issue — and somebody who
    /// asked for "everything not in Alpha" means to see it.
    @Test("project neq keeps the issues in no project at all")
    func projectNeq() throws {
        #expect(try matched(IssueFilter.clause("project", .neq, [Self.alpha])) == ["3", "4"])
    }

    @Test("project in, over two projects")
    func projectIn() throws {
        #expect(try matched(IssueFilter.clause("project", .in, [Self.alpha, Self.beta])) == ["1", "2", "3"])
    }

    @Test("an empty project in-list matches nothing, it is not a skipped clause")
    func projectInEmpty() throws {
        #expect(try matched(IssueFilter.clause("project", .in, [])).isEmpty)
    }

    @Test("cycle eq")
    func cycleEq() throws {
        #expect(try matched(IssueFilter.clause("cycle", .eq, [Self.cycleOne])) == ["1"])
    }

    @Test("cycle isNotNull")
    func cycleIsNotNull() throws {
        #expect(try matched(IssueFilter.clause("cycle", .isNotNull)) == ["1", "3"])
    }

    @Test("project and cycle compose with the rest of the grammar")
    func composed() throws {
        let filter = IssueFilter.and([
            IssueFilter.clause("project", .eq, [Self.alpha]),
            IssueFilter.clause("cycle", .isNotNull),
        ])
        #expect(try matched(filter) == ["1"])
    }

    /// The line the UI has to draw, as an assertion rather than as a comment: these two are
    /// local-only, so nothing may offer them where the filter is sent to the server.
    @Test("project and cycle are answerable locally and never sent to the server")
    func localOnly() {
        #expect(IssueFilterEvaluator.answerableFields.isSuperset(of: ["project", "cycle"]))
        #expect(IssueFilterEvaluator.serverFields.isDisjoint(with: ["project", "cycle"]))
        // And everything else the sheet can build is safe to send: a field in `serverFields`
        // that the grammar does not have would be a hard error at `CreateView` time.
        #expect(IssueFilterEvaluator.serverFields.isDisjoint(with: IssueFilterEvaluator.offDeviceFields))
    }
}

/// `IssueFilter`, the builder.
///
/// Its one rule about `values` is operator-shaped and used to be shape-shaped, which is a
/// difference you only see from an empty list.
@Suite("The filter builder")
struct IssueFilterBuilderTests {
    private func keys(_ node: JSONValue) -> [String: JSONValue] {
        guard case .object(let fields) = node else { return [:] }
        return fields
    }

    /// `isNull` and `isNotNull` carry no `values` key at all — a present-but-empty array is
    /// refused by the server's validator.
    @Test("the null operators carry no values key")
    func nullOperatorsCarryNothing() {
        #expect(keys(IssueFilter.clause("assignee", .isNull))["values"] == nil)
        #expect(keys(IssueFilter.clause("assignee", .isNotNull))["values"] == nil)
    }

    /// And every other operator keeps the key even when the list is empty, because there the
    /// empty list *is* the filter: "an empty in-list matches nothing, it is not a skipped
    /// clause". Dropping the key — which is what being keyed off `values.isEmpty` did —
    /// turned that into a node the server refuses for want of values, and the evaluator for
    /// want of a list.
    @Test("an empty in-list is still an in-list")
    func emptyInListKeepsItsKey() throws {
        let node = IssueFilter.clause("priority", .in, [])
        #expect(keys(node)["values"] == .array([]))
        let context = IssueFilterEvaluator.Context(timeZone: .gmt)
        let matches = try IssueFilterEvaluator.predicate(for: node, context: context)
        let issue = PolarisCore.Issue(
            id: "i1",
            identifier: "ENG-1",
            title: "Anything",
            state: FixtureData.states[1],
            team: FixtureData.team
        )
        #expect(matches(issue) == false)
    }

    @Test("and an empty notIn-list matches everything")
    func emptyNotInListMatchesEverything() throws {
        let node = IssueFilter.clause("priority", .notIn, [])
        let context = IssueFilterEvaluator.Context(timeZone: .gmt)
        let matches = try IssueFilterEvaluator.predicate(for: node, context: context)
        let issue = PolarisCore.Issue(
            id: "i1",
            identifier: "ENG-1",
            title: "Anything",
            state: FixtureData.states[1],
            team: FixtureData.team
        )
        #expect(matches(issue))
    }
}
