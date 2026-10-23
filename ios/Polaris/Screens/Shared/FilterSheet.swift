import SwiftUI
import PolarisCore

// Filtering the list you are on.
//
// The sheet below composes a filter in the shared grammar — `IssueFilter` builds the AST,
// `IssueFilterEvaluator` answers it — and the screens that present it decide *where* it is
// answered. That decision is the whole design of this file, and it is not cosmetic:
//
//   * On a team list, My Issues, a project or a cycle the loaded collection is complete:
//     `issues(teamId:)` has no pagination, so the phone holds every issue in scope. A filter
//     over it is exact, and the caption can say how many of how many match.
//   * On search it is not complete. `search` answers with at most `PageSize.search` rows, so
//     the list on screen is the first forty matches and not the matches. A filter re-applied
//     locally there would narrow forty rows and then report a number about nothing, while
//     `SearchView.countCaption` carried on truthfully saying "Showing 40 of 400". So on
//     search the filter goes to the *server*, as `SearchInput.filter`, and is never
//     re-applied on the phone.
//
// Filtering and grouping compose and are kept apart: this file decides which issues a list
// holds, `DisplayOptionsMenu` and `IssueSectioning` decide how they are arranged.

// MARK: - The draft

/// A filter as the sheet edits it: a few sets of ids, not an AST.
///
/// Flat on purpose. The grammar can nest arbitrarily and a phone sheet cannot usefully edit a
/// nested tree, so what this builds is one `and` of per-field clauses — the shape every
/// filter bar in the product builds — and `filter` is the one place that knows how to spell
/// it. A screen holds a draft and nothing else; nothing round-trips an AST back into chips.
struct IssueFilterDraft: Equatable, Sendable {
    var assignees: Set<String> = []
    /// Kept apart from `assignees` so "nobody" is a choice rather than a sentinel id.
    var unassigned = false
    var creators: Set<String> = []
    /// Raw `Priority` values, which is what the grammar compares — `0` none, `1` urgent.
    var priorities: Set<Int> = []
    /// The grammar's lowercase category names. By category rather than by status id, so the
    /// clause survives a team renaming its statuses — and so one sheet works over a list that
    /// spans several teams, which a project's does.
    var categories: Set<String> = []
    var labels: Set<String> = []
    var projects: Set<String> = []
    var noProject = false
    var cycles: Set<String> = []
    var dueDate: DueDate = .any

    /// Single-select, because the three are mutually exclusive readings of the same column
    /// and a filter that says "overdue and undated" matches nothing.
    enum DueDate: String, CaseIterable, Sendable {
        case any, overdue, soon, none

        var title: String {
            switch self {
            case .any: String(localized: "Any")
            case .overdue: String(localized: "Overdue")
            case .soon: String(localized: "Next 7 days")
            case .none: String(localized: "No due date")
            }
        }
    }

    /// How many fields the filter narrows by — the number on the toolbar glyph.
    var activeFields: Int {
        var count = 0
        if !assignees.isEmpty || unassigned { count += 1 }
        if !creators.isEmpty { count += 1 }
        if !priorities.isEmpty { count += 1 }
        if !categories.isEmpty { count += 1 }
        if !labels.isEmpty { count += 1 }
        if !projects.isEmpty || noProject { count += 1 }
        if !cycles.isEmpty { count += 1 }
        if dueDate != .any { count += 1 }
        return count
    }

    var isEmpty: Bool { activeFields == 0 }

