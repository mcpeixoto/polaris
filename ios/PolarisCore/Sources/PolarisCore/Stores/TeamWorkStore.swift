import Foundation
import Observation

// The three stores behind a team's screens: the team itself, one of its projects, one of
// its cycles.
//
// There is no server-side "issues in this project" or "issues in this cycle" query, and the
// filter grammar has no `project` or `cycle` field either, so a phone cannot ask `search`
// for them. What it can ask for is `issues(teamId:)` — whole-collection, unpaginated — and
// select client-side. That is the honest path, and it is the same trade ios/README.md made
// for every read: a poll and a bootstrap move comparable bytes. If the grammar ever grows
// the two fields, `ProjectStore` and `CycleStore` are the two places to change.

/// Completion, rolled up over a list of issues the way `IssueProgress` rolls up children:
/// cancelled work is not incomplete work.
public struct WorkProgress: Sendable, Hashable {
    public let total: Int
    public let completed: Int
    public let canceled: Int
    public let started: Int

    public init(issues: [Issue]) {
        total = issues.count
        completed = issues.filter { $0.state.category == .completed }.count
        canceled = issues.filter { $0.state.category == .canceled || $0.state.category == .duplicate }.count
        started = issues.filter { $0.state.category == .started }.count
    }

    /// completed / (total - canceled), rounded, 0–100. Zero when there is nothing to finish.
    public var percent: Int {
        let scope = total - canceled
        guard scope > 0 else { return 0 }
        return Int((Double(completed) / Double(scope) * 100).rounded())
    }

    public var remaining: Int { total - completed - canceled }
}

/// One team: its issues, split the way Linear's team screen splits them, and its cycles.
@MainActor
@Observable
public final class TeamWorkStore {
    public let team: Team
    public private(set) var issues: Loadable<[Issue]> = .idle
    public private(set) var cycles: Loadable<[Cycle]> = .idle
    /// The last refused status change, for the same reason `IssuesStore` keeps one: a row
    /// that snaps back says something went wrong and nothing about what.
    public private(set) var writeError: PolarisError?
    /// The write behind `writeError`, with the `opId` it was sent under — see `PendingWrite`.
    public private(set) var pendingWrite: PendingWrite?

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?
    /// Called with the server's issue once a write from this list lands — see
    /// `AppModel.issueDidChange`.
    public var onWriteConfirmed: (@MainActor (Issue) -> Void)?

    private let api: any PolarisAPI

    public init(api: any PolarisAPI, team: Team) {
        self.api = api
        self.team = team
    }

    /// Both collections at once, each failing on its own: a cycles request that is refused
    /// on a team with cycles switched off must not take the issue list with it.
    public func load() async {
        if issues.value == nil { issues = .loading }
        if cycles.value == nil { cycles = .loading }
        let api = self.api
        let teamId = team.id
        async let fetchedIssues = attempt { try await api.issues(teamId: teamId) }
        async let fetchedCycles = attempt { try await api.cycles(teamId: teamId) }

        switch await fetchedIssues {
        case .success(let list):
            issues = .loaded(IssueOrder.sorted(list))
            // The list the refused write rolled back has just been replaced by the server's
            // own, so the sentence about it no longer describes anything on screen — and
            // neither does the offer to send it again.
            writeError = nil
            pendingWrite = nil
        case .failure(let error):
            let mapped = PolarisError.mapped(error)
            if issues.value == nil { issues = .failed(mapped) }
            report(mapped)
        }
        switch await fetchedCycles {
        case .success(let list):
            cycles = .loaded(list.sorted { $0.number < $1.number })
        case .failure(let error):
            let mapped = PolarisError.mapped(error)
            if cycles.value == nil { cycles = .failed(mapped) }
            report(mapped)
        }
    }

    // MARK: Derived lists. Each is a view over `issues`, in the one order every list keeps.

    public var all: [Issue] { issues.value ?? [] }

    /// Work somebody has committed to: started and unstarted. Not the backlog, not triage,
    /// not what is finished.
    public var active: [Issue] {
        all.filter { $0.state.category == .started || $0.state.category == .unstarted }
    }

    public var backlog: [Issue] { all.filter { $0.state.category == .backlog } }

