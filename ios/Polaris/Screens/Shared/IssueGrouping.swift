import Foundation
import PolarisCore

/// Issues bucketed by workflow state, the way Linear's list groups them.
///
/// Groups are ordered by what the category *means* — work under way first, then work that
/// has not started, then the backlog, then everything closed — and within a category by the
/// workspace's own order of its states. An empty group is not a group; it is not emitted.
/// The order of issues inside a group is whatever the caller passed, which is `IssueOrder`.
///
/// Now a forwarder onto `IssueSectioning`, which does the same job for all nine of the display
/// schema's groupings. Kept — name, shape and all — rather than deleted, because the five tests
/// in `ListPresentationTests` that address it are the only assertion that the general
/// implementation preserves the status-only semantics this view shipped with. They pass through
/// here unchanged, which is the point: a conformance suite, not legacy.
enum IssueGrouping {
    struct Group: Identifiable {
        let state: WorkflowState
        let issues: [Issue]
        var id: String { state.id }
    }

    static func rank(_ category: StateCategory) -> Int {
        IssueSectioning.rank(category)
    }

    static func byStatus(_ issues: [Issue], statesFor: (Issue) -> [WorkflowState]) -> [Group] {
        // `withoutActuallyEscaping` rather than marking the parameter `@escaping`: `Context`
        // stores its resolver, but this signature is the one five tests and every call site
        // already use, and sectioning is over before this function returns.
        withoutActuallyEscaping(statesFor) { resolve in
            // `manual` is "the order the caller passed", which is exactly what this function
            // has always promised about the rows inside a group.
            IssueSectioning.sections(
                issues,
                display: ListDisplay(groupBy: .state, orderBy: .manual),
                context: IssueSectioning.Context(statesFor: resolve)
            )
            .compactMap { section in
                guard case .state(let state) = section.key else { return nil }
                return Group(state: state, issues: section.issues)
            }
        }
    }
}
