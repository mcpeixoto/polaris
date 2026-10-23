import Foundation

/// The filter grammar from `docs/03-architecture/06-filter-grammar.md`, evaluated on the
/// phone against the list it is already holding.
///
/// This is the third implementation of that grammar — `internal/filter` compiles it to SQL,
/// `web/src/filter` evaluates it against the web client's replica — and the point of a third
/// one is that the first two are both out of reach here:
///
/// * `search` returns nothing at all for a query with no searchable words, because
///   `services/internal/domain/search.go` gives up on an empty tsquery *before* it reads
///   `SearchInput.filter`. So "assigned to me, priority urgent" with no words typed is a
///   filter the server answers with an empty list.
/// * The grammar has no `project` and no `cycle` field, and an unknown field is a hard
///   error server-side. Those two are exactly what a phone looking at a project or a cycle
///   wants to narrow by.
///
/// Running locally is not a compromise in return. `issues(teamId:)` is a whole-collection
/// query with no pagination — see `GraphQLDocuments.teamIssues` — so a team list, My Issues,
/// a project and a cycle each hold *every* issue in scope. A filter over that list is exact,
/// and the count it produces can be stated plainly.
///
/// **Search is the exception, and the caller must respect it.** `search` caps its answer at
/// `PageSize.search` rows, so the forty issues on screen are not the matches — they are the
/// first forty. Filtering those locally would quietly turn "40 of 400" into a number about
/// nothing. A filter on search goes to the server as `filter:` instead.
///
/// ## Walking `JSONValue` rather than a decoded AST
///
/// `IssueFilter` is a *builder*: it produces `JSONValue` nodes, and the same bytes are what a
/// saved view holds and what `SearchInput.filter` carries. There is deliberately no decoded
/// `FilterNode` type in between. A decoded AST would be a second spelling of the grammar in
/// this client — one more place for `stateCategory` to be mis-typed — for no gain, because
/// nothing here needs to hold a filter in a form other than the one it is stored and sent in.
/// What the structure does buy is paid for once: `predicate(for:context:)` compiles the tree
/// to a closure, so a list of five hundred rows reads the filter once rather than once a row.
public enum IssueFilterEvaluator {
    /// The clock and the calendar a filter is resolved against.
    ///
    /// Injected rather than ambient, for the reason `web/src/filter/relative.ts` says: a
    /// filter whose answer depends on `Date()` cannot be tested at a boundary, only waited
    /// for — and `schema/filter-conformance.json` pins a fixed clock.
    public struct Context: Sendable, Hashable {
        public var now: Date
        /// The zone the workspace's days are measured in. A due date and "today" are calendar
        /// facts, not instants: measured in the wrong zone they are out by up to a day, which
        /// is a missed deadline rather than a rounding error.
        public var timeZone: TimeZone

        public init(now: Date = Date(), timeZone: TimeZone = .current) {
            self.now = now
            self.timeZone = timeZone
        }
    }

    /// Why a filter was refused.
    ///
    /// Refused, never ignored. "An unknown field is a hard error, not an ignored clause.
    /// Ignoring it would silently widen the result set, and a filter that silently matches
    /// more than it says is exactly the class of bug that makes people stop trusting a
    /// filter."
    ///
    /// `offDevice` is the one case that is not a mistake: the field is in the grammar and this
    /// client's `Issue` cannot answer it — `completedAt`, `subscriber`, every `customer*`.
    /// Kept apart from `unknownField` because the two want opposite handling. A typo must
    /// reach a developer; a field the phone has no column for is a filter that belongs on the
    /// server, and the conformance suite skips exactly these against a named list.
    public enum Refusal: Error, Equatable, Sendable, CustomStringConvertible {
        case notANode(String)
        case badConjunction(String)
        case unknownField(String)
        case projectField(String)
        case offDevice(String)
        case badOperator(field: String, op: String)
        case badValues(op: String, detail: String)
        case notANumber(String)
        case notACategory(String)
        case notADate(String)
        case notATimestamp(String)