    public var triage: [Issue] { all.filter { $0.state.category == .triage } }

    public func issues(inCycle cycleId: String) -> [Issue] { all.filter { $0.cycleId == cycleId } }

    public func issues(inProject projectId: String) -> [Issue] { all.filter { $0.projectId == projectId } }

    public func activeCycle(at now: Date = Date()) -> Cycle? {
        cycles.value?.first { $0.isActive(at: now) }
    }

    public func upcomingCycles(at now: Date = Date()) -> [Cycle] {
        (cycles.value ?? []).filter { $0.isUpcoming(at: now) }
    }

    // MARK: Writes

    /// Optimistic status change, as a swipe action calls it.
    public func setState(issueID: String, to state: WorkflowState) async {
        await send(IssueChange(id: issueID, stateId: state.id), applying: state)
    }

    /// Sends the refused write again under the `opId` it already used — see `PendingWrite`.
    public func retryLastWrite() async {
        guard let pending = pendingWrite, pending.isRetryable else { return }
        switch pending.operation {
        case .issue(let change):
            await send(change, applying: nil)
        case .bulk(let edit):
            await bulkApply(edit)
        // Nothing else reaches this store.
        case .comment, .addLabel, .removeLabel:
            break
        }
    }

    /// The first attempt applies the new state ahead of the reply; the retry does not, because
    /// it is the same request and the row has not moved since.
    private func send(_ change: IssueChange, applying state: WorkflowState?) async {
        let issueID = change.id
        guard let list = issues.value, let index = list.firstIndex(where: { $0.id == issueID })
        else {
            // Not in this team's list — the same silent drop `IssuesStore.setState` had, and
            // the same answer: send it anyway rather than eating the tap.
            await writeUnheld(change)
            return
        }
        let original = list[index]
        writeError = nil
        if let state {
            var optimistic = list
            optimistic[index].state = state
            issues = .loaded(IssueOrder.sorted(optimistic))
        }
        do {
            let updated = try await api.updateIssue(change)
            pendingWrite = nil
            replace(updated)
            onWriteConfirmed?(updated)
        } catch {
            replace(original)
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            pendingWrite = PendingWrite(operation: .issue(change), failure: mapped)
            report(mapped)
        }
    }

    /// One change across a selection — see `IssuesStore.bulkApply`, which this mirrors
    /// deliberately rather than sharing: the two stores hold their lists differently and a
    /// shared implementation would have to own both, which is the coupling `IssueWriting`
    /// exists to avoid.
    @discardableResult
    public func bulkApply(_ edit: BulkIssueEdit) async -> BulkIssueResult? {
        let ids = Set(edit.change.ids)
        guard !ids.isEmpty else { return nil }
        writeError = nil
        pendingWrite = nil

        var originals: [String: Issue] = [:]
        if var current = issues.value {
            for index in current.indices where ids.contains(current[index].id) {
                originals[current[index].id] = current[index]
                edit.apply(to: &current[index])
            }
            issues = .loaded(IssueOrder.sorted(current))
        }

        do {
            let result = try await api.bulkUpdateIssues(edit.change)
            for confirmed in result.issues { replace(confirmed) }
            // Only the rows the server declined go back; the rest moved.
            for skip in result.skipped {
                if let original = originals[skip.id] { replace(original) }
            }
            for confirmed in result.issues { onWriteConfirmed?(confirmed) }
            return result
        } catch {
            for original in originals.values { replace(original) }
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            // The whole batch under one `opId`: the server either replays the original block
            // or applies it once, so a retry cannot move a selection twice.
            pendingWrite = PendingWrite(operation: .bulk(edit), failure: mapped)
            report(mapped)
            return nil
        }
    }

    /// The write for an issue this list does not hold: nothing to apply ahead of the reply,
    /// nothing to roll back, and the outcome either fanned out or said out loud.
    private func writeUnheld(_ change: IssueChange) async {
        writeError = nil
        do {
            let updated = try await api.updateIssue(change)
            pendingWrite = nil
            onWriteConfirmed?(updated)
        } catch {
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            pendingWrite = PendingWrite(operation: .issue(change), failure: mapped)
            report(mapped)
        }
    }

