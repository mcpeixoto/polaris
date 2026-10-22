import Foundation

/// What a favourite points at, once it has been resolved into something renderable.
///
/// A case per kind this client has a screen for. `FavoriteKind` has three more — a saved
/// view, a folder, and whatever the server adds next — and they are deliberately absent:
/// a case here is a promise that tapping the row opens something.
public enum FavoriteTarget: Sendable, Hashable {
    case team(Team)
    case issue(Issue)
    case label(Label)
    case project(Project)
    case cycle(Cycle)
}

/// One favourite, paired with the thing it names.
public struct FavoriteRow: Sendable, Hashable, Identifiable {
    public let favorite: Favorite
    public let target: FavoriteTarget

    /// The favourite's own id, not the target's. Two favourites can point at one issue —
    /// a stale row the server has not reaped and a fresh one — and a list keyed by target
    /// would collapse them into one row that then removes the wrong favourite.
    public var id: String { favorite.id }

    public init(favorite: Favorite, target: FavoriteTarget) {
        self.favorite = favorite
        self.target = target
    }
}

/// The favourites list, resolved.
///
/// `WorkspaceDataStore` already holds the favourites themselves, knows whether a given thing
/// is one, and toggles them optimistically. What it does not do is say what they *are*: a
/// `Favorite` is a kind and a target id, so a list of them renders as a column of uuids.
/// This turns them into rows.
///
/// ## Why the issue and cycle lookups are N+1
///
/// Teams, projects and labels are already in `WorkspaceDataStore` — reference data the app
/// loads once — so resolving those costs nothing. Issues and cycles have no bulk-by-id query
/// on the wire, so each one is its own `issue(id:)` / `cycle(id:)`, concurrently. That is
/// the same bargain `gatherTeamIssues` strikes and it is the right one here: favourites are
/// a sidebar list, tens at the very outside, and the alternative is a server change for a
/// screen that would still need this fan-out on a cold start.
///
/// ## Why a failed lookup does not empty the list
///
/// One deleted issue among twelve favourites should cost one row, not the screen. Each
/// lookup is attempted independently and a failure drops that row — counted, like the kinds
/// this build cannot open, so the footer can say how many are missing rather than letting
/// them disappear.
@MainActor
@Observable
public final class FavoritesStore {
    public private(set) var rows: Loadable<[FavoriteRow]> = .idle

    /// Favourites that exist and are not shown: a saved view, a folder, an initiative, or a
    /// target that could not be loaded. Stated in the UI rather than swallowed — a starred
    /// document that silently vanishes reads as data loss.
    public private(set) var unavailable: Int = 0

    private let api: any PolarisAPI

    public init(api: any PolarisAPI) {
        self.api = api
    }

    /// Resolves the favourites `workspace` is holding.
    ///
    /// Takes the store rather than an array so the reference data and the favourites come
    /// from one snapshot. Reading them separately is how a row resolves against projects
    /// that were reloaded in between.
    public func load(from workspace: WorkspaceDataStore) async {
        guard let favorites = workspace.favorites.value else {
            // No favourites loaded yet is not an empty favourites list, and showing the
            // empty state over data still arriving is the lie `Loadable` exists to avoid.
            if case .idle = rows { rows = workspace.favorites.isLoading ? .loading : .idle }
            return
        }
        if rows.value == nil { rows = .loading }

        var resolved: [String: FavoriteTarget] = [:]
        var missing = 0

        // The cheap half, straight from reference data already in memory.
        let teams = workspace.teams.value ?? []
        let labels = workspace.labels.value ?? []
        for favorite in favorites {
            switch favorite.kind {
            case .team:
                if let team = teams.first(where: { $0.id == favorite.targetId }) {
                    resolved[favorite.id] = .team(team)
                } else {
                    missing += 1
                }
            case .label:
                if let label = labels.first(where: { $0.id == favorite.targetId }) {
                    resolved[favorite.id] = .label(label)
                } else {
                    missing += 1
                }
            case .project:
                if let project = workspace.project(id: favorite.targetId) {
                    resolved[favorite.id] = .project(project)
                } else {
                    missing += 1
                }
            case .view, .folder, .other:
                missing += 1
            case .issue, .cycle:
                break  // fetched below
            }
        }

        // The half that costs a request each. One task per favourite, and a refusal drops
        // only its own row.
        let api = self.api
        let fetches = favorites.filter { $0.kind == .issue || $0.kind == .cycle }
        if !fetches.isEmpty {
            let found = await withTaskGroup(of: (String, FavoriteTarget?).self) { group in
                for favorite in fetches {
                    group.addTask { [kind = favorite.kind, targetId = favorite.targetId] in
                        switch kind {
                        case .issue:
                            let issue = try? await api.issue(id: targetId)
                            return (favorite.id, issue.map(FavoriteTarget.issue))
                        default:
                            let cycle = try? await api.cycle(id: targetId)
                            return (favorite.id, cycle.map(FavoriteTarget.cycle))
                        }
                    }
                }
                var out: [String: FavoriteTarget?] = [:]
                for await (id, target) in group { out[id] = target }
                return out
            }
            for (id, target) in found {
                if let target { resolved[id] = target } else { missing += 1 }
            }
        }

        // The server's order is the reader's arrangement, so it is kept rather than sorted.
        rows = .loaded(favorites.compactMap { favorite in
            resolved[favorite.id].map { FavoriteRow(favorite: favorite, target: $0) }
        })
        unavailable = missing
    }

    /// Drops everything, for a workspace switch.
    public func clear() {
        rows = .idle
        unavailable = 0
    }
}

extension FavoritesStore: IssueMerging {
    /// A starred issue whose status changed elsewhere.
    ///
    /// Replaces the target in place rather than reloading: the row's position is the
    /// reader's arrangement, and a reload would also spend a request per favourite to learn
    /// something the write already told us.
    public func merge(_ updated: Issue) {
        guard let current = rows.value else { return }
        var next = current
        var touched = false
        for (index, row) in next.enumerated() {
            guard case .issue(let held) = row.target, held.id == updated.id else { continue }
            next[index] = FavoriteRow(favorite: row.favorite, target: .issue(updated))
            touched = true
        }
        if touched { rows = .loaded(next) }
    }
}