        public var description: String {
            switch self {
            case .notANode(let keys):
                return "a node is either a clause or a group, and this is neither (\(keys))"
            case .badConjunction(let conj):
                return "\"\(conj)\" is not a conjunction"
            case .unknownField(let field):
                return "unknown field \"\(field)\""
            case .projectField(let field):
                return "field \"\(field)\" does not apply to issues"
            case .offDevice(let field):
                return "field \"\(field)\" is in the grammar but this client's issue cannot answer it"
            case .badOperator(let field, let op):
                return "operator \"\(op)\" does not apply to \(field)"
            case .badValues(let op, let detail):
                return "\"\(op)\" \(detail)"
            case .notANumber(let value):
                return "\"\(value)\" is not a number"
            case .notACategory(let value):
                return "\"\(value)\" is not a state category"
            case .notADate(let value):
                return "\"\(value)\" is not a date"
            case .notATimestamp(let value):
                return "\"\(value)\" is not a timestamp"
            }
        }
    }

    /// Fields this evaluator answers off an `Issue`.
    ///
    /// `project` and `cycle` are in here and *not* in the grammar: they read `projectId` and
    /// `cycleId`, which every issue already carries, and they are the two narrowings a phone
    /// wants most on the screens that have them. A clause on either is therefore local-only —
    /// it must never be sent as `SearchInput.filter`, where it is a hard error. `FilterSheet`
    /// is the gate for that, through its `fields` list.
    public static let answerableFields: Set<String> = [
        "state", "stateCategory", "assignee", "creator", "team", "parent", "project", "cycle",
        "title", "description", "priority", "estimate", "dueDate", "createdAt", "updatedAt",
        "label",
    ]

    /// Grammar fields this client's `Issue` has no column for.
    ///
    /// `IssueFields` selects none of them: no `archivedAt`, `deletedAt`, `completedAt`,
    /// `templateId` or `recurringIssueId`, no subscriber or relation sets, and no customer
    /// data at all. A clause on one of these is a `Refusal.offDevice` rather than a guess —
    /// deriving `completedAt isNotNull` from `state.category == .completed`, say, would be
    /// this client's own opinion dressed as the shared grammar.
    public static let offDeviceFields: Set<String> = [
        "archived", "blockedBy", "blocking", "completedAt", "customer", "customerCount",
        "customerImportant", "customerRevenue", "customerSize", "customerStatus",
        "customerTier", "deleted", "recurring", "subscriber", "template",
    ]

    /// The subset of `answerableFields` that may be sent to the server as `SearchInput.filter`.
    ///
    /// `project` and `cycle` are missing, and that is the whole point: they are not in the
    /// grammar, and `schema/schema.graphql` is explicit that "the compiler validates at the
    /// boundary and rejects anything it does not recognise". A sheet that offered them on
    /// search would build a filter the server answers with an error.
    public static let serverFields: Set<String> = answerableFields.subtracting(["project", "cycle"])

    /// Fields that only apply to a project filter. Named so that one on an issue filter is
    /// refused with the grammar's own words rather than as an unknown field.
    public static let projectOnlyFields: Set<String> = [
        "status", "statusCategory", "lead", "startDate", "targetDate", "name",
    ]

    /// The state categories the grammar spells, in its own lowercase. `StateCategory`'s raw
    /// values are the schema enum's SCREAMING_CASE, so the two are folded at the boundary.
    static let categories: Set<String> = [
        "triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate",
    ]

    // MARK: - Entry points

    /// The issues a filter matches, in the order they arrived.
    ///
    /// Ordering is a display option and is applied separately by `IssueSectioning`; mixing
    /// the two here would make a change to a sort look like a filter regression.
    public static func apply(
        _ filter: JSONValue,
        to issues: [Issue],
        context: Context
    ) throws -> [Issue] {
        let matches = try predicate(for: filter, context: context)
        return issues.filter(matches)
    }

