import Foundation

/// `2026-09-30` as midnight of that day in a given calendar.
///
/// In Core rather than beside the row that renders a due date, because both the row and the
/// sectioning below have to agree about what "overdue" means. Two parsers would eventually
/// disagree about `2026-02-30`, and the list would then put an issue in a bucket the row it
/// contains denies.
public enum CalendarDay {
    /// Nil for anything that is not a calendar day, so a malformed value is treated as no date
    /// rather than as a lie about when something is due.
    public static func parse(_ value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              (1...12).contains(month), (1...31).contains(day)
        else { return nil }
        var components = DateComponents()
        components.calendar = calendar
        components.year = year
        components.month = month
        components.day = day
        guard let date = components.date, components.isValidDate(in: calendar) else { return nil }
        return calendar.startOfDay(for: date)
    }
}

/// A list of issues cut into sections, by whichever of the display schema's nine groupings is
/// asked for and in whichever of its seven orderings.
///
/// One pure function, in Core and not in a view, for two reasons. The sectioning is the part of
/// a list that is worth asserting about — nine groupings times seven orderings is more cases
/// than anybody will click through — and it has to be the same answer on a phone, an iPad and
/// in a saved view. The workspace reference data it cannot reach from here arrives as closures
/// in a `Context`, which is what keeps Core free of `WorkspaceDataStore`.
///
/// Three rules survive from the status-only grouping that came before, and each exists because
/// its absence was visible:
///
/// - **An empty group is not a group; it is not emitted.** A heading with nothing under it is a
///   row of furniture claiming there is work where there is none.
/// - **A nil group is a named section, not a disappearance.** Unassigned issues group under
///   "No assignee"; they do not fall out of the list.
/// - **Every ordering is total, ending on `identifier`.** `sorted(by:)` is not stable, so rows
///   sharing every sort key swap places on each re-sort — after a create, after a status change
///   — and the list looks like it is shuffling itself. `IssueOrder.sorted` ends the same way for
///   the same reason.
public enum IssueSectioning {
    /// The workspace reference data the sectioning cannot reach on its own.
    ///
    /// Only the workflow states need resolving: a team's states carry the order the workspace
    /// put them in, and nothing on an `Issue` knows it. Assignee, team, labels and the parent's
    /// one-line form all arrive on the issue itself, so a resolver for them would be a closure
    /// every call site had to supply and nothing would ever call.
    ///
    /// Not `Sendable`: `statesFor` is the view's own `{ model.workspaceData.states(forTeam:) }`,
    /// which reads main-actor state. Sectioning runs where the list is drawn.
    public struct Context {
        public var statesFor: (Issue) -> [WorkflowState]
        /// Which day "today" is, for the due-date buckets. A parameter rather than `Date()` so
        /// the buckets assert the same at midnight as at noon.
        public var today: Date
        public var calendar: Calendar

        public init(
            statesFor: @escaping (Issue) -> [WorkflowState] = { _ in [] },
            today: Date = Date(),
            calendar: Calendar = .current
        ) {
            self.statesFor = statesFor
            self.today = today
            self.calendar = calendar
        }
    }

    /// Where a due date falls relative to today. Coarser than a date because a heading per day
    /// is a list of headings; "this week" is the question somebody scanning due dates is asking.
    public enum DueBucket: String, Sendable, Hashable, CaseIterable {
        case overdue, today, tomorrow, thisWeek, nextWeek, later, none

        /// Untranslated, for an accessibility identifier and for a `GroupKey`'s stable name.
        /// What a reader sees is built in the view layer, where the string catalogue is.
        public var name: String {
            switch self {
            case .overdue: "Overdue"
            case .today: "Today"
            case .tomorrow: "Tomorrow"
            case .thisWeek: "This week"
            case .nextWeek: "Next week"
            case .later: "Later"
            case .none: "No due date"
            }
        }

        var rank: Int {
            switch self {
            case .overdue: 0
            case .today: 1
            case .tomorrow: 2
            case .thisWeek: 3
            case .nextWeek: 4
            case .later: 5
            case .none: 6
            }
        }
    }

