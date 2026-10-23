import SwiftUI
import PolarisCore

/// Linear's display menu: how the list is grouped, what orders the rows, which way round, and
/// whether children of a visible parent are rows of their own.
///
/// One menu for every list in the app rather than one per screen, because "group by assignee"
/// has to mean the same thing on a team's list as on a search result — and because the thing
/// being edited is a `ListDisplay`, the schema a saved view stores. A screen that grew its own
/// private set of options would be a screen whose view could not be saved.
///
/// `extra` is for the items a screen owns that are not display options. My Issues puts its
/// store-backed "Show completed" toggle there: that one refetches rather than re-sections, so it
/// cannot be a field of a display the client resolves locally.
struct DisplayOptionsMenu<Extra: View>: View {
    @Binding var display: ListDisplay
    /// No longer a parameter. My Issues used to override both the symbol and the name to keep
    /// calling this "Filter" with a funnel, from before the list could be grouped and long
    /// before anything could filter it. `FilterButton` now holds that name and that icon, so
    /// every list says Display for this one and means the same thing by it.
    private let symbol = "slider.horizontal.3"
    private let label = String(localized: "Display")
    var identifier: String = "issues.display"
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        Menu {
            extra()
            Picker(selection: $display.groupBy) {
                ForEach(ListDisplay.GroupBy.allCases, id: \.self) { option in
                    Text(option.title).tag(option)
                }
            } label: {
                Text("Group by")
            }
            .pickerStyle(.menu)
            Picker(selection: $display.orderBy) {
                ForEach(ListDisplay.OrderBy.allCases, id: \.self) { option in
                    Text(option.title).tag(option)
                }
            } label: {
                Text("Order")
            }
            .pickerStyle(.menu)
            Picker(selection: $display.direction) {
                ForEach(ListDisplay.Direction.allCases, id: \.self) { option in
                    Text(option.title).tag(option)
                }
            } label: {
                Text("Direction")
            }
            .pickerStyle(.menu)
            Toggle(isOn: $display.showSubIssues) {
                Text("Show sub-issues")
            }
        } label: {
            Image(systemName: symbol)
        }
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(identifier)
    }
}

extension DisplayOptionsMenu where Extra == EmptyView {
    init(display: Binding<ListDisplay>, identifier: String = "issues.display") {
        self.init(display: display, identifier: identifier) {
            EmptyView()
        }
    }
}

// The reader-facing names for the schema's values. In the view layer and not in Core, because
// Core has no string catalogue — and because the wire's spelling (`stateCategory`, `createdAt`)
// is a contract, not a label.

extension ListDisplay.GroupBy {
    var title: String {
        switch self {
        case .none: String(localized: "No grouping")
        case .state: String(localized: "Status")
        case .stateCategory: String(localized: "Status category")
        case .assignee: String(localized: "Assignee")
        case .priority: String(localized: "Priority")
        case .label: String(localized: "Label")
        case .team: String(localized: "Team")
        case .dueDate: String(localized: "Due date")
        case .parent: String(localized: "Parent")
        }
    }
}

extension ListDisplay.OrderBy {
    var title: String {
        switch self {
        // "Manual" is the order the list arrived in, which for every screen here is
        // `IssueOrder` — open work first, by priority. Named for what the schema calls it
        // rather than for what it happens to be today.
        case .manual: String(localized: "Default")
        case .priority: String(localized: "Priority")
        case .dueDate: String(localized: "Due date")
        case .estimate: String(localized: "Estimate")
        case .createdAt: String(localized: "Created")
        case .updatedAt: String(localized: "Updated")
        case .title: String(localized: "Title")
        }
    }
}

extension ListDisplay.Direction {
    var title: String {
        switch self {
        case .asc: String(localized: "Ascending")
        case .desc: String(localized: "Descending")
        }
    }
}