    /// Compiles a filter to a predicate, defaults and all.
    ///
    /// Two whole-filter defaults, applied here once over the entire tree rather than inside
    /// each group. That placement is the rule and not an implementation detail: a clause
    /// anywhere in the filter turns its default off for the *whole query*, because scoping it
    /// per group would let an `or` resurrect rows into a view that never asked for them.
    ///
    /// * **Triage** is hidden unless the filter names `state` or `stateCategory`. This one
    ///   bites on the phone: `issues(teamId:)` returns triage rows, which is why
    ///   `TeamWorkStore.triage` can exist at all.
    /// * **Archived and deleted** are excluded — and here there is nothing to do, because
    ///   `ListIssuesForTeam` already filters `archived_at IS NULL AND deleted_at IS NULL`, so
    ///   no collection this client holds contains one. That is also why a clause on either is
    ///   `Refusal.offDevice`: the phone cannot turn the default off, so it says so rather than
    ///   answering "no archived issues" to a question about archived issues.
    public static func predicate(
        for filter: JSONValue,
        context: Context
    ) throws -> @Sendable (Issue) -> Bool {
        var mentioned: Set<String> = []
        collectFields(filter, into: &mentioned)

        let body = try compile(filter, context)
        guard !mentioned.contains("state") && !mentioned.contains("stateCategory") else {
            return body
        }
        // The gate goes first, so a list full of unreviewed intake stops before the clauses
        // read anything.
        return { issue in issue.state.category != .triage && body(issue) }
    }

    /// Whether a filter asks for anything at all.
    ///
    /// `{}` and `{"conj":"and","nodes":[]}` both match everything — "an AND over nothing is
    /// vacuously true" — so a caller can skip the whole evaluation, and a screen can tell
    /// whether to show its filter as on.
    public static func isEmpty(_ filter: JSONValue) -> Bool {
        switch filter {
        case .object(let node):
            if node["field"] != nil { return false }
            guard case .array(let nodes)? = node["nodes"] else { return node.isEmpty }
            return nodes.allSatisfy(isEmpty)
        default:
            return false
        }
    }

    // MARK: - Walking the tree

    /// Gathers the field names a filter mentions, for the whole-filter defaults.
    ///
    /// Deliberately tolerant: a shape this does not recognise is left to `compile`, which
    /// visits every node and is the one place that refuses. Two lenient passes beat one pass
    /// that has to both collect and validate, and no node escapes the second.
    private static func collectFields(_ node: JSONValue, into found: inout Set<String>) {
        guard case .object(let fields) = node else { return }
        if case .string(let field)? = fields["field"] {
            found.insert(field)
            return
        }
        guard case .array(let children)? = fields["nodes"] else { return }
        for child in children { collectFields(child, into: &found) }
    }

    private static func compile(
        _ node: JSONValue,
        _ context: Context
    ) throws -> @Sendable (Issue) -> Bool {
        guard case .object(let fields) = node else {
            throw Refusal.notANode("not an object")
        }
        if fields["field"] != nil {
            return try compileClause(fields, context)
        }
        // The canonical empty. `{}` is the column default and means the same as an explicit
        // empty `and`; refusing it would make a freshly created view unopenable.
        if fields.isEmpty {
            return { _ in true }
        }
        guard fields["nodes"] != nil || fields["conj"] != nil else {
            throw Refusal.notANode(fields.keys.sorted().joined(separator: ", "))
        }
        let conj: String
        switch fields["conj"] {
        case .string(let value): conj = value
        case nil: conj = "and"
        default: throw Refusal.badConjunction("not a string")
        }
        guard conj == "and" || conj == "or" else { throw Refusal.badConjunction(conj) }

        var children: [JSONValue] = []
        if let nodes = fields["nodes"] {
            guard case .array(let list) = nodes else { throw Refusal.notANode("nodes is not an array") }
            children = list
        }
        let parts = try children.map { try compile($0, context) }
        if conj == "or" {
            // An OR over nothing is vacuously false, by the same arithmetic that makes an AND
            // over nothing true.
            return { issue in parts.contains { $0(issue) } }
        }
        return { issue in parts.allSatisfy { $0(issue) } }
    }

    // MARK: - Clauses

    /// A clause, read out of its object once. The only decoded shape in here — see the type's
    /// note on walking `JSONValue`: a clause is three keys, and reading them per row is the
    /// cost `predicate(for:context:)` exists to pay once.
    private struct Clause {
        let field: String
        let op: String
        /// Nil means the key was absent, which is not the same as an empty array: `isNull`
        /// must carry no `values` at all, and `in` with an empty list matches nothing.
        let values: [String]?
    }