    /// What a section is a section of.
    ///
    /// `label` and `parent` are optional where the schema's sketch is not, because both can be
    /// absent on an issue and the nil-is-a-named-section rule applies to them as much as to an
    /// assignee. `parent` carries an `IssueRef` rather than an `Issue`: one level of parent is
    /// all a list row holds, and the parent itself need not be in the list at all.
    public enum GroupKey: Hashable, Identifiable {
        case none
        case state(WorkflowState)
        case stateCategory(StateCategory)
        case assignee(User?)
        case priority(Priority)
        case label(Label?)
        case team(Team)
        case dueDate(DueBucket)
        case parent(IssueRef?)

        /// Stable across a re-group, and distinct across groupings, so SwiftUI keeps a section's
        /// identity when the list underneath it is merged.
        public var id: String {
            switch self {
            case .none: "none"
            case .state(let state): "state:\(state.id)"
            case .stateCategory(let category): "stateCategory:\(category.rawValue)"
            case .assignee(let user): "assignee:\(user?.id ?? "")"
            case .priority(let priority): "priority:\(priority.rawValue)"
            case .label(let label): "label:\(label?.id ?? "")"
            case .team(let team): "team:\(team.id)"
            case .dueDate(let bucket): "dueDate:\(bucket.rawValue)"
            case .parent(let parent): "parent:\(parent?.id ?? "")"
            }
        }

        /// The heading's name, untranslated: workspace data where there is workspace data, and
        /// English where the word is this client's own. Used for the accessibility identifier,
        /// which must not move with the reader's locale — a UI test addressing
        /// `issues.group.In Progress` is addressing the workspace's own name for that state.
        public var name: String {
            switch self {
            case .none: "All"
            case .state(let state): state.name
            case .stateCategory(let category): category.groupName
            case .assignee(let user): user?.displayName ?? "No assignee"
            case .priority(let priority): priority.label
            case .label(let label): label?.name ?? "No label"
            case .team(let team): team.name
            case .dueDate(let bucket): bucket.name
            case .parent(let parent): parent?.identifier ?? "No parent"
            }
        }
    }

    public struct Section: Identifiable {
        public let key: GroupKey
        public let issues: [Issue]
        public var id: String { key.id }
    }

    /// Where a category sits in the list. Triage is at the top because it is the work nobody has
    /// decided about yet, and started is above unstarted because it is the work somebody is
    /// doing right now.
    public static func rank(_ category: StateCategory) -> Int {
        switch category {
        case .triage: 0
        case .started: 1
        case .unstarted: 2
        case .backlog: 3
        case .completed: 4
        case .canceled: 5
        case .duplicate: 6
        }
    }

    /// The whole of it: filter, order, group, order the groups.
    public static func sections(
        _ issues: [Issue],
        display: ListDisplay,
        context: Context = Context()
    ) -> [Section] {
        let visible = filtered(issues, display: display)
        let ordered = sorted(visible, display: display, calendar: context.calendar)
        return grouped(ordered, display: display, context: context)
    }

    // MARK: - Filtering

    private static func filtered(_ issues: [Issue], display: ListDisplay) -> [Issue] {
        var kept = display.showCompleted ? issues : issues.filter { $0.state.category.isOpen }
        if !display.showSubIssues {
            // "whose parent is in the same view" — so the set is what survived the completed
            // filter, not what arrived. A child whose parent was just hidden has nothing left to
            // be nested under and would otherwise vanish with it.
            let present = Set(kept.map(\.id))
            kept = kept.filter { issue in
                guard let parentId = issue.parentId else { return true }
                return !present.contains(parentId)
            }
        }
        return kept
    }

    // MARK: - Ordering

    private static func sorted(_ issues: [Issue], display: ListDisplay, calendar: Calendar) -> [Issue] {
        let ascending = display.direction == .asc
        // `manual` is the server's own ordering, which this client does not hold a field for:
        // the order the caller handed in *is* the manual order, and that is also what the
        // status-only grouping promised before this type existed.
        if display.orderBy == .manual {
            return ascending ? issues : issues.reversed()
        }
        return issues.sorted { left, right in
            if let decided = compare(left, right, by: display.orderBy, ascending: ascending, calendar: calendar) {
                return decided
            }
            return left.identifier < right.identifier
        }
    }

