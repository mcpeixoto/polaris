import Foundation
import Observation

/// The reference data every screen needs to render an issue properly: teams, the workflow
/// states belonging to each, the people who can be assigned, the labels, projects and
/// project statuses a picker can offer, and the reader's favourites.
///
/// Loaded once after sign-in and held, because it changes on a scale of days while an issue
/// list changes on a scale of seconds. Refetching it per screen would triple the request count
/// for data that is effectively static.
@MainActor
@Observable
public final class WorkspaceDataStore {
    public private(set) var teams: Loadable<[Team]> = .idle
    public private(set) var users: Loadable<[User]> = .idle
    public private(set) var labels: Loadable<[Label]> = .idle
    public private(set) var projects: Loadable<[Project]> = .idle
    public private(set) var projectStatuses: Loadable<[ProjectStatus]> = .idle
    public private(set) var favorites: Loadable<[Favorite]> = .idle
    public private(set) var statesByTeam: [String: [WorkflowState]] = [:]
    /// Teams whose states could not be fetched, as distinct from teams that genuinely have
    /// none. Without the distinction a transient network failure silently disables the status
    /// picker for the rest of the session.
    public private(set) var statesFailedForTeam: Set<String> = []
    /// The last refused favourite toggle. A star that un-stars itself needs a sentence.
    public private(set) var favoriteError: PolarisError?

    /// Called on a refused read, for the reason `IssuesStore` gives.
    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI

    public init(api: any PolarisAPI) {
        self.api = api
    }

    /// Six collections, fetched at once, each failing on its own. A projects request that
    /// times out must not take the assignee picker with it.
    public func load() async {
        teams = .loading
        users = .loading
        if labels.value == nil { labels = .loading }
        if projects.value == nil { projects = .loading }
        if projectStatuses.value == nil { projectStatuses = .loading }
        if favorites.value == nil { favorites = .loading }
        async let teamsResult = fetch { try await self.api.teams() }
        async let usersResult = fetch { try await self.api.users() }
        async let labelsResult = fetch { try await self.api.labels() }
        async let projectsResult = fetch { try await self.api.projects() }
        async let statusesResult = fetch { try await self.api.projectStatuses() }
        async let favoritesResult = fetch { try await self.api.favorites() }
        teams = await teamsResult
        users = await usersResult
        labels = keep(labels, unless: await labelsResult)
        projects = keep(projects, unless: await projectsResult)
        projectStatuses = keep(projectStatuses, unless: await statusesResult)
        favorites = keep(favorites, unless: await favoritesResult)
        // A session that died while the app was open must reach AppModel from here too:
        // `statesFailedForTeam` would otherwise silently disable every status picker for the
        // rest of a session that no longer exists.
        for failure in [teams.error, users.error, labels.error, projects.error,
                        projectStatuses.error, favorites.error].compactMap({ $0 }) {
            if case .unauthorized = failure { onUnauthorized?(failure) }
        }

        // States are per-team and the app needs them the moment a status picker opens, which
        // is too late to start a request. Fetched concurrently, once.
        if case .loaded(let loadedTeams) = teams {
            await withTaskGroup(of: (String, [WorkflowState], Bool).self) { group in
                for team in loadedTeams {
                    group.addTask {
                        do {
                            return (team.id, try await self.api.workflowStates(teamId: team.id), true)
                        } catch {
                            return (team.id, [], false)
                        }
                    }
                }
                for await (teamId, states, ok) in group {
                    if ok {
                        statesByTeam[teamId] = states.sorted { $0.position < $1.position }
                        statesFailedForTeam.remove(teamId)
                    } else {
                        statesFailedForTeam.insert(teamId)
                    }
                }
            }
        }
    }

    /// The list-freshness rule, for the collections a screen may already be showing: a
    /// refetch that fails leaves the loaded value alone rather than replacing it with an error.
    private func keep<T>(_ current: Loadable<T>, unless fresh: Loadable<T>) -> Loadable<T> {
        if case .failed = fresh, current.value != nil { return current }
        return fresh
    }

    /// States a picker should offer for an issue, in the order the workspace defined.
    public func states(forTeam teamId: String) -> [WorkflowState] {
        statesByTeam[teamId] ?? []
    }

    /// Labels a picker should offer for an issue on this team: the workspace's, plus the
    /// team's own, groups left out because a group is a heading and not something applied.
    public func labels(forTeam teamId: String) -> [Label] {
        (labels.value ?? [])
            .filter { $0.applies(toTeam: teamId) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    public func user(id: String?) -> User? {
        guard let id, case .loaded(let people) = users else { return nil }
        return people.first { $0.id == id }
    }

    public func project(id: String?) -> Project? {
        guard let id else { return nil }
        return projects.value?.first { $0.id == id }
    }

    public func projectStatus(id: String?) -> ProjectStatus? {
        guard let id else { return nil }
        return projectStatuses.value?.first { $0.id == id }
    }

    /// Projects a picker should offer an issue on this team: those the team belongs to,
    /// open ones first.
    public func projects(forTeam teamId: String) -> [Project] {
        (projects.value ?? [])
            .filter { project in project.teams.contains { $0.id == teamId } }
            .sorted { left, right in
                if left.status.category.isOpen != right.status.category.isOpen {
                    return left.status.category.isOpen
                }
                return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
            }
    }

    public func isFavorite(kind: FavoriteKind, targetId: String) -> Bool {
        favorites.value?.contains { $0.kind == kind && $0.targetId == targetId } ?? false
    }

    /// Stars or un-stars, optimistically. The row is added or removed before the round trip
    /// and put back if the server refuses.
    public func toggleFavorite(kind: FavoriteKind, targetId: String) async {
        favoriteError = nil
        let before = favorites.value ?? []
        if let existing = before.first(where: { $0.kind == kind && $0.targetId == targetId }) {
            favorites = .loaded(before.filter { $0.id != existing.id })
            do {
                try await api.removeFavorite(kind: kind, targetId: targetId)
            } catch {
                favorites = .loaded(before)
                report(PolarisError.mapped(error))
            }
        } else {
            let placeholder = Favorite(id: "pending-\(kind.rawValue)-\(targetId)", kind: kind, targetId: targetId, name: nil)
            favorites = .loaded(before + [placeholder])
            do {
                let created = try await api.addFavorite(kind: kind, targetId: targetId)
                favorites = .loaded((favorites.value ?? []).map { $0.id == placeholder.id ? created : $0 })
            } catch {
                favorites = .loaded(before)
                report(PolarisError.mapped(error))
            }
        }
    }

    private func report(_ error: PolarisError) {
        favoriteError = error
        if case .unauthorized = error { onUnauthorized?(error) }
    }

    private func fetch<T: Sendable>(_ operation: @Sendable () async throws -> T) async -> Loadable<T> {
        do {
            return .loaded(try await operation())
        } catch let error as PolarisError {
            return .failed(error)
        } catch {
            return .failed(.badResponse)
        }
    }
}
