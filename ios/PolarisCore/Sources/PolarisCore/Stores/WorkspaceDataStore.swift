import Foundation
import Observation

/// The reference data every screen needs to render an issue properly: teams, the workflow
/// states belonging to each, the people who can be assigned, and nothing else.
///
/// Loaded once after sign-in and held, because it changes on a scale of days while an issue
/// list changes on a scale of seconds. Refetching it per screen would triple the request count
/// for data that is effectively static.
@MainActor
@Observable
public final class WorkspaceDataStore {
    public private(set) var teams: Loadable<[Team]> = .idle
    public private(set) var users: Loadable<[User]> = .idle
    public private(set) var statesByTeam: [String: [WorkflowState]] = [:]
    /// Teams whose states could not be fetched, as distinct from teams that genuinely have
    /// none. Without the distinction a transient network failure silently disables the status
    /// picker for the rest of the session.
    public private(set) var statesFailedForTeam: Set<String> = []

    /// Called on a refused read, for the reason `IssuesStore` gives.
    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI

    public init(api: any PolarisAPI) {
        self.api = api
    }

    public func load() async {
        teams = .loading
        users = .loading
        async let teamsResult = fetch { try await self.api.teams() }
        async let usersResult = fetch { try await self.api.users() }
        teams = await teamsResult
        users = await usersResult
        // A session that died while the app was open must reach AppModel from here too:
        // `statesFailedForTeam` would otherwise silently disable every status picker for the
        // rest of a session that no longer exists.
        for failure in [teams.error, users.error].compactMap({ $0 }) {
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

    /// States a picker should offer for an issue, in the order the workspace defined.
    public func states(forTeam teamId: String) -> [WorkflowState] {
        statesByTeam[teamId] ?? []
    }

    public func user(id: String?) -> User? {
        guard let id, case .loaded(let people) = users else { return nil }
        return people.first { $0.id == id }
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