    /// Nil when the two are tied on the primary key, which hands the decision to `identifier`.
    private static func compare(
        _ left: Issue,
        _ right: Issue,
        by orderBy: ListDisplay.OrderBy,
        ascending: Bool,
        calendar: Calendar
    ) -> Bool? {
        switch orderBy {
        case .manual:
            return nil
        case .priority:
            return by(left.priority.sortWeight, right.priority.sortWeight, ascending)
        case .dueDate:
            return byOptional(day(left.dueDate, calendar), day(right.dueDate, calendar), ascending)
        case .estimate:
            return byOptional(left.estimate, right.estimate, ascending)
        case .createdAt:
            return by(left.createdAt, right.createdAt, ascending)
        case .updatedAt:
            return by(left.updatedAt, right.updatedAt, ascending)
        case .title:
            // Case-folded but not localised: a locale-sensitive collation would order the same
            // list differently on two phones, and a list is a thing people compare over a desk.
            return by(left.title.lowercased(), right.title.lowercased(), ascending)
        }
    }

    private static func by<T: Comparable>(_ left: T, _ right: T, _ ascending: Bool) -> Bool? {
        if left == right { return nil }
        return ascending ? left < right : left > right
    }

    /// Absence is not a value. An issue with no due date is not due very late, so it sinks to the
    /// bottom in both directions rather than being swept to the top by a reversal.
    private static func byOptional<T: Comparable>(_ left: T?, _ right: T?, _ ascending: Bool) -> Bool? {
        switch (left, right) {
        case (nil, nil): nil
        case (nil, _): false
        case (_, nil): true
        case (let left?, let right?): by(left, right, ascending)
        }
    }

    private static func day(_ value: String?, _ calendar: Calendar) -> Date? {
        value.flatMap { CalendarDay.parse($0, calendar: calendar) }
    }

    // MARK: - Grouping

    /// One bucket per key the issues actually produce, in the order the grouping defines.
    ///
    /// Issues keep the order they were handed in within a bucket, which is what makes the
    /// ordering above the only thing that decides row order.
    private static func grouped(
        _ issues: [Issue],
        display: ListDisplay,
        context: Context
    ) -> [Section] {
        guard display.groupBy != .none else {
            return issues.isEmpty ? [] : [Section(key: .none, issues: issues)]
        }

        var order: [String] = []
        var keys: [String: GroupKey] = [:]
        var members: [String: [Issue]] = [:]
        /// Where a state sits in its own team's list. Read once per group, from the first issue
        /// that lands in it, because `statesFor` can only answer about a team it holds.
        var statePositions: [String: Int] = [:]

        for issue in issues {
            for key in self.keys(for: issue, groupBy: display.groupBy, context: context) {
                if members[key.id] == nil {
                    order.append(key.id)
                    keys[key.id] = key
                    if case .state(let state) = key {
                        statePositions[key.id] = context.statesFor(issue).firstIndex { $0.id == state.id } ?? Int.max
                    }
                }
                members[key.id, default: []].append(issue)
            }
        }

        return order
            .sorted { left, right in
                precedes(keys[left]!, keys[right]!, groupBy: display.groupBy, statePositions: statePositions)
            }
            .map { Section(key: keys[$0]!, issues: members[$0] ?? []) }
    }

    /// Which groups an issue belongs to. One, except under `label`: an issue with three labels
    /// appears under each of them, which is the only reading of "group by label" that does not
    /// silently pick one label and hide the other two.
    private static func keys(
        for issue: Issue,
        groupBy: ListDisplay.GroupBy,
        context: Context
    ) -> [GroupKey] {
        switch groupBy {
        case .none:
            [.none]
        case .state:
            [.state(issue.state)]
        case .stateCategory:
            [.stateCategory(issue.state.category)]
        case .assignee:
            [.assignee(issue.assignee)]
        case .priority:
            [.priority(issue.priority)]
        case .label:
            issue.labels.isEmpty ? [.label(nil)] : issue.labels.map { GroupKey.label($0) }
        case .team:
            [.team(issue.team)]
        case .dueDate:
            [.dueDate(bucket(for: issue, context: context))]
        case .parent:
            [.parent(issue.parent)]
        }
    }

