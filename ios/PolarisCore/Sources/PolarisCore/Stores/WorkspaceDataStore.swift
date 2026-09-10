import Foundation
import Observation

/// The reference data every screen needs to render an issue properly: teams, the workflow
/// states belonging to each, the people who can be assigned, the labels, projects and
/// project statuses a picker can offer, and the reader's favourites.
///
/// Loaded once after sign-in and held, because it changes on a scale of days while an issue
/// list changes on a scale of seconds. Refetching it per screen would triple the request count
/// for data that is effectively static.
/// What is known about one team's workflow states.
///
/// Three answers, because the two the store used to give could not be told apart: an empty
/// list meant both "this team has no statuses" and "nobody has asked yet". A status control
/// reading the second as the first is the whole of the bug this type exists to stop — a cold
/// start hydrated from the issue cache showed every issue with a dead status chip claiming
/// the team had no statuses, and nothing ever asked again.
public enum StatesAvailability: Sendable, Hashable {
    /// Nothing has asked for this team's states yet.
    case unknown
    /// A request is in flight.
    case loading
    /// The server answered. The list it gave may legitimately be empty.
    case loaded
    /// The request was refused or could not be made. Worth retrying, unlike `loaded`.
    case failed
}

/// The six reference collections the workspace loads once, named so the fetch, the
/// in-flight guard and the retry can be written once instead of six times.
///
/// Per-team workflow states are deliberately not a member: they are keyed by team rather
/// than being one value, and `ensureStates(forTeam:)` already carries them.
public enum ReferenceCollection: String, CaseIterable, Sendable, Hashable {
    case teams
    case users
    case labels
    case projects
    case projectStatuses
    case favorites
}

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
    /// What is known about each team's states, which is three things and not two — see
    /// `StatesAvailability`. Absent means nothing has asked yet.
    public private(set) var statesAvailabilityByTeam: [String: StatesAvailability] = [:]
    /// The last refused favourite toggle. A star that un-stars itself needs a sentence.
    public private(set) var favoriteError: PolarisError?

    /// Called on a refused read, for the reason `IssuesStore` gives.
    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI
    /// Teams with a states request already in flight, so a screen full of status controls
    /// appearing at once makes one request per team rather than one per control.
    private var statesInFlight: Set<String> = []
    /// The same guard for the six collections: a composer that wants teams, people, labels
    /// and projects as it opens must not double every one of them on a second appearance.
    private var referenceInFlight: Set<ReferenceCollection> = []

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

        if case .loaded(let loadedTeams) = teams {
            await loadStates(for: loadedTeams)
        }
    }

    /// Every team's states, concurrently, once.
    ///
    /// States are per-team and the app needs them the moment a status picker opens, which is
    /// too late to start a request. Shared with the teams retry: getting the teams back
    /// without their states would leave every status picker as dead as it was.
    private func loadStates(for teams: [Team]) async {
        for team in teams where statesAvailabilityByTeam[team.id] == nil {
            statesAvailabilityByTeam[team.id] = .loading
        }
        await withTaskGroup(of: (String, [WorkflowState], PolarisError?).self) { group in
            for team in teams {
                group.addTask {
                    do {
                        return (team.id, try await self.api.workflowStates(teamId: team.id), nil)
                    } catch {
                        return (team.id, [], PolarisError.mapped(error))
                    }
                }
            }
            for await (teamId, states, failure) in group {
                record(teamId: teamId, states: states, failure: failure)
            }
        }
    }

    // MARK: - Reference collections

    /// Fetches one collection unless its answer is already here.
    ///
    /// `load()` runs once, at sign-in. Until this existed, a collection that failed there —
    /// or a screen opened before it finished — stayed empty for the rest of the session with
    /// nothing able to ask again: a `.loaded([])` and a `.failed` looked the same to every
    /// picker in the app, which is how one refused `teams()` disabled the composer's Create
    /// button until somebody killed the process.
    ///
    /// A previous failure is retried; a collection that is genuinely empty is not asked twice.
    public func ensure(_ collection: ReferenceCollection) async {
        guard !status(collection).hasValue else { return }
        await refetch(collection)
    }

    /// Asks again whatever the last answer was. This is the retry behind a "couldn't load"
    /// chip, and the counterpart of `reloadStates(forTeam:)`.
    public func reload(_ collection: ReferenceCollection) async {
        await refetch(collection)
    }

    /// Several at once, for a screen whose pickers span more than one of them — the composer
    /// offers a team, an assignee, labels and a project, and wants all four or an explanation.
    public func ensureReferenceData(_ collections: [ReferenceCollection]) async {
        await withTaskGroup(of: Void.self) { group in
            for collection in Set(collections) {
                group.addTask { await self.ensure(collection) }
            }
        }
    }

    /// Why a collection is not here, for a screen that wants to say so and offer the retry.
    /// Nil covers both "loaded" and "nobody has asked yet" — the second is a spinner, not a
    /// sentence.
    public func failure(of collection: ReferenceCollection) -> PolarisError? {
        status(collection).failure
    }

    private func refetch(_ collection: ReferenceCollection) async {
        guard !referenceInFlight.contains(collection) else { return }
        referenceInFlight.insert(collection)
        defer { referenceInFlight.remove(collection) }

        switch collection {
        case .teams: await refetch(into: \.teams) { try await self.api.teams() }
        case .users: await refetch(into: \.users) { try await self.api.users() }
        case .labels: await refetch(into: \.labels) { try await self.api.labels() }
        case .projects: await refetch(into: \.projects) { try await self.api.projects() }
        case .projectStatuses: await refetch(into: \.projectStatuses) { try await self.api.projectStatuses() }
        case .favorites: await refetch(into: \.favorites) { try await self.api.favorites() }
        }

        if collection == .teams, let loadedTeams = teams.value {
            await loadStates(for: loadedTeams)
        }
        if let failure = status(collection).failure, case .unauthorized = failure {
            onUnauthorized?(failure)
        }
    }

    private func refetch<T: Sendable>(
        into keyPath: ReferenceWritableKeyPath<WorkspaceDataStore, Loadable<[T]>>,
        using operation: @Sendable @escaping () async throws -> [T]
    ) async {
        // Only a collection with nothing in it shows a spinner. Blanking a list the reader is
        // looking at, to fetch the same list again, is a flash of empty screen for nothing.
        if self[keyPath: keyPath].value == nil { self[keyPath: keyPath] = .loading }
        let fresh = await fetch(operation)
        self[keyPath: keyPath] = settle(self[keyPath: keyPath], fresh)
    }

    /// The two things the generic machinery needs to know about a collection without caring
    /// what is in it.
    private func status(_ collection: ReferenceCollection) -> (hasValue: Bool, failure: PolarisError?) {
        switch collection {
        case .teams: (teams.value != nil, teams.error)
        case .users: (users.value != nil, users.error)
        case .labels: (labels.value != nil, labels.error)
        case .projects: (projects.value != nil, projects.error)
        case .projectStatuses: (projectStatuses.value != nil, projectStatuses.error)
        case .favorites: (favorites.value != nil, favorites.error)
        }
    }

    /// What a collection becomes after a refetch.
    ///
    /// The list-freshness rule, plus the one thing that is not a failure at all: a cancelled
    /// request goes back to `.idle` rather than `.failed`, so the next screen to ask fetches
    /// it instead of offering a retry for something nobody did wrong.
    private func settle<T>(_ current: Loadable<T>, _ fresh: Loadable<T>) -> Loadable<T> {
        if case .failed(.cancelled) = fresh { return current.value == nil ? .idle : current }
        return keep(current, unless: fresh)
    }

    /// Makes sure a team's states are on their way, and does nothing if they are already here.
    ///
    /// Every status control calls this as it appears. The bulk fetch in `load()` runs once per
    /// session, at sign-in, and until this existed a single failed request — or a cold start
    /// that showed the cached issue list before `load()` finished — left the status picker
    /// dead for the rest of the session with no way to ask again.
    ///
    /// A previous failure is retried; a team that genuinely has no statuses is not asked twice.
    public func ensureStates(forTeam teamId: String) async {
        guard statesAvailabilityByTeam[teamId] != .loaded else { return }
        await fetchStates(forTeam: teamId)
    }

    /// Asks again, whatever the last answer was. This is the retry behind the failed chip.
    public func reloadStates(forTeam teamId: String) async {
        await fetchStates(forTeam: teamId)
    }

    /// What is known about this team's states.
    public func statesAvailability(forTeam teamId: String) -> StatesAvailability {
        statesAvailabilityByTeam[teamId] ?? .unknown
    }

    private func fetchStates(forTeam teamId: String) async {
        guard !statesInFlight.contains(teamId) else { return }
        statesInFlight.insert(teamId)
        statesAvailabilityByTeam[teamId] = .loading
        defer { statesInFlight.remove(teamId) }
        do {
            let states = try await api.workflowStates(teamId: teamId)
            record(teamId: teamId, states: states, failure: nil)
        } catch {
            let mapped = PolarisError.mapped(error)
            record(teamId: teamId, states: [], failure: mapped)
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    private func record(teamId: String, states: [WorkflowState], failure: PolarisError?) {
        switch failure {
        case nil:
            statesByTeam[teamId] = states.sorted { $0.position < $1.position }
            statesFailedForTeam.remove(teamId)
            statesAvailabilityByTeam[teamId] = .loaded
        case .cancelled:
            // A screen torn down mid-fetch is not a team whose statuses are broken. Back to
            // whatever was known before, so the next control that appears asks again rather
            // than offering a retry chip for a request nobody wanted an answer to.
            statesAvailabilityByTeam[teamId] = statesByTeam[teamId] == nil ? nil : .loaded
        default:
            statesFailedForTeam.insert(teamId)
            statesAvailabilityByTeam[teamId] = .failed
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
