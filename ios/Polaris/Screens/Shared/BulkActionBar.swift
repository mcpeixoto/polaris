import SwiftUI
import PolarisCore

/// What a selection can be changed to, at the foot of a list in selection mode.
///
/// A bar rather than a sheet: the selection is the context, and a modal over the list hides
/// the rows the reader just picked. Three menus, which are the three properties triage is
/// actually about — where it is, how urgent it is, whose it is. Everything else a bulk edit
/// can set stays on the detail screen, because a date picker or a label tree in a bar at the
/// bottom of the screen is a form, and a form wants a sheet.
///
/// The bar resolves each choice into a `BulkIssueEdit` — ids for the server, objects for the
/// rows — because a list cannot draw a status it only has the id of.
struct BulkActionBar: View {
    /// Which rows are picked. Ids rather than issues, because that is what the list's
    /// selection binding carries and what the server takes.
    let selection: Set<String>
    /// The rows on screen, so the bar can say what the selection spans.
    let issues: [Issue]
    /// This issue's team's statuses, as the list itself resolves them.
    let statesFor: (Issue) -> [WorkflowState]
    let people: [User]
    let apply: (BulkIssueEdit) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HairlineDivider()
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text(countLabel)
                    .font(PolarisText.caption.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("bulk.count")
                if let reason = unavailableReason {
                    // Said rather than left to a disabled control. A greyed-out menu with no
                    // sentence beside it is the reader guessing why their tap did nothing.
                    Text(reason)
                        .font(PolarisText.captionSmall)
                        .foregroundStyle(Theme.warn)
                        .accessibilityIdentifier("bulk.unavailable")
                }
                // Three equal columns on a line of their own, rather than chips pushed to
                // the right of the count. At phone width the one-line version wrapped
                // "Status" to "Sta-tus", and it would wrap again at the first Dynamic Type
                // size above the default whatever the labels were shortened to.
                HStack(spacing: Theme.Space.sm) {
                    statusMenu
                    priorityMenu
                    assigneeMenu
                }
            }
            .padding(.horizontal, Theme.Space.lg)
            .padding(.vertical, Theme.Space.sm)
        }
        .background(Theme.raised)
        .accessibilityIdentifier("bulk.bar")
    }

    private var selected: [Issue] { issues.filter { selection.contains($0.id) } }

    private var isOverCap: Bool { selection.count > PageSize.bulkSelection }

    private var isEmpty: Bool { selection.isEmpty }

    /// The statuses every selected row shares.
    ///
    /// A workflow state belongs to one team, so a selection spanning two teams has no common
    /// set and the honest answer is to offer none: moving an ENG issue to a DES status is a
    /// write the server refuses, and a menu that offers it is a menu whose every item fails.
    private var states: [WorkflowState] {
        let teams = Set(selected.map(\.team.id))
        guard teams.count == 1, let first = selected.first else { return [] }
        return statesFor(first)
    }

    private var countLabel: String {
        String(localized: "\(selection.count) selected")
    }

    private var unavailableReason: String? {
        if isOverCap {
            return String(localized: "One edit can change \(PageSize.bulkSelection) issues at most.")
        }
        if !isEmpty, states.isEmpty, Set(selected.map(\.team.id)).count > 1 {
            return String(localized: "Statuses belong to a team, so pick rows from one team to change status.")
        }
        return nil
    }

    private var statusMenu: some View {
        Menu {
            ForEach(states) { state in
                Button {
                    apply(BulkIssueEdit(
                        change: BulkIssueChange(ids: Array(selection), stateId: state.id),
                        state: state
                    ))
                } label: {
                    SwiftUI.Label(state.name, systemImage: state.category.symbolName)
                }
            }
        } label: {
            barLabel(String(localized: "Status"), symbol: "circle.lefthalf.filled")
        }
        .disabled(isEmpty || isOverCap || states.isEmpty)
        .accessibilityIdentifier("bulk.status")
    }

    private var priorityMenu: some View {
        Menu {
            ForEach(Priority.allCases, id: \.self) { priority in
                Button {
                    apply(BulkIssueEdit(
                        change: BulkIssueChange(ids: Array(selection), priority: priority)
                    ))
                } label: {
                    SwiftUI.Label(priority.label, systemImage: priority.symbolName)
                }
            }
        } label: {
            barLabel(String(localized: "Priority"), symbol: "chart.bar")
        }
        .disabled(isEmpty || isOverCap)
        .accessibilityIdentifier("bulk.priority")
    }

    private var assigneeMenu: some View {
        Menu {
            ForEach(people) { person in
                Button {
                    apply(BulkIssueEdit(
                        change: BulkIssueChange(ids: Array(selection), assigneeId: person.id),
                        assignee: person
                    ))
                } label: {
                    Text(person.displayName)
                }
            }
            if !people.isEmpty { Divider() }
            Button {
                // `clearAssignee` rather than a nil id: nil means "leave alone" in a partial
                // update, so unassigning needs the flag — see `BulkIssueChange`.
                apply(BulkIssueEdit(
                    change: BulkIssueChange(ids: Array(selection), clearAssignee: true)
                ))
            } label: {
                SwiftUI.Label(String(localized: "Unassign"), systemImage: "person.slash")
            }
        } label: {
            barLabel(String(localized: "Assignee"), symbol: "person.circle")
        }
        .disabled(isEmpty || isOverCap)
        .accessibilityIdentifier("bulk.assignee")
    }

    private func barLabel(_ title: String, symbol: String) -> some View {
        HStack(spacing: Theme.Space.xs + 2) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            Text(title)
                .font(.system(.footnote).weight(.medium))
                .lineLimit(1)
        }
        .padding(.horizontal, Theme.Space.sm)
        .frame(maxWidth: .infinity)
        .frame(minHeight: Theme.minimumHitTarget - Theme.Space.sm)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
    }
}