    /// Dismisses the refused-write sentence, once the reader has read it, and the offer to
    /// send it again with it.
    public func clearWriteError() {
        writeError = nil
        pendingWrite = nil
    }

    public func merge(_ updated: Issue) {
        // The value this store was asking for, arrived by another route. Nothing to retry.
        if let pending = pendingWrite, pending.operation.isSatisfied(by: updated) {
            pendingWrite = nil
            writeError = nil
        }
        replace(updated)
    }

    /// A cycle edited on its own detail screen, back in this team's list.
    ///
    /// The cycles screen holds this store for the life of the navigation stack and reloads
    /// only on a realtime signal, so a rename made one screen deeper would otherwise still
    /// read as the old name when the reader came back.
    public func apply(_ updated: Cycle) {
        guard var current = cycles.value,
              let index = current.firstIndex(where: { $0.id == updated.id })
        else { return }
        current[index] = updated
        cycles = .loaded(current.sorted { $0.number < $1.number })
    }

    private func replace(_ issue: Issue) {
        guard var current = issues.value,
              let position = current.firstIndex(where: { $0.id == issue.id })
        else { return }
        current[position] = issue
        issues = .loaded(IssueOrder.sorted(current))
    }

    private func report(_ error: PolarisError) {
        if case .unauthorized = error { onUnauthorized?(error) }
    }
}

extension TeamWorkStore: IssueWriting {}

extension ProjectStore: IssueMerging {}

extension CycleStore: IssueMerging {}

/// One project and the issues in it, gathered from every team the project spans.
@MainActor
@Observable
public final class ProjectStore {
    public private(set) var project: Loadable<Project>
    public private(set) var issues: Loadable<[Issue]> = .idle
    /// The last refused edit, for `TeamWorkStore.writeError`'s reason: a sheet that closes
    /// with nothing changed says something went wrong and nothing about what.
    public private(set) var writeError: PolarisError?

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI
    private let projectID: String

    /// Seeded from the row the reader tapped, so the header renders before any request.
    public init(api: any PolarisAPI, project: Project) {
        self.api = api
        self.projectID = project.id
        self.project = .loaded(project)
    }

    public init(api: any PolarisAPI, projectID: String) {
        self.api = api
        self.projectID = projectID
        self.project = .idle
    }

    public func load() async {
        if project.value == nil { project = .loading }
        if issues.value == nil { issues = .loading }
        do {
            let fresh = try await api.project(id: projectID)
            project = .loaded(fresh)
        } catch {
            let mapped = PolarisError.mapped(error)
            if project.value == nil { project = .failed(mapped) }
            report(mapped)
        }
        guard let current = project.value else {
            if issues.value == nil, let error = project.error { issues = .failed(error) }
            return
        }

        // Every team the project belongs to, concurrently; the project's own issues are the
        // ones carrying its id. A project on no team has no issues, by definition.
        let api = self.api
        let id = projectID
        let teamIds = current.teams.map(\.id)
        let gathered = await attempt {
            try await withThrowingTaskGroup(of: [Issue].self) { group in
                for teamId in teamIds {
                    group.addTask { try await api.issues(teamId: teamId) }
                }
                var all: [Issue] = []
                for try await batch in group { all.append(contentsOf: batch) }
                return all.filter { $0.projectId == id }
            }
        }
        switch gathered {
        case .success(let list):
            issues = .loaded(IssueOrder.sorted(list))
        case .failure(let error):
            let mapped = PolarisError.mapped(error)
            if issues.value == nil { issues = .failed(mapped) }
            report(mapped)
        }
    }

    public var progress: WorkProgress { WorkProgress(issues: issues.value ?? []) }

    /// Edits the project and replaces the header's copy with the server's.
    ///
    /// Not optimistic. A project header is a status pill, a lead, a date span and a progress
    /// bar read from a list that did not change; showing a value the server has not accepted
    /// gains nothing and there is nothing on screen to roll back to if it refuses.
    @discardableResult
    public func update(_ change: ProjectChange) async -> Project? {
        writeError = nil
        do {
            let updated = try await api.updateProject(change)
            apply(updated)
            return updated
        } catch {
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            report(mapped)
            return nil
        }
    }