    private static func compileClause(
        _ fields: [String: JSONValue],
        _ context: Context
    ) throws -> @Sendable (Issue) -> Bool {
        guard case .string(let field)? = fields["field"] else {
            throw Refusal.notANode("field is not a string")
        }
        guard case .string(let op)? = fields["op"] else {
            throw Refusal.badOperator(field: field, op: "missing")
        }
        var values: [String]? = nil
        if let raw = fields["values"] {
            guard case .array(let list) = raw else {
                throw Refusal.badValues(op: op, detail: "needs values as a list")
            }
            values = try list.map { entry in
                // Written as strings on the wire, every type of them — `"1"` for a priority,
                // `"true"` for a flag. An int or a bool that slipped through is read rather
                // than refused: the grammar's own examples are stringly typed and a stricter
                // reading here would refuse a filter the server accepts.
                switch entry {
                case .string(let value): return value
                case .int(let value): return String(value)
                case .bool(let value): return String(value)
                case .double(let value): return String(value)
                default: throw Refusal.badValues(op: op, detail: "needs string values")
                }
            }
        }
        let clause = Clause(field: field, op: op, values: values)

        if offDeviceFields.contains(field) { throw Refusal.offDevice(field) }
        if projectOnlyFields.contains(field) { throw Refusal.projectField(field) }

        switch field {
        // An id is compared, never parsed — see `id(_:)`.
        case "state":
            return try equality(clause, id, { $0.state.id })
        case "assignee":
            return try equality(clause, id, { $0.assignee?.id })
        case "creator":
            return try equality(clause, id, { $0.creator?.id })
        case "team":
            return try equality(clause, id, { $0.team.id })
        case "parent":
            return try equality(clause, id, { $0.parentId })
        case "project":
            return try equality(clause, id, { $0.projectId })
        case "cycle":
            return try equality(clause, id, { $0.cycleId })

        case "stateCategory":
            // Folded to the grammar's lowercase, not compared against `StateCategory`'s raw
            // value: the schema spells the enum `UNSTARTED` and the grammar spells it
            // `unstarted`, and the filter is the grammar's.
            return try equality(clause, category, { $0.state.category.rawValue.lowercased() })

        case "title":
            return try text(clause, { $0.title })
        case "description":
            return try text(clause, { $0.description })

        case "priority":
            return try ordered(clause, number, { $0.priority.rawValue })
        case "estimate":
            // Absent is unestimated, which is not zero: `estimate lt 3` must not sweep up
            // every issue nobody has sized yet.
            return try ordered(clause, number, { $0.estimate })

        case "dueDate":
            // Compared as `2006-01-02` strings, which sort as dates for free. A due date is a
            // day in the team's calendar and not an instant; turning it into one moves it a
            // day for everybody west of whoever set it.
            return try ordered(clause, { try day($0, context) }, { $0.dueDate })

        case "createdAt":
            return try ordered(clause, { try instant($0, context) }, { $0.createdAt })
        case "updatedAt":
            return try ordered(clause, { try instant($0, context) }, { $0.updatedAt })

        case "label":
            // Multi-valued: an issue matches if *any* of its labels matches.
            return try membership(clause, { Set($0.labels.map(\.id)) })

        default:
            throw Refusal.unknownField(field)
        }
    }

    // MARK: - Operators

    /// Equality and set membership over a single-valued field.
    ///
    /// `neq` and `notIn` deliberately keep the rows with no value. SQL's three-valued logic
    /// drops them — `NULL <> 'ada'` is `NULL` — and somebody who asked for "everything not
    /// assigned to Ada" does not get the unassigned ones, which is the opposite of what the
    /// words mean.
    private static func equality<T: Hashable & Sendable>(
        _ clause: Clause,
        _ parse: (String) throws -> T,
        _ read: @escaping @Sendable (Issue) -> T?
    ) throws -> @Sendable (Issue) -> Bool {
        switch clause.op {
        case "isNull":
            try expectNoValues(clause)
            return { read($0) == nil }
        case "isNotNull":
            try expectNoValues(clause)
            return { read($0) != nil }
        case "eq":
            let wanted = try parse(try expectOne(clause))
            return { read($0) == wanted }
        case "neq":
            let wanted = try parse(try expectOne(clause))
            return { value in
                guard let held = read(value) else { return true }
                return held != wanted
            }
        case "in":
            // An empty in-list matches nothing. The obvious SQL for it is a syntax error and
            // the obvious fix is to skip the clause, which turns "assigned to nobody in this
            // list" into "no filter at all".
            let wanted = Set(try expectList(clause).map(parse))
            if wanted.isEmpty { return { _ in false } }
            return { value in
                guard let held = read(value) else { return false }
                return wanted.contains(held)
            }
        case "notIn":
            // And an empty notIn-list matches everything, by the same set semantics.
            let wanted = Set(try expectList(clause).map(parse))
            if wanted.isEmpty { return { _ in true } }
            return { value in
                guard let held = read(value) else { return true }
                return !wanted.contains(held)
            }
        default:
            throw Refusal.badOperator(field: clause.field, op: clause.op)
        }
    }

