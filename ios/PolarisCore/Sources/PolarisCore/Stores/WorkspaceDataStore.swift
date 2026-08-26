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

        // States are per-team and the app needs them the moment a status picker opens, which
        // is too late to start a request. Fetched concurrently, once.
        if case .loaded(let loadedTeams) = teams {
            await withTaskGroup(of: (String, [WorkflowState]).self) { group in
                for team in loadedTeams {
                    group.addTask {
                        let states = (try? await self.api.workflowStates(teamId: team.id)) ?? []
                        return (team.id, states)
                    }
                }
                for await (teamId, states) in group {
                    statesByTeam[teamId] = states.sorted { $0.position < $1.position }
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