    /// The project as the server now holds it. Ignores anything that is not this project, so
    /// a fan-out cannot replace the header with somebody else's.
    public func apply(_ updated: Project) {
        guard updated.id == projectID else { return }
        project = .loaded(updated)
    }

    public func clearWriteError() {
        writeError = nil
    }

    public func merge(_ updated: Issue) {
        guard var current = issues.value else { return }
        current.removeAll { $0.id == updated.id }
        if updated.projectId == projectID { current.append(updated) }
        issues = .loaded(IssueOrder.sorted(current))
    }

    private func report(_ error: PolarisError) {
        if case .unauthorized = error { onUnauthorized?(error) }
    }
}

/// One cycle and the issues in it, with the counts the cycle header shows.
@MainActor
@Observable
public final class CycleStore {
    public private(set) var cycle: Loadable<Cycle>
    public private(set) var issues: Loadable<[Issue]> = .idle
    /// The last refused edit. It carries the server's own sentence, which for a cycle is the
    /// part that matters: "a cycle that has already started cannot have its start moved" is
    /// the whole explanation, and "something went wrong" is none of it.
    public private(set) var writeError: PolarisError?

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI
    private let cycleID: String

    public init(api: any PolarisAPI, cycle: Cycle) {
        self.api = api
        self.cycleID = cycle.id
        self.cycle = .loaded(cycle)
    }

    public init(api: any PolarisAPI, cycleID: String) {
        self.api = api
        self.cycleID = cycleID
        self.cycle = .idle
    }

    public func load() async {
        if cycle.value == nil { cycle = .loading }
        if issues.value == nil { issues = .loading }
        do {
            cycle = .loaded(try await api.cycle(id: cycleID))
        } catch {
            let mapped = PolarisError.mapped(error)
            if cycle.value == nil { cycle = .failed(mapped) }
            report(mapped)
        }
        guard let current = cycle.value else {
            if issues.value == nil, let error = cycle.error { issues = .failed(error) }
            return
        }
        // A cycle belongs to exactly one team, so one request is the whole gather.
        do {
            let list = try await api.issues(teamId: current.teamId).filter { $0.cycleId == cycleID }
            issues = .loaded(IssueOrder.sorted(list))
        } catch {
            let mapped = PolarisError.mapped(error)
            if issues.value == nil { issues = .failed(mapped) }
            report(mapped)
        }
    }

    public var progress: WorkProgress { WorkProgress(issues: issues.value ?? []) }

    /// Whole days until the cycle ends, clamped at zero. `now` is a parameter so a test does
    /// not depend on the wall clock.
    public func daysRemaining(at now: Date = Date()) -> Int {
        guard let cycle = cycle.value else { return 0 }
        return max(0, Int((cycle.endsAt.timeIntervalSince(now) / 86_400).rounded(.up)))
    }

    /// Renames the cycle or moves one of its ends, and replaces the header with the server's
    /// copy. Not optimistic, for `ProjectStore.update`'s reason.
    @discardableResult
    public func update(_ change: CycleChange) async -> Cycle? {
        writeError = nil
        do {
            let updated = try await api.updateCycle(change)
            apply(updated)
            return updated
        } catch {
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            report(mapped)
            return nil
        }
    }

    /// Starts an upcoming cycle today. Irreversible server-side, so the caller confirms first.
    @discardableResult
    public func startToday(opId: String = UUIDv7.string()) async -> Cycle? {
        writeError = nil
        do {
            let updated = try await api.startCycleToday(id: cycleID, opId: opId)
            apply(updated)
            return updated
        } catch {
            let mapped = PolarisError.mapped(error)
            writeError = mapped
            report(mapped)
            return nil
        }
    }

    /// The cycle as the server now holds it. Ignores anything that is not this cycle.
    public func apply(_ updated: Cycle) {
        guard updated.id == cycleID else { return }
        cycle = .loaded(updated)
    }

    public func clearWriteError() {
        writeError = nil
    }

    public func merge(_ updated: Issue) {
        guard var current = issues.value else { return }
        current.removeAll { $0.id == updated.id }
        if updated.cycleId == cycleID { current.append(updated) }
        issues = .loaded(IssueOrder.sorted(current))
    }

    private func report(_ error: PolarisError) {
        if case .unauthorized = error { onUnauthorized?(error) }
    }
}