    /// The AST, or nil when nothing is selected.
    ///
    /// Nil rather than an empty `and`: an empty group matches everything, so sending one is a
    /// clause the server evaluates for no reason, and locally it is a pass over the list for
    /// no reason either.
    var filter: JSONValue? {
        var nodes: [JSONValue] = []

        // "Ada or nobody" is an `or`, and has to be: `assignee in [ada]` cannot express the
        // unassigned, because there is no id for having none.
        var who: [JSONValue] = []
        if !assignees.isEmpty {
            who.append(IssueFilter.clause("assignee", .in, assignees.sorted()))
        }
        if unassigned { who.append(IssueFilter.clause("assignee", .isNull)) }
        if let one = who.first, who.count == 1 {
            nodes.append(one)
        } else if !who.isEmpty {
            nodes.append(IssueFilter.or(who))
        }

        if !creators.isEmpty {
            nodes.append(IssueFilter.clause("creator", .in, creators.sorted()))
        }
        if !priorities.isEmpty {
            nodes.append(IssueFilter.clause("priority", .in, priorities.sorted().map(String.init)))
        }
        if !categories.isEmpty {
            nodes.append(IssueFilter.clause("stateCategory", .in, categories.sorted()))
        }
        if !labels.isEmpty {
            // Multi-valued: an issue matches if *any* of its labels matches.
            nodes.append(IssueFilter.clause("label", .in, labels.sorted()))
        }

        var where_: [JSONValue] = []
        if !projects.isEmpty {
            where_.append(IssueFilter.clause("project", .in, projects.sorted()))
        }
        if noProject { where_.append(IssueFilter.clause("project", .isNull)) }
        if let one = where_.first, where_.count == 1 {
            nodes.append(one)
        } else if !where_.isEmpty {
            nodes.append(IssueFilter.or(where_))
        }

        if !cycles.isEmpty {
            nodes.append(IssueFilter.clause("cycle", .in, cycles.sorted()))
        }

        switch dueDate {
        case .any:
            break
        case .overdue:
            // `now` is the one token that names an instant rather than a day, which is what
            // makes this mean overdue. On a date column it reads as today.
            nodes.append(IssueFilter.clause("dueDate", .lt, ["now"]))
        case .soon:
            nodes.append(IssueFilter.and([
                IssueFilter.clause("dueDate", .gte, ["today"]),
                IssueFilter.clause("dueDate", .lte, ["+7d"]),
            ]))
        case .none:
            nodes.append(IssueFilter.clause("dueDate", .isNull))
        }

        return nodes.isEmpty ? nil : IssueFilter.and(nodes)
    }

    /// The issues this draft keeps, out of a complete collection.
    ///
    /// Only for the exact screens. A refused filter returns the list unchanged rather than
    /// emptying the screen: every clause this sheet can build is one the evaluator answers,
    /// so a throw here is a bug in this file, and hiding somebody's work is the worse of the
    /// two ways to report it. The conformance suite is where it is meant to be caught.
    func apply(to issues: [Issue]) -> [Issue] {
        guard let filter else { return issues }
        let context = IssueFilterEvaluator.Context()
        return (try? IssueFilterEvaluator.apply(filter, to: issues, context: context)) ?? issues
    }
}

// MARK: - What a list can be filtered by

/// The options a sheet offers.
///
/// Built from the collection itself on every exact screen, which is both less plumbing and
/// more honest: the list is complete, so the people, labels, projects and cycles that appear
/// in it are exactly the ones a filter could narrow to. An option that matches nothing is
/// never offered, and nothing has to be fetched to draw the sheet.
///
/// Search cannot do that — forty rows are not the workspace — so it passes the workspace's
/// own directory and label list instead.
struct IssueFilterOptions: Equatable {
    var people: [User] = []
    var creators: [User] = []
    var labels: [PolarisCore.Label] = []
    var projects: [ProjectRef] = []
    var cycles: [CycleRef] = []
    var categories: [StateCategory] = []
    var priorities: [Priority] = Priority.allCases
    var hasUnassigned = false
    var hasUnfiled = false
    /// False on search, where `project` and `cycle` are not in the grammar and would be a
    /// hard error the moment the filter reached the server.
    var offersLocalFields = true

    init() {}