    /// Everything equality does, plus the ordering comparisons. A null orders against nothing.
    private static func ordered<T: Comparable & Hashable & Sendable>(
        _ clause: Clause,
        _ parse: (String) throws -> T,
        _ read: @escaping @Sendable (Issue) -> T?
    ) throws -> @Sendable (Issue) -> Bool {
        switch clause.op {
        case "gt":
            let bound = try parse(try expectOne(clause))
            return { read($0).map { $0 > bound } ?? false }
        case "gte":
            let bound = try parse(try expectOne(clause))
            return { read($0).map { $0 >= bound } ?? false }
        case "lt":
            let bound = try parse(try expectOne(clause))
            return { read($0).map { $0 < bound } ?? false }
        case "lte":
            let bound = try parse(try expectOne(clause))
            return { read($0).map { $0 <= bound } ?? false }
        default:
            return try equality(clause, parse, read)
        }
    }

    /// `contains` folds case and diacritics; `eq` does not. Exact is what somebody who typed a
    /// full title into `eq` meant.
    private static func text(
        _ clause: Clause,
        _ read: @escaping @Sendable (Issue) -> String
    ) throws -> @Sendable (Issue) -> Bool {
        guard clause.op == "contains" || clause.op == "notContains" else {
            return try equality(clause, { $0 }, { read($0) })
        }
        // Folded once here rather than per row, and folded *without* collapsing whitespace.
        // The web client's `fold` collapses runs of space and trims the ends, which is right
        // for title ordering and wrong here: it rewrites the needle, so a filter matched on
        // screen and returned nothing from the API. Somebody who types a trailing space meant
        // the trailing space — see the whitespace cases in schema/filter-conformance.json.
        let needle = fold(try expectOne(clause))
        let negated = clause.op == "notContains"
        return { issue in
            let hit = fold(read(issue)).contains(needle)
            return negated ? !hit : hit
        }
    }

    /// A multi-valued field — on this client, labels and nothing else.
    ///
    /// `notIn` means "has none of these", not "has some label that is not one of these". Every
    /// issue with two labels matches the second reading and almost none of them are what was
    /// asked for.
    private static func membership(
        _ clause: Clause,
        _ read: @escaping @Sendable (Issue) -> Set<String>
    ) throws -> @Sendable (Issue) -> Bool {
        switch clause.op {
        case "eq":
            let wanted = try expectOne(clause)
            return { read($0).contains(wanted) }
        case "neq":
            let wanted = try expectOne(clause)
            return { !read($0).contains(wanted) }
        case "in":
            let wanted = Set(try expectList(clause))
            if wanted.isEmpty { return { _ in false } }
            return { !read($0).isDisjoint(with: wanted) }
        case "notIn":
            let wanted = Set(try expectList(clause))
            if wanted.isEmpty { return { _ in true } }
            return { read($0).isDisjoint(with: wanted) }
        default:
            throw Refusal.badOperator(field: clause.field, op: clause.op)
        }
    }

    // MARK: - Values

    private static func expectNoValues(_ clause: Clause) throws {
        // Present-but-empty is refused too, the way the server's validator refuses it: an
        // `isNull` that carries an array is a filter built by something that did not read the
        // grammar, and letting it through here would hide that until the view was saved.
        guard clause.values == nil else {
            throw Refusal.badValues(op: clause.op, detail: "takes no values")
        }
    }

    private static func expectOne(_ clause: Clause) throws -> String {
        guard let values = clause.values, values.count == 1 else {
            throw Refusal.badValues(op: clause.op, detail: "takes exactly one entry in values")
        }
        return values[0]
    }

