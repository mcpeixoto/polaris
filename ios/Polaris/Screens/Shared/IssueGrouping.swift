import Foundation
import PolarisCore

/// Issues bucketed by workflow state, the way Linear's list groups them.
///
/// Groups are ordered by what the category *means* — work under way first, then work that
/// has not started, then the backlog, then everything closed — and within a category by the
/// workspace's own order of its states. An empty group is not a group; it is not emitted.
/// The order of issues inside a group is whatever the caller passed, which is `IssueOrder`.
enum IssueGrouping {
    struct Group: Identifiable {
        let state: WorkflowState
        let issues: [Issue]
        var id: String { state.id }
    }

    /// Where a category sits in the list. Triage is at the top because it is the work
    /// nobody has decided about yet, and started is above unstarted because it is the work
    /// somebody is doing right now.
    static func rank(_ category: StateCategory) -> Int {
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

    static func byStatus(_ issues: [Issue], statesFor: (Issue) -> [WorkflowState]) -> [Group] {
        var order: [String] = []
        var members: [String: [Issue]] = [:]
        var states: [String: WorkflowState] = [:]
        var positions: [String: Int] = [:]
        for issue in issues {
            let state = issue.state
            if members[state.id] == nil {
                order.append(state.id)
                states[state.id] = state
                positions[state.id] = statesFor(issue).firstIndex { $0.id == state.id } ?? Int.max
            }
            members[state.id, default: []].append(issue)
        }
        return order
            .sorted { left, right in
                let leftState = states[left]!, rightState = states[right]!
                let leftRank = rank(leftState.category), rightRank = rank(rightState.category)
                if leftRank != rightRank { return leftRank < rightRank }
                let leftPosition = positions[left]!, rightPosition = positions[right]!
                if leftPosition != rightPosition { return leftPosition < rightPosition }
                return leftState.name < rightState.name
            }
            .map { Group(state: states[$0]!, issues: members[$0] ?? []) }
    }
}