    private static func bucket(for issue: Issue, context: Context) -> DueBucket {
        guard let dueDate = issue.dueDate,
              let day = CalendarDay.parse(dueDate, calendar: context.calendar)
        else { return .none }
        let calendar = context.calendar
        let today = calendar.startOfDay(for: context.today)
        if day < today { return .overdue }
        if day == today { return .today }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: today), day == tomorrow {
            return .tomorrow
        }
        // Calendar weeks rather than a seven-day window: "this week" means the week the reader is
        // in, and on a Friday a rolling window would call next Wednesday "this week".
        if let week = calendar.dateInterval(of: .weekOfYear, for: today) {
            if week.contains(day) { return .thisWeek }
            if let next = calendar.date(byAdding: .weekOfYear, value: 1, to: week.start),
               let nextWeek = calendar.dateInterval(of: .weekOfYear, for: next),
               nextWeek.contains(day) {
                return .nextWeek
            }
        }
        return .later
    }

    /// Group order, per grouping. Every one ends on `id`, for the reason the row ordering does:
    /// two groups tied on every key must not swap places between two merges of the same list.
    ///
    /// A nil group sorts last in each of the three groupings that can have one. "No assignee" is
    /// a real section with a real heading, and it belongs at the bottom rather than above the
    /// people who are actually doing the work.
    private static func precedes(
        _ left: GroupKey,
        _ right: GroupKey,
        groupBy: ListDisplay.GroupBy,
        statePositions: [String: Int]
    ) -> Bool {
        switch (left, right) {
        case (.state(let leftState), .state(let rightState)):
            let leftRank = rank(leftState.category), rightRank = rank(rightState.category)
            if leftRank != rightRank { return leftRank < rightRank }
            let leftPosition = statePositions[left.id] ?? Int.max
            let rightPosition = statePositions[right.id] ?? Int.max
            if leftPosition != rightPosition { return leftPosition < rightPosition }
            if leftState.name != rightState.name { return leftState.name < rightState.name }

        case (.stateCategory(let leftCategory), .stateCategory(let rightCategory)):
            let leftRank = rank(leftCategory), rightRank = rank(rightCategory)
            if leftRank != rightRank { return leftRank < rightRank }

        case (.assignee(let leftUser), .assignee(let rightUser)):
            if let decided = nilLast(leftUser, rightUser) { return decided }
            if let leftUser, let rightUser, leftUser.displayName != rightUser.displayName {
                return leftUser.displayName.lowercased() < rightUser.displayName.lowercased()
            }

        case (.priority(let leftPriority), .priority(let rightPriority)):
            if leftPriority != rightPriority {
                return leftPriority.sortWeight < rightPriority.sortWeight
            }

        case (.label(let leftLabel), .label(let rightLabel)):
            if let decided = nilLast(leftLabel, rightLabel) { return decided }
            if let leftLabel, let rightLabel, leftLabel.name != rightLabel.name {
                return leftLabel.name.lowercased() < rightLabel.name.lowercased()
            }

        case (.team(let leftTeam), .team(let rightTeam)):
            if leftTeam.key != rightTeam.key { return leftTeam.key.lowercased() < rightTeam.key.lowercased() }

        case (.dueDate(let leftBucket), .dueDate(let rightBucket)):
            if leftBucket != rightBucket { return leftBucket.rank < rightBucket.rank }

        case (.parent(let leftParent), .parent(let rightParent)):
            if let decided = nilLast(leftParent, rightParent) { return decided }
            if let leftParent, let rightParent, leftParent.identifier != rightParent.identifier {
                return leftParent.identifier < rightParent.identifier
            }

        default:
            // Two keys of different kinds, which one grouping cannot produce. Ordered by id so
            // the comparator stays total even if it ever happens.
            break
        }
        return left.id < right.id
    }

    /// Nil last, in a comparator that cannot say "equal": nil returns `false` against anything
    /// but another nil, which hands that pair to the caller's own tiebreak.
    private static func nilLast<T>(_ left: T?, _ right: T?) -> Bool? {
        switch (left, right) {
        case (nil, nil): nil
        case (nil, _): false
        case (_, nil): true
        default: nil
        }
    }
}

extension StateCategory {
    /// The heading a category-grouped list puts over its issues. Not `rawValue`: `UNSTARTED`
    /// is the wire's word for it, not a reader's.
    var groupName: String {
        switch self {
        case .triage: "Triage"
        case .backlog: "Backlog"
        case .unstarted: "Unstarted"
        case .started: "In progress"
        case .completed: "Completed"
        case .canceled: "Canceled"
        case .duplicate: "Duplicate"
        }
    }
}