/// What a bulk edit actually did, including the part that did not happen.
///
/// `BulkIssuePayload.skipped` exists so that a partial success is something the caller can
/// act on rather than something it silently absorbs — the schema's own words. A client that
/// renders `issues.count` alone turns "seven of your nine moved" into a list where two rows
/// quietly stayed put, which from the outside is indistinguishable from a bug in the list.
struct BulkResultLabel: View {
    let result: BulkIssueResult
    /// Turns an id back into the `ENG-12` a reader recognises. `skipped` carries ids, and an
    /// apology naming a UUID is not an apology anybody can act on.
    let identify: (String) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(headline)
                .font(PolarisText.caption)
                .foregroundStyle(result.skipped.isEmpty ? Theme.textSecondary : Theme.warn)
            ForEach(reasons, id: \.reason) { group in
                Text(verbatim: "\(group.identifiers.joined(separator: ", ")) — \(group.reason)")
                    .font(PolarisText.captionSmall)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("bulk.result")
    }

    private var headline: String {
        let changed = result.issues.count
        guard !result.skipped.isEmpty else {
            return String(localized: "\(changed) changed")
        }
        return String(localized: "\(changed) changed, \(result.skipped.count) couldn't be")
    }

    /// Grouped by reason rather than listed per row: nine rows refused for one reason is one
    /// sentence, and nine copies of it is a wall.
    private var reasons: [(reason: String, identifiers: [String])] {
        var order: [String] = []
        var grouped: [String: [String]] = [:]
        for skip in result.skipped {
            if grouped[skip.reason] == nil { order.append(skip.reason) }
            grouped[skip.reason, default: []].append(identify(skip.id))
        }
        return order.map { (reason: $0, identifiers: grouped[$0] ?? []) }
    }
}

/// The toolbar item that turns selection on, and the one that turns it off again.
///
/// One control rather than two, in the place the Edit button would be. The label changes
/// because the gesture does: "Select" starts picking rows, "Done" stops. It says "Done" only
/// while selecting, and a list in selection mode cannot reach the detail screen — see
/// `IssueListView.rowLink` — so this never puts a second "Done" behind the status picker's.
struct SelectModeButton: View {
    @Binding var isSelecting: Bool
    @Binding var selection: Set<String>
    let identifier: String

    var body: some View {
        Button {
            withAnimation(Theme.easing(0.2)) {
                isSelecting.toggle()
                // Leaving the ids behind would apply the next batch to rows picked before
                // the reader turned selection off and changed their mind.
                if !isSelecting { selection = [] }
            }
        } label: {
            Text(isSelecting ? String(localized: "Done") : String(localized: "Select"))
        }
        .accessibilityIdentifier(identifier)
    }
}