    /// From a complete collection.
    init(from issues: [Issue]) {
        people = Self.unique(issues.compactMap(\.assignee)).sorted { $0.displayName < $1.displayName }
        creators = Self.unique(issues.compactMap(\.creator)).sorted { $0.displayName < $1.displayName }
        labels = Self.unique(issues.flatMap(\.labels)).sorted { $0.name < $1.name }
        projects = Self.unique(issues.compactMap(\.project)).sorted { $0.name < $1.name }
        cycles = Self.unique(issues.compactMap(\.cycle)).sorted { $0.number < $1.number }
        // In the workspace's own order, not alphabetical: a status category list reads as a
        // lifecycle and sorting it by name would scatter it.
        let present = Set(issues.map(\.state.category))
        categories = Self.categoryOrder.filter(present.contains)
        priorities = Priority.allCases.filter { priority in issues.contains { $0.priority == priority } }
        hasUnassigned = issues.contains { $0.assignee == nil }
        hasUnfiled = issues.contains { $0.projectId == nil }
    }

    /// For search, where the filter is answered by the server and the rows on screen are only
    /// the first page of the matches.
    init(forServerSearch people: [User], labels: [PolarisCore.Label]) {
        self.people = people.sorted { $0.displayName < $1.displayName }
        self.creators = self.people
        self.labels = labels.filter { !$0.isGroup }.sorted { $0.name < $1.name }
        self.categories = Self.categoryOrder
        self.hasUnassigned = true
        self.offersLocalFields = false
    }

    static let categoryOrder: [StateCategory] = [
        .triage, .backlog, .unstarted, .started, .completed, .canceled, .duplicate,
    ]

    private static func unique<T: Identifiable>(_ values: [T]) -> [T] where T.ID == String {
        var seen: Set<String> = []
        return values.filter { seen.insert($0.id).inserted }
    }
}

// MARK: - The chip