    private static func expectList(_ clause: Clause) throws -> [String] {
        guard let values = clause.values else {
            throw Refusal.badValues(op: clause.op, detail: "needs a values list")
        }
        return values
    }

    /// An id, passed through rather than parsed.
    ///
    /// The server's validator refuses a value that is not a uuid, and this deliberately does
    /// not — the same decision `Entities.swift` records for every id in this client: "ids are
    /// opaque to this client, and the one thing it does with them is put them back on the
    /// wire. Parsing them into UUID would buy nothing and would make a server that ever
    /// widens the format a decoding crash." Here it would also make the bundled fixtures
    /// unfilterable, since their ids are `u1` and `lab3`.
    ///
    /// This is the one place the three implementations differ by design, and it is a
    /// difference in strictness rather than in meaning: every id this evaluator is asked
    /// about came from the same response as the issues it is comparing, so a malformed one
    /// matches nothing, which is the answer the server would also give. The conformance suite
    /// names the error case it therefore does not run.
    private static func id(_ value: String) -> String { value }

    private static func category(_ value: String) throws -> String {
        guard categories.contains(value) else { throw Refusal.notACategory(value) }
        return value
    }

    private static func number(_ value: String) throws -> Int {
        guard let parsed = Int(value) else { throw Refusal.notANumber(value) }
        return parsed
    }

    /// A calendar day: an absolute `2006-01-02`, or a relative token resolved to one.
    private static func day(_ value: String, _ context: Context) throws -> String {
        if isAbsolute(value) {
            guard Self.dayPattern(value) else { throw Refusal.notADate(value) }
            return value
        }
        return try RelativeDate.resolve(value, context: context).day
    }

    /// An instant: an absolute RFC 3339 timestamp, or a relative token resolved to one.
    private static func instant(_ value: String, _ context: Context) throws -> Date {
        if isAbsolute(value) {
            guard let parsed = Self.timestamp(value) else { throw Refusal.notATimestamp(value) }
            return parsed
        }
        return try RelativeDate.resolve(value, context: context).instant
    }

    /// Absolute values start with a digit; every relative token starts with a sign or a
    /// letter. Cheaper and more honest than re-running a pattern at compile time.
    private static func isAbsolute(_ value: String) -> Bool {
        guard let first = value.unicodeScalars.first else { return false }
        return first.value >= 48 && first.value <= 57
    }

    private static func dayPattern(_ value: String) -> Bool {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2 else {
            return false
        }
        return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }

    /// RFC 3339, with and without a fractional second — Go trims trailing zeros from the
    /// fraction, so both forms arrive from the same server. Parsed by the decoder's own
    /// reader rather than by a formatter, for the reasons `PolarisJSON.parseRFC3339` gives:
    /// a filter must not disagree with the decoder about what an instant is.
    private static func timestamp(_ value: String) -> Date? {
        PolarisJSON.parseRFC3339(value)
    }

    /// `lower(unaccent(x))`, and nothing else.
    ///
    /// The same fold as `foldExact` in `web/src/store/indexes.ts`, which is itself the
    /// restatement of the database's `search_fold`: decompose, drop the combining marks, lower.
    /// Searching `acao` finds `Ação` — somebody typing without an accent is not asking for a
    /// different issue.
    static func fold(_ text: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in text.decomposedStringWithCanonicalMapping.unicodeScalars
        where !(0x0300...0x036F).contains(scalar.value) {
            scalars.append(scalar)
        }
        return String(scalars).lowercased()
    }
}

// MARK: - Relative dates

extension IssueFilterEvaluator {
    /// Relative date tokens, resolved against the injected clock.
    ///
    /// "These are resolved at evaluation time, in the workspace's timezone, not at save time.
    /// A view called 'Updated this week' that quietly means 'the week of 4 March' because that
    /// is when it was saved is worse than useless — and it is what storing the resolved date
    /// produces."
    ///
    /// The token set is part of the contract, not an implementation detail, and
    /// `schema/filter-conformance.json` records the exact instant each one resolves to at a
    /// fixed clock. That table exists because the case list structurally cannot catch a token
    /// only one implementation has heard of — it already happened once, with five tokens the
    /// web client shipped and the server refused.
    public enum RelativeDate {
        /// Every keyword, and deliberately only tokens that name exactly one day. `endOfWeek`
        /// is absent on purpose: it has two defensible readings, and a grammar shared by three
        /// implementations cannot afford a token whose meaning each side picks for itself.
        public static let keywords = [
            "now", "today", "yesterday", "tomorrow", "startOfWeek", "startOfMonth", "startOfYear",
        ]

