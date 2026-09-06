import SwiftUI
import PolarisCore

/// The three cuts of a team's list, as Linear's team screen offers them.
enum TeamListKind: String, CaseIterable, Identifiable, Hashable {
    case active
    case backlog
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .active: String(localized: "Active")
        case .backlog: String(localized: "Backlog")
        case .all: String(localized: "All")
        }
    }
}

/// The screens under a team's hub, as values.
///
/// Values rather than views, for the reason every other destination in the app is a value:
/// `PolarisNavigation` declares the destination once, and the hub's rows push a route the
/// same way an issue row pushes an `Issue`.
enum TeamListRoute: Hashable {
    case issues(Team, TeamListKind)
    case triage(Team)
    case cycles(Team)
    case projects(Team)
}

/// One `TeamWorkStore` per team, shared by the hub and every screen under it.
///
/// The hub's children are pushed by value through `PolarisNavigation`, so the hub cannot hand
/// its store to them through an initialiser, and a `.environment` set on the hub does not
/// reach a destination declared on the stack's root. Handing each screen its own store would
/// mean four fetches of the same unpaginated team list on the way from the hub to a cycle.
///
/// Entries are scoped to the session's reference data: `AppModel` replaces `workspaceData` on
/// sign-out and on a workspace switch, so a store built for the previous session is dropped
/// the first time anything asks after either — the next account never sees the last one's list.
@MainActor
final class TeamWorkStores {
    static let shared = TeamWorkStores()

    private var generation: ObjectIdentifier?
    private var stores: [String: TeamWorkStore] = [:]

    func store(for team: Team, model: AppModel) -> TeamWorkStore {
        let current = ObjectIdentifier(model.workspaceData)
        if generation != current {
            stores.removeAll()
            generation = current
        }
        if let existing = stores[team.id] { return existing }
        let created = TeamWorkStore(api: model.api, team: team)
        model.adopt(&created.onUnauthorized)
        stores[team.id] = created
        return created
    }
}