/// The pill the search bar has used since it existed, lifted out so the sheet draws the same
/// thing rather than a second thing that looks nearly like it.
struct FilterChip: View {
    let title: String
    let isOn: Bool
    let identifier: String
    var dot: Color?
    var symbol: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Space.xs + 2) {
                if let dot {
                    Circle().fill(dot).frame(width: 7, height: 7)
                }
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(isOn ? Theme.accentBright : Theme.textSecondary)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(.system(.footnote).weight(.medium))
                    .foregroundStyle(isOn ? Theme.accentBright : Theme.textSecondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, Theme.Space.sm + 2)
            .frame(minHeight: 28)
            .background(isOn ? Theme.accentTint : Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(isOn ? Theme.accent : Theme.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
        .accessibilityIdentifier(identifier)
    }
}

// MARK: - The sheet

/// Which issues the list holds.
struct FilterSheet: View {
    @Binding var draft: IssueFilterDraft
    let options: IssueFilterOptions
    @Environment(\.dismiss) private var dismiss

    private let columns = [GridItem(.adaptive(minimum: 112), spacing: Theme.Space.sm)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    if !options.categories.isEmpty {
                        section(String(localized: "Status")) {
                            ForEach(options.categories, id: \.self) { category in
                                let key = category.filterValue
                                chip(
                                    category.filterTitle,
                                    isOn: draft.categories.contains(key),
                                    identifier: "filter.category.\(key)",
                                    symbol: category.symbolName
                                ) {
                                    draft.categories.toggle(key)
                                }
                            }
                        }
                    }
                    if !options.priorities.isEmpty {
                        section(String(localized: "Priority")) {
                            ForEach(options.priorities, id: \.self) { priority in
                                chip(
                                    priority.label,
                                    isOn: draft.priorities.contains(priority.rawValue),
                                    identifier: "filter.priority.\(priority.rawValue)",
                                    symbol: priority.symbolName
                                ) {
                                    draft.priorities.toggle(priority.rawValue)
                                }
                            }
                        }
                    }
                    if !options.people.isEmpty || options.hasUnassigned {
                        section(String(localized: "Assignee")) {
                            if options.hasUnassigned {
                                chip(
                                    String(localized: "Unassigned"),
                                    isOn: draft.unassigned,
                                    identifier: "filter.assignee.unassigned"
                                ) {
                                    draft.unassigned.toggle()
                                }
                            }
                            ForEach(options.people) { person in
                                chip(
                                    person.displayName,
                                    isOn: draft.assignees.contains(person.id),
                                    identifier: "filter.assignee.\(person.id)"
                                ) {
                                    draft.assignees.toggle(person.id)
                                }
                            }
                        }
                    }
                    if !options.labels.isEmpty {
                        section(String(localized: "Label")) {
                            ForEach(options.labels) { label in
                                chip(
                                    label.name,
                                    isOn: draft.labels.contains(label.id),
                                    identifier: "filter.label.\(label.id)",
                                    dot: Theme.hex(label.color)
                                ) {
                                    draft.labels.toggle(label.id)
                                }
                            }
                        }
                    }
                    section(String(localized: "Due date")) {
                        ForEach(IssueFilterDraft.DueDate.allCases, id: \.self) { window in
                            chip(
                                window.title,
                                isOn: draft.dueDate == window,
                                identifier: "filter.dueDate.\(window.rawValue)"
                            ) {
                                // Single-select, and tapping the current one goes back to Any
                                // rather than leaving no way out of it.
                                draft.dueDate = draft.dueDate == window ? .any : window
                            }
                        }
                    }
                    if options.offersLocalFields {
                        localSections
                    }
                    if !options.creators.isEmpty {
                        section(String(localized: "Created by")) {
                            ForEach(options.creators) { person in
                                chip(
                                    person.displayName,
                                    isOn: draft.creators.contains(person.id),
                                    identifier: "filter.creator.\(person.id)"
                                ) {
                                    draft.creators.toggle(person.id)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, Theme.Space.lg)
                .padding(.vertical, Theme.Space.lg)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("Filter"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        draft = IssueFilterDraft()
                    } label: {
                        Text("Clear")
                    }
                    .tint(Theme.accentBright)
                    .disabled(draft.isEmpty)
                    .accessibilityIdentifier("filter.clear")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: {
                        Text("Done").font(.system(.body).weight(.semibold))
                    }
                    .tint(Theme.accentBright)
                    .accessibilityIdentifier("filter.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// `project` and `cycle`, which the shared grammar does not have.
    ///
    /// Offered only where the filter is answered on this device. They are the reason this
    /// screen does not simply ask the server: no filter a phone can send narrows a list to
    /// one project, because `filter: JSON!` is validated against a grammar that has no such
    /// field — "the compiler validates at the boundary and rejects anything it does not
    /// recognise".
    @ViewBuilder
    private var localSections: some View {
        if !options.projects.isEmpty || options.hasUnfiled {
            section(String(localized: "Project")) {
                if options.hasUnfiled {
                    chip(
                        String(localized: "No project"),
                        isOn: draft.noProject,
                        identifier: "filter.project.none"
                    ) {
                        draft.noProject.toggle()
                    }
                }
                ForEach(options.projects) { project in
                    chip(
                        project.name,
                        isOn: draft.projects.contains(project.id),
                        identifier: "filter.project.\(project.id)",
                        dot: Theme.hex(project.color)
                    ) {
                        draft.projects.toggle(project.id)
                    }
                }
            }
        }
        if !options.cycles.isEmpty {
            section(String(localized: "Cycle")) {
                ForEach(options.cycles) { cycle in
                    chip(
                        cycle.displayName,
                        isOn: draft.cycles.contains(cycle.id),
                        identifier: "filter.cycle.\(cycle.id)"
                    ) {
                        draft.cycles.toggle(cycle.id)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func section(
        _ title: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            Text(title)
                .font(PolarisText.sectionTitle)
                .foregroundStyle(Theme.textSecondary)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Space.sm) {
                content()
            }
        }
    }

    private func chip(
        _ title: String,
        isOn: Bool,
        identifier: String,
        dot: Color? = nil,
        symbol: String? = nil,
        action: @escaping () -> Void
    ) -> some View {
        FilterChip(
            title: title,
            isOn: isOn,
            identifier: identifier,
            dot: dot,
            symbol: symbol,
            action: action
        )
    }
}

// MARK: - The toolbar item

/// The glyph that opens the sheet, with the number of fields the filter narrows by.
///
/// A count rather than a dot, because "filtered" is not the useful fact — "filtered three
/// ways, and I have forgotten one of them" is, and it is the state in which somebody
/// concludes the list is broken.
struct FilterButton: View {
    @Binding var draft: IssueFilterDraft
    let options: IssueFilterOptions
    var identifier: String = "issues.filter"
    @State private var isPresented = false

    var body: some View {
        Button { isPresented = true } label: {
            Image(systemName: draft.isEmpty
                  ? "line.3.horizontal.decrease.circle"
                  : "line.3.horizontal.decrease.circle.fill")
        }
        .tint(draft.isEmpty ? Theme.textSecondary : Theme.accentBright)
        // Not "Filter". My Issues' and the team list's *display* menu has been called that
        // since before it held display options, and `DisplayOptionsMenu` takes its label as a
        // parameter for exactly that reason — so a bare "Filter" here puts two buttons with
        // one name in the same toolbar, which XCUITest reports as an ambiguous query and a
        // VoiceOver user hears as two identical choices. The funnel deserves the shorter name
        // and the sliders deserve "Display"; renaming the sliders means editing the suites
        // that tap them, so it is asked for rather than taken.
        .accessibilityLabel(Text("Filter issues"))
        .accessibilityValue(Text(draft.isEmpty
                                 ? String(localized: "Off")
                                 : String(localized: "\(draft.activeFields) fields")))
        .accessibilityIdentifier(identifier)
        .sheet(isPresented: $isPresented) {
            FilterSheet(draft: $draft, options: options)
        }
    }
}

// MARK: - The count

/// How many of how many.
///
/// Only drawn on a complete collection, and the wording is deliberately not search's. "12 of
/// 48 match" is a statement about every issue in scope; "Showing 40 of 400" is a statement
/// about a page. Using one sentence for both is how a capped list starts reading as an exact
/// one.
struct FilterCountCaption: View {
    let matched: Int
    let total: Int
    var identifier: String = "issues.filter.count"

    var body: some View {
        Text(matched == 1
             ? String(localized: "1 of \(total) matches")
             : String(localized: "\(matched) of \(total) match"))
            .font(PolarisText.caption.monospacedDigit())
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.Space.lg)
            .padding(.vertical, Theme.Space.sm)
            .accessibilityIdentifier(identifier)
    }
}

/// What a list says when the filter leaves nothing in it.
///
/// Its own empty state, and not the screen's. "Nothing active on this team" and "everything
/// here is filtered out" are different facts, and a screen that printed the first for the
/// second would send somebody looking for work that is sitting right there.
struct NoFilterMatchesView: View {
    let total: Int
    let clear: () -> Void

    var body: some View {
        EmptyStateView(
            symbol: "line.3.horizontal.decrease.circle",
            title: String(localized: "Nothing matches"),
            message: total == 1
                ? String(localized: "The one issue here is filtered out.")
                : String(localized: "All \(total) issues here are filtered out."),
            actionTitle: String(localized: "Clear filter"),
            action: clear
        )
        .accessibilityIdentifier("issues.filter.empty")
    }
}

// MARK: - Reader-facing names

// In the view layer and not in Core, for the reason `DisplayOptionsMenu` gives: the wire's
// spelling is a contract, not a label.

extension StateCategory {
    /// The grammar spells categories in lowercase; the schema enum is SCREAMING_CASE.
    var filterValue: String { rawValue.lowercased() }

    var filterTitle: String {
        switch self {
        case .triage: String(localized: "Triage")
        case .backlog: String(localized: "Backlog")
        case .unstarted: String(localized: "Todo")
        case .started: String(localized: "In progress")
        case .completed: String(localized: "Done")
        case .canceled: String(localized: "Canceled")
        case .duplicate: String(localized: "Duplicate")
        }
    }
}

extension Set {
    /// In, or out. Written here because every chip in the sheet does exactly this and the
    /// alternative is the same four lines eight times.
    mutating func toggle(_ member: Element) {
        if contains(member) { remove(member) } else { insert(member) }
    }
}