        /// What a token resolves to: an instant for a timestamp field, a calendar day for a
        /// date field.
        public struct Resolved: Sendable, Hashable {
            /// The start of the named day — or the clock itself, for `now`.
            public let instant: Date
            /// The same moment as a calendar day in the workspace's zone, `2006-01-02`.
            public let day: String
        }

        public static func isToken(_ value: String) -> Bool {
            keywords.contains(value) || offset(value) != nil
        }

        /// Throws on a token it does not recognise rather than defaulting to the epoch, which
        /// would turn a typo into a filter that silently matches everything.
        public static func resolve(_ token: String, context: Context) throws -> Resolved {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = context.timeZone
            calendar.locale = Locale(identifier: "en_US_POSIX")
            // Monday. The workspace has no week-start preference to read, and ISO is the
            // convention the rest of the grammar follows.
            calendar.firstWeekday = 2

            let today = calendar.startOfDay(for: context.now)
            if token == "now" {
                // The one token that names an instant rather than a day, which is what makes
                // `dueDate lt now` mean overdue. On a date field it still means today,
                // because a DATE column holds no instants.
                return Resolved(instant: context.now, day: format(today, calendar))
            }
            guard let day = self.day(token, today: today, calendar: calendar) else {
                throw Refusal.notADate(token)
            }
            // Snapped again after the arithmetic: adding a month to a start-of-day instant
            // lands on the same wall clock, and on a day the clocks moved that is not
            // midnight any more.
            let start = calendar.startOfDay(for: day)
            return Resolved(instant: start, day: format(start, calendar))
        }

        private static func day(_ token: String, today: Date, calendar: Calendar) -> Date? {
            switch token {
            case "today":
                return today
            case "yesterday":
                return calendar.date(byAdding: .day, value: -1, to: today)
            case "tomorrow":
                return calendar.date(byAdding: .day, value: 1, to: today)
            case "startOfWeek":
                let weekday = calendar.component(.weekday, from: today)
                // `weekday` is 1 for Sunday, so Monday is 2 and this is 0 on a Monday.
                return calendar.date(byAdding: .day, value: -((weekday + 5) % 7), to: today)
            case "startOfMonth":
                return calendar.date(from: calendar.dateComponents([.year, .month], from: today))
            case "startOfYear":
                return calendar.date(from: calendar.dateComponents([.year], from: today))
            default:
                break
            }
            guard let (count, unit) = offset(token) else { return nil }
            switch unit {
            case "d": return calendar.date(byAdding: .day, value: count, to: today)
            case "w": return calendar.date(byAdding: .day, value: count * 7, to: today)
            // Months clamp the day rather than rolling over: one month before 31 March is
            // 28 February, not 3 March. Years go through months for the same clamping.
            case "M": return calendar.date(byAdding: .month, value: count, to: today)
            case "y": return calendar.date(byAdding: .month, value: count * 12, to: today)
            default: return nil
            }
        }

        /// `[+-]<count><unit>`. The sign is required, because `7d` reads as both "seven days
        /// ago" and "in seven days" depending on who is reading it. `M` is months and is
        /// case-sensitive, leaving `m` free for minutes if a timestamp filter ever wants them.
        private static func offset(_ token: String) -> (count: Int, unit: Character)? {
            var characters = Array(token)
            guard characters.count >= 3, let sign = characters.first,
                  sign == "+" || sign == "-", let unit = characters.last,
                  "dwMy".contains(unit)
            else { return nil }
            characters.removeFirst()
            characters.removeLast()
            guard !characters.isEmpty, characters.allSatisfy(\.isNumber),
                  let magnitude = Int(String(characters))
            else { return nil }
            return (sign == "-" ? -magnitude : magnitude, unit)
        }

        private static func format(_ date: Date, _ calendar: Calendar) -> String {
            let parts = calendar.dateComponents([.year, .month, .day], from: date)
            return String(
                format: "%04d-%02d-%02d",
                parts.year ?? 0, parts.month ?? 0, parts.day ?? 0
            )
        }
    }
}
