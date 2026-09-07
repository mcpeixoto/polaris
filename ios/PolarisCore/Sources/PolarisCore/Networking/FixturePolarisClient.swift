import Foundation

/// An in-memory Polaris, for tests and SwiftUI previews.
///
/// The second implementation the protocol exists for. It holds the same shapes the live client
/// decodes, so a store driven by it exercises the real code path — sorting, optimistic writes,
/// rollback — without a server, a socket or a simulator.
///
/// `failNextWrite` is why this is an actor with mutable state rather than a struct of
/// constants: the behaviour most worth testing is what happens when a write *fails*, and that
/// is impossible to provoke against a real server without breaking one.
public actor FixturePolarisClient: PolarisAPI {
    public private(set) var storedIssues: [Issue]
    /// Sub-issues, kept apart from `storedIssues` on purpose. The default list is exactly the
    /// four rows the UI tests count, so the children of ENG-1 are reachable through
    /// `issueDetail` and `issue(id:)` but never appear in a team or My-issues list.
    public private(set) var storedChildren: [Issue]
    public private(set) var storedComments: [String: [Comment]]
    public private(set) var storedNotifications: [PolarisNotification]
    public private(set) var storedLabels: [Label]
    public private(set) var storedProjects: [Project]
    public private(set) var storedProjectStatuses: [ProjectStatus]
    public private(set) var storedCycles: [Cycle]
    public private(set) var storedFavorites: [Favorite]
    public private(set) var storedAttachments: [String: [Attachment]]
    public private(set) var storedRelations: [IssueRelation]
    public private(set) var storedSubscriptions: [String: [IssueSubscription]]
    public private(set) var storedHistory: [String: [IssueHistoryEntry]]
    public private(set) var storedPrefs: NotificationPrefs
    /// Comments already accepted, keyed by the caller's `opId`. The server is idempotent on
    /// this key and so is the double, because a retry posting twice is the bug the key exists
    /// to prevent.
    private var commentsByOpId: [String: Comment] = [:]
    /// Same rule for issues: a retried `createIssue` with the same `opId` is the same issue.
    private var issuesByOpId: [String: Issue] = [:]
    private var people: [User]
    private let allTeams: [Team]
    private let states: [WorkflowState]

    /// When set, the next mutation throws this instead of applying. Cleared once it fires, so
    /// a test can assert both the failure and the recovery.
    private var failNextWrite: PolarisError?

    /// Whether the boot path finds a session. False makes the auth screens reachable, which
    /// they otherwise are not: `signInWithDevSession` always succeeding meant the app went
    /// straight to the issue list and welcome/sign-in/sign-up could not be driven at all.
    private let signedIn: Bool

    /// Whether that session belongs to a workspace. False is the state every first
    /// registration lands in, and the only route to the create-workspace screen.
    private let hasWorkspace: Bool

    public init(
        signedIn: Bool = true,
        hasWorkspace: Bool = true,
        issues: [Issue] = FixtureData.issues,
        people: [User] = FixtureData.users,
        teams: [Team] = [FixtureData.team],
        states: [WorkflowState] = FixtureData.states,
        comments: [String: [Comment]] = FixtureData.comments,
        notifications: [PolarisNotification] = FixtureData.notifications,
        children: [Issue] = FixtureData.children,
        labels: [Label] = FixtureData.labels,
        projects: [Project] = FixtureData.projects,
        projectStatuses: [ProjectStatus] = FixtureData.projectStatuses,
        cycles: [Cycle] = FixtureData.cycles,
        favorites: [Favorite] = FixtureData.favorites,
        attachments: [String: [Attachment]] = FixtureData.attachments,
        relations: [IssueRelation] = FixtureData.relations,
        subscriptions: [String: [IssueSubscription]] = FixtureData.subscriptions,
        history: [String: [IssueHistoryEntry]] = FixtureData.history,
        notificationPrefs: NotificationPrefs = FixtureData.notificationPrefs
    ) {
        self.signedIn = signedIn
        self.hasWorkspace = hasWorkspace
        self.storedIssues = issues
        self.people = people
        self.allTeams = teams
        self.states = states
        self.storedComments = comments
        self.storedNotifications = notifications
        // The children only make sense beside the parent they hang off. A test that hands in
        // its own issue list gets no strays from the stock one.
        self.storedChildren = children.filter { child in
            issues.contains { $0.id == child.parentId }
        }
        self.storedLabels = labels
        self.storedProjects = projects
        self.storedProjectStatuses = projectStatuses
        self.storedCycles = cycles
        self.storedFavorites = favorites
        self.storedAttachments = attachments
        self.storedRelations = relations
        self.storedSubscriptions = subscriptions
        self.storedHistory = history
        self.storedPrefs = notificationPrefs
        if let armed = QAFixtureSwitches.armedWriteFailure { self.failNextWrite = armed }
    }

    public func setFailNextWrite(_ error: PolarisError?) {
        failNextWrite = error
    }

    private func consumeFailure() throws {
        if let failNextWrite {
            self.failNextWrite = nil
            throw failNextWrite
        }
    }

    // MARK: - Auth

    public func signInWithDevSession() async throws -> Session {
        guard signedIn else { throw PolarisError.forbidden }
        return session()
    }

    private func session() -> Session {
        Session(
            accessToken: "fixture",
            expiresIn: 900,
            accountId: "account",
            // No workspaces is what puts AppModel into `.needsWorkspace`.
            workspaces: hasWorkspace ? [FixtureData.workspace] : []
        )
    }

    public func signIn(email: String, password: String) async throws -> Session {
        guard password == "correct-horse" else {
            throw PolarisError.unauthorized("incorrect email or password")
        }
        return session()
    }

    public func signInWithApple(
        idToken: String,
        nonce: String,
        displayName: String?
    ) async throws -> Session {
        // The fixture cannot verify anything, so it stands in for the one thing the screen
        // has to handle: an assertion arrives, or it does not. An empty token is what a
        // cancelled or failed authorisation looks like by the time it reaches here.
        guard !idToken.isEmpty else {
            throw PolarisError.unauthorized("that sign-in could not be verified")
        }
        return session()
    }

    public func signInWithGoogle(
        idToken: String,
        nonce: String,
        displayName: String?
    ) async throws -> Session {
        // Same standing-in as Apple's: an assertion arrived, or it did not.
        guard !idToken.isEmpty else {
            throw PolarisError.unauthorized("that sign-in could not be verified")
        }
        return session()
    }

    /// Both, so the fixture app draws the buttons a fully-configured server would. The UI
    /// tests run against this client and are the only place the Google button is ever
    /// exercised without a real Google account.
    public func authProviders() async throws -> AuthProviders {
        AuthProviders(providers: ["google", "apple"], openSignup: true)
    }

    public func register(
        email: String,
        password: String,
        inviteToken: String?,
        displayName: String?
    ) async throws -> Session {
        guard password.count >= 8 else {
            throw PolarisError.validation(message: "Password must be at least 8 characters", field: "password")
        }
        return session()
    }

    public func createWorkspace(_ draft: WorkspaceDraft) async throws -> Workspace {
        try consumeFailure()
        return FixtureData.workspace
    }

    public func restoreSession() async throws -> Session {
        throw PolarisError.unauthorized(nil)
    }

    @discardableResult
    public func signOut() async -> PolarisError? { nil }
    public func useWorkspace(id: String) async {}

    // MARK: - Reads

    public func viewer() async throws -> Viewer {
        Viewer(
            user: people[0],
            workspace: FixtureData.workspace,
            workspaces: [FixtureData.workspace],
            syncVersion: 1
        )
    }

    public func syncVersion() async throws -> Int { 1 }

    public func myIssues(includeCompleted: Bool) async throws -> [Issue] {
        includeCompleted ? storedIssues : storedIssues.filter { $0.state.category.isOpen }
    }

    public func myIssues(scope: MyIssuesScope, includeCompleted: Bool) async throws -> [Issue] {
        let me = people[0].id
        let picked: [Issue]
        switch scope {
        case .assigned:
            return try await myIssues(includeCompleted: includeCompleted)
        case .created:
            picked = storedIssues.filter { $0.creator?.id == me }
        case .subscribed:
            picked = storedIssues.filter { issue in
                (storedSubscriptions[issue.id] ?? []).contains { $0.userId == me && $0.isActive }
            }
        }
        return includeCompleted ? picked : picked.filter { $0.state.category.isOpen }
    }

    public func issues(teamId: String) async throws -> [Issue] {
        storedIssues.filter { $0.team.id == teamId }
    }

    public func issue(id: String) async throws -> Issue {
        guard let match = storedIssues.first(where: { $0.id == id })
            ?? storedChildren.first(where: { $0.id == id })
        else { throw PolarisError.notFound }
        return match
    }

    public func issueByIdentifier(_ identifier: String) async throws -> Issue {
        let wanted = identifier.uppercased()
        guard let match = (storedIssues + storedChildren).first(where: { $0.identifier == wanted }) else {
            throw PolarisError.notFound
        }
        return match
    }

    public func issueDetail(id: String) async throws -> IssueDetail {
        let issue = try await issue(id: id)
        return IssueDetail(
            issue: issue,
            children: storedChildren.filter { $0.parentId == id },
            attachments: storedAttachments[id] ?? [],
            relations: storedRelations.filter { $0.issue?.id == id },
            // The same rows read from the other end, as the server does it.
            blockedBy: storedRelations.filter { $0.relatedIssue.id == id && $0.type == .blocks },
            subscribers: storedSubscriptions[id] ?? []
        )
    }

    public func issueHistory(issueId: String) async throws -> [IssueHistoryEntry] {
        storedHistory[issueId] ?? []
    }

    public func comments(issueId: String) async throws -> [Comment] {
        storedComments[issueId] ?? []
    }

    public func teams() async throws -> [Team] { allTeams }
    public func workflowStates(teamId: String) async throws -> [WorkflowState] {
        QAFixtureSwitches.noStates ? [] : states
    }
    public func users() async throws -> [User] { people }
    public func labels() async throws -> [Label] { storedLabels }
    public func projects() async throws -> [Project] { storedProjects }
    public func projectStatuses() async throws -> [ProjectStatus] { storedProjectStatuses }

    public func project(id: String) async throws -> Project {
        guard let match = storedProjects.first(where: { $0.id == id }) else { throw PolarisError.notFound }
        return match
    }

    public func cycles(teamId: String) async throws -> [Cycle] {
        storedCycles.filter { $0.teamId == teamId }
    }

    public func cycle(id: String) async throws -> Cycle {
        guard let match = storedCycles.first(where: { $0.id == id }) else { throw PolarisError.notFound }
        return match
    }

    public func favorites() async throws -> [Favorite] { storedFavorites }
    public func notificationPrefs() async throws -> NotificationPrefs { storedPrefs }

    public func unreadNotificationCount() async throws -> Int {
        storedNotifications.filter { !$0.isRead }.count
    }

    public func notifications(
        includeRead: Bool,
        includeSnoozed: Bool,
        first: Int?
    ) async throws -> [PolarisNotification] {
        var list = storedNotifications
        if !includeRead { list = list.filter { !$0.isRead } }
        if !includeSnoozed { list = list.filter { $0.snoozedUntil == nil } }
        list.sort { $0.createdAt > $1.createdAt }
        if let first { list = Array(list.prefix(first)) }
        return list
    }

    /// Substring matching over title, identifier and description.
    ///
    /// Not the server's tokeniser and not pretending to be: what a double owes a search screen
    /// is that a query narrows the list, that an empty result set is reachable, and that
    /// `issueCount` and `issues.count` can disagree — all three of which drive a branch in the
    /// UI.
    public func search(query: String, teamId: String?, first: Int?) async throws -> SearchResults {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return SearchResults(issues: [], issueCount: 0) }
        var hits = storedIssues.filter { issue in
            issue.title.lowercased().contains(needle)
                || issue.identifier.lowercased().contains(needle)
                || issue.description.lowercased().contains(needle)
        }
        if let teamId { hits = hits.filter { $0.team.id == teamId } }
        let total = hits.count
        if let first { hits = Array(hits.prefix(first)) }
        return SearchResults(issues: hits, issueCount: total)
    }

    /// The filter is accepted and ignored: the double has no evaluator for the grammar, and
    /// pretending to have one would let a store pass against a filter the server refuses.
    public func search(query: String, teamId: String?, first: Int?, filter: JSONValue?) async throws -> SearchResults {
        try await search(query: query, teamId: teamId, first: first)
    }

    // MARK: - Writes

    public func createIssue(_ draft: IssueDraft) async throws -> Issue {
        if let existing = issuesByOpId[draft.opId] { return existing }
        try consumeFailure()
        let parent = draft.parentId.flatMap { id in storedIssues.first { $0.id == id } }
        let created = FixtureData.issue(
            id: draft.id,
            // Top-level issues count up from the list, as the UI tests expect; sub-issues
            // continue from ENG-92 so the two sequences never meet.
            identifier: parent == nil ? "ENG-\(storedIssues.count + 1)" : "ENG-\(90 + storedChildren.count + 1)",
            title: draft.title,
            priority: draft.priority,
            state: states.first(where: { $0.id == draft.stateId }) ?? states[0],
            // Honoured, not dropped. The composer defaults to assigning the issue to the
            // creator precisely because MyIssues filters on assignee — a double that ignores
            // the field cannot show whether that default works, which is the whole point of
            // the test that exercises it.
            assignee: draft.assigneeId.flatMap { id in people.first { $0.id == id } },
            creator: people[0],
            description: draft.description,
            labels: storedLabels.filter { draft.labelIds.contains($0.id) },
            estimate: draft.estimate,
            dueDate: draft.dueDate,
            parent: parent?.ref,
            project: draft.projectId.flatMap { id in storedProjects.first { $0.id == id } }?.ref,
            cycle: draft.cycleId.flatMap { id in storedCycles.first { $0.id == id } }?.ref
        )
        issuesByOpId[draft.opId] = created
        // A sub-issue joins the parent's children, not the lists — see `storedChildren`.
        if parent != nil {
            storedChildren.append(created)
        } else {
            storedIssues.append(created)
        }
        return created
    }

    public func updateIssue(_ change: IssueChange) async throws -> Issue {
        try consumeFailure()
        // Mutated, not rebuilt. Rebuilding through FixtureData.issue silently dropped
        // description, labels, estimate, dueDate and timestamps, so any property change made
        // the description vanish — which reads as a product bug and is a defect in the double.
        return try mutateIssue(id: change.id) { updated in
            if let title = change.title { updated.title = title }
            if let description = change.description { updated.description = description }
            if let stateId = change.stateId, let next = states.first(where: { $0.id == stateId }) {
                updated.state = next
            }
            if let priority = change.priority {
                updated.priority = priority
            }
            if change.clearAssignee {
                updated.assignee = nil
            } else if let assigneeId = change.assigneeId {
                updated.assignee = people.first { $0.id == assigneeId }
            }
            if change.clearEstimate { updated.estimate = nil } else if let estimate = change.estimate {
                updated.estimate = estimate
            }
            if change.clearDueDate { updated.dueDate = nil } else if let dueDate = change.dueDate {
                updated.dueDate = dueDate
            }
            if change.clearParent {
                updated.parentId = nil
                updated.parent = nil
            } else if let parentId = change.parentId {
                updated.parentId = parentId
                updated.parent = storedIssues.first { $0.id == parentId }?.ref
            }
            if change.clearProject {
                updated.projectId = nil
                updated.project = nil
            } else if let projectId = change.projectId {
                updated.projectId = projectId
                updated.project = storedProjects.first { $0.id == projectId }?.ref
            }
            if change.clearCycle {
                updated.cycleId = nil
                updated.cycle = nil
            } else if let cycleId = change.cycleId {
                updated.cycleId = cycleId
                updated.cycle = storedCycles.first { $0.id == cycleId }?.ref
            }
        }
    }

    /// Applies an edit to an issue wherever it is held and hands back the result.
    private func mutateIssue(id: String, _ edit: (inout Issue) -> Void) throws -> Issue {
        if let index = storedIssues.firstIndex(where: { $0.id == id }) {
            var updated = storedIssues[index]
            edit(&updated)
            storedIssues[index] = updated
            return updated
        }
        if let index = storedChildren.firstIndex(where: { $0.id == id }) {
            var updated = storedChildren[index]
            edit(&updated)
            storedChildren[index] = updated
            return updated
        }
        throw PolarisError.notFound
    }

    /// Idempotent on `opId`, like the server.
    ///
    /// Without this the double cannot show the difference the fix is about: a retry with the
    /// same `opId` must return the original comment, not append a second one.
    public func createComment(issueId: String, body: String, opId: String) async throws -> Comment {
        if let existing = commentsByOpId[opId] { return existing }
        try consumeFailure()
        let comment = FixtureData.comment(body: body)
        commentsByOpId[opId] = comment
        storedComments[issueId, default: []].append(comment)
        return comment
    }

    public func updateComment(id: String, body: String, opId: String) async throws -> Comment {
        try consumeFailure()
        for (issueId, list) in storedComments {
            guard let index = list.firstIndex(where: { $0.id == id }) else { continue }
            var updated = list[index]
            updated.body = body
            updated.editedAt = Date()
            storedComments[issueId]?[index] = updated
            return updated
        }
        throw PolarisError.notFound
    }

    public func deleteComment(id: String, opId: String) async throws {
        try consumeFailure()
        for (issueId, list) in storedComments where list.contains(where: { $0.id == id }) {
            storedComments[issueId]?.removeAll { $0.id == id }
            return
        }
        throw PolarisError.notFound
    }

    /// Adding an emoji already there is a no-op that returns it, as the schema promises.
    public func addReaction(commentId: String, emoji: String, opId: String) async throws -> Reaction {
        let me = people[0].id
        for (issueId, list) in storedComments {
            guard let index = list.firstIndex(where: { $0.id == commentId }) else { continue }
            if let existing = list[index].reactions.first(where: { $0.emoji == emoji && $0.userId == me }) {
                return existing
            }
            try consumeFailure()
            let reaction = Reaction(
                id: UUIDv7.string(), commentId: commentId, userId: me, emoji: emoji, createdAt: Date()
            )
            storedComments[issueId]?[index].reactions.append(reaction)
            return reaction
        }
        throw PolarisError.notFound
    }

    public func removeReaction(commentId: String, emoji: String, opId: String) async throws {
        try consumeFailure()
        let me = people[0].id
        for (issueId, list) in storedComments {
            guard let index = list.firstIndex(where: { $0.id == commentId }) else { continue }
            storedComments[issueId]?[index].reactions.removeAll { $0.emoji == emoji && $0.userId == me }
            return
        }
        throw PolarisError.notFound
    }

    public func archiveIssue(id: String, archived: Bool, opId: String) async throws {
        try consumeFailure()
        guard let index = storedIssues.firstIndex(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        if archived { storedIssues.remove(at: index) }
    }

    public func deleteIssue(id: String, opId: String) async throws {
        try consumeFailure()
        if let index = storedIssues.firstIndex(where: { $0.id == id }) {
            storedIssues.remove(at: index)
            // Sub-issues are orphaned rather than deleted — `parent_id` is ON DELETE SET NULL.
            storedChildren = storedChildren.map { child in
                guard child.parentId == id else { return child }
                var orphan = child
                orphan.parentId = nil
                orphan.parent = nil
                return orphan
            }
            return
        }
        if let index = storedChildren.firstIndex(where: { $0.id == id }) {
            storedChildren.remove(at: index)
            return
        }
        throw PolarisError.notFound
    }

    public func addIssueLabel(issueId: String, labelId: String, opId: String) async throws -> Label {
        guard let label = storedLabels.first(where: { $0.id == labelId }) else { throw PolarisError.notFound }
        let current = try await issue(id: issueId)
        // Already there is a success, not a duplicate — an upsert of one row server-side.
        if current.labels.contains(where: { $0.id == labelId }) { return label }
        try consumeFailure()
        _ = try mutateIssue(id: issueId) { $0.labels.append(label) }
        return label
    }

    public func removeIssueLabel(issueId: String, labelId: String, opId: String) async throws {
        try consumeFailure()
        _ = try mutateIssue(id: issueId) { $0.labels.removeAll { $0.id == labelId } }
    }

    public func setIssueSubscription(issueId: String, subscribed: Bool) async throws -> IssueSubscription {
        try consumeFailure()
        _ = try await issue(id: issueId)
        let me = people[0].id
        var rows = storedSubscriptions[issueId] ?? []
        rows.removeAll { $0.userId == me }
        // An unsubscribe is a flagged row, not a missing one — otherwise the next comment
        // would re-subscribe the reader, as the schema comment warns.
        let row = IssueSubscription(userId: me, unsubscribed: !subscribed, reason: "MANUAL")
        rows.append(row)
        storedSubscriptions[issueId] = rows
        return row
    }

    public func acceptTriageIssue(id: String, opId: String) async throws -> Issue {
        try consumeFailure()
        guard let target = states.first(where: { $0.category == .unstarted }) ?? states.first else {
            throw PolarisError.validation(message: "This team has no status to accept into", field: nil)
        }
        return try mutateIssue(id: id) { $0.state = target }
    }

    public func declineTriageIssue(id: String, opId: String) async throws -> Issue {
        try consumeFailure()
        guard let target = states.first(where: { $0.category == .canceled })
            ?? states.first(where: { !$0.category.isOpen })
        else {
            throw PolarisError.validation(message: "This team has no status to decline into", field: nil)
        }
        return try mutateIssue(id: id) { $0.state = target }
    }

    public func createIssueRelation(
        issueId: String,
        relatedIssueId: String,
        type: RelationType,
        opId: String
    ) async throws -> IssueRelation {
        let subject = try await issue(id: issueId)
        let object = try await issue(id: relatedIssueId)
        if let existing = storedRelations.first(where: {
            $0.issue?.id == issueId && $0.relatedIssue.id == relatedIssueId && $0.type == type
        }) { return existing }
        try consumeFailure()
        let relation = IssueRelation(id: UUIDv7.string(), type: type, issue: subject.ref, relatedIssue: object.ref)
        storedRelations.append(relation)
        return relation
    }

    public func deleteIssueRelation(id: String, opId: String) async throws {
        try consumeFailure()
        guard storedRelations.contains(where: { $0.id == id }) else { throw PolarisError.notFound }
        storedRelations.removeAll { $0.id == id }
    }

    /// URL-idempotent, like the server: the same URL on the same issue is one card.
    public func createAttachment(issueId: String, url: String, title: String?, opId: String) async throws -> Attachment {
        _ = try await issue(id: issueId)
        if let existing = (storedAttachments[issueId] ?? []).first(where: { $0.url == url }) { return existing }
        try consumeFailure()
        let attachment = Attachment(
            id: UUIDv7.string(),
            url: url,
            title: title?.isEmpty == false ? title! : url,
            subtitle: nil,
            iconUrl: nil,
            createdAt: Date()
        )
        storedAttachments[issueId, default: []].append(attachment)
        return attachment
    }

    public func addFavorite(kind: FavoriteKind, targetId: String) async throws -> Favorite {
        if let existing = storedFavorites.first(where: { $0.kind == kind && $0.targetId == targetId }) {
            return existing
        }
        try consumeFailure()
        let favorite = Favorite(id: UUIDv7.string(), kind: kind, targetId: targetId, name: nil)
        storedFavorites.append(favorite)
        return favorite
    }

    public func removeFavorite(kind: FavoriteKind, targetId: String) async throws {
        try consumeFailure()
        storedFavorites.removeAll { $0.kind == kind && $0.targetId == targetId }
    }

    public func updateProfile(_ change: ProfileChange) async throws -> User {
        try consumeFailure()
        let current = people[0]
        let updated = FixtureData.user(
            id: current.id,
            name: change.name ?? current.name,
            displayName: change.displayName ?? current.displayName,
            avatarUrl: change.avatarUrl ?? current.avatarUrl,
            email: current.email
        )
        people[0] = updated
        return updated
    }

    public func updateNotificationPrefs(_ prefs: NotificationPrefs) async throws -> NotificationPrefs {
        try consumeFailure()
        storedPrefs = prefs
        return prefs
    }

    public func markNotificationRead(id: String, read: Bool) async throws -> PolarisNotification {
        try consumeFailure()
        guard let index = storedNotifications.firstIndex(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        var updated = storedNotifications[index]
        updated.readAt = read ? Date() : nil
        storedNotifications[index] = updated
        return updated
    }

    public func snoozeNotification(id: String, until: Date?) async throws -> PolarisNotification {
        try consumeFailure()
        guard let index = storedNotifications.firstIndex(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        var updated = storedNotifications[index]
        updated.snoozedUntil = until
        storedNotifications[index] = updated
        return updated
    }

    public func deleteNotification(id: String) async throws {
        try consumeFailure()
        guard storedNotifications.contains(where: { $0.id == id }) else {
            throw PolarisError.notFound
        }
        storedNotifications.removeAll { $0.id == id }
    }

    // MARK: - Sync socket

    public func accessToken() async throws -> String { "fixture" }
    public nonisolated func syncSocketURL() -> URL { PolarisEnvironment.localDevelopment.syncSocketURL }
}

/// Canned entities.
///
/// Built by decoding JSON rather than by memberwise initialisers, deliberately: the wire types
/// decode from JSON in production and several have a custom `init(from:)` with defaulting
/// behaviour. Fixtures built any other way would not exercise that code, and would keep
/// passing after a decoding bug was introduced.
public enum FixtureData {
    public static let workspace: Workspace = decoded(
        "{\"id\":\"w1\",\"name\":\"\(QAFixtureSwitches.workspaceName)\","
            + "\"urlKey\":\"\(QAFixtureSwitches.workspaceKey)\",\"plan\":\"\(QAFixtureSwitches.plan)\"}"
    )

    // Delimited with ##"…"## rather than #"…"#: the colour value starts with `#` directly
    // after a quote, and `"#` would otherwise close the literal in the middle of the JSON.
    public static let team: Team = decoded(
        ##"{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF","triageEnabled":true,"cyclesEnabled":true}"##
    )

    /// The four original states keep their indices — fixtures address them by position — and
    /// the two the parity screens need come after: Triage sorts first by position and
    /// Canceled last, which is where a picker ordered by position puts them.
    public static let states: [WorkflowState] = decoded("""
    [{"id":"s1","name":"Backlog","color":"#9AA0A6","category":"BACKLOG","position":"a"},
     {"id":"s2","name":"Todo","color":"#9AA0A6","category":"UNSTARTED","position":"b"},
     {"id":"s3","name":"In Progress","color":"#F5B700","category":"STARTED","position":"c"},
     {"id":"s4","name":"Done","color":"#3FB950","category":"COMPLETED","position":"d"},
     {"id":"s5","name":"Triage","color":"#B65BEF","category":"TRIAGE","position":"0"},
     {"id":"s6","name":"Canceled","color":"#8A8F98","category":"CANCELED","position":"e"}]
    """)

    public static let users: [User] = decoded("""
    [{"id":"u1","name":"miguel","displayName":"Miguel Peixoto","avatarUrl":null,"email":"dev@polaris.local"},
     {"id":"u2","name":"ana","displayName":"Ana Silva","avatarUrl":null,"email":null}]
    """)

    public static func user(id: String, name: String, displayName: String, avatarUrl: String?, email: String?) -> User {
        decoded("""
        {"id":"\(id)","name":"\(name)","displayName":"\(displayName)",
         "avatarUrl":\(avatarUrl.map { "\"\($0)\"" } ?? "null"),"email":\(email.map { "\"\($0)\"" } ?? "null")}
        """)
    }

    /// Five workspace labels — `teamId` null — so every team's picker offers them.
    public static let labels: [Label] = decoded("""
    [{"id":"lab1","name":"backend","color":"#5B8DEF","teamId":null,"parentId":null,"isGroup":false},
     {"id":"lab2","name":"needs-design","color":"#F5B700","teamId":null,"parentId":null,"isGroup":false},
     {"id":"lab3","name":"regression","color":"#3FB950","teamId":null,"parentId":null,"isGroup":false},
     {"id":"lab4","name":"customer-reported","color":"#EF5B5B","teamId":null,"parentId":null,"isGroup":false},
     {"id":"lab5","name":"p0-escalation","color":"#B65BEF","teamId":null,"parentId":null,"isGroup":false}]
    """)

    public static let projectStatuses: [ProjectStatus] = decoded("""
    [{"id":"ps1","name":"Backlog","color":"#9AA0A6","category":"BACKLOG"},
     {"id":"ps2","name":"Planned","color":"#5B8DEF","category":"PLANNED"},
     {"id":"ps3","name":"In Progress","color":"#F5B700","category":"STARTED"},
     {"id":"ps4","name":"Completed","color":"#3FB950","category":"COMPLETED"},
     {"id":"ps5","name":"Canceled","color":"#8A8F98","category":"CANCELED"}]
    """)

    public static let projects: [Project] = decoded("""
    [{"id":"p1","name":"Mobile parity","summary":"Everything the phone can do that the web can.",
      "description":"","icon":"iphone","color":"#5B8DEF","priority":2,"leadId":"u1",
      "startDate":"2026-08-01","targetDate":"2026-10-15",
      "status":{"id":"ps3","name":"In Progress","color":"#F5B700","category":"STARTED"},
      "lead":{"id":"u1","name":"miguel","displayName":"Miguel Peixoto","avatarUrl":null,"email":"dev@polaris.local"},
      "teams":[{"team":{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF","triageEnabled":true,"cyclesEnabled":true}}],
      "milestones":[{"id":"m1","name":"Issue detail","targetDate":"2026-09-20"},
                    {"id":"m2","name":"Projects and cycles","targetDate":"2026-10-10"}]},
     {"id":"p2","name":"Sync v2","summary":null,"description":"Replace the poll with the delta stream.",
      "icon":null,"color":"#B65BEF","priority":3,"leadId":"u2",
      "startDate":null,"targetDate":"2026-12-01",
      "status":{"id":"ps2","name":"Planned","color":"#5B8DEF","category":"PLANNED"},
      "lead":{"id":"u2","name":"ana","displayName":"Ana Silva","avatarUrl":null,"email":null},
      "teams":[{"team":{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF","triageEnabled":true,"cyclesEnabled":true}}],
      "milestones":[]}]
    """)

    /// One cycle running now and one after it. Dated relative to the clock rather than fixed,
    /// because "active" is a property of today and a fixture pinned to a week in August is a
    /// fixture that stops being active in September.
    public static let cycles: [Cycle] = {
        let day: TimeInterval = 86_400
        let now = Date()
        func at(_ days: Double) -> String { PolarisJSON.rfc3339(now.addingTimeInterval(days * day)) }
        return decoded("""
        [{"id":"cy1","teamId":"t1","number":7,"name":"","description":"Ship the detail screen.",
          "startsAt":"\(at(-7))","endsAt":"\(at(7))","completedAt":null},
         {"id":"cy2","teamId":"t1","number":8,"name":"Hardening","description":null,
          "startsAt":"\(at(7))","endsAt":"\(at(21))","completedAt":null}]
        """)
    }()

    public static let activeCycle: Cycle = cycles[0]
    public static let upcomingCycle: Cycle = cycles[1]

    /// The issue set, selected by launch argument.
    ///
    /// With no `-qa-*` argument this is the original four issues, so ordinary runs are
    /// unaffected. Statics are lazy in Swift, so this reads the arguments after the process
    /// has them.
    public static let issues: [Issue] = {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-qa-empty") { return [] }
        if arguments.contains("-qa-only-completed") { return completedOnlyIssues }
        if arguments.contains("-qa-stress") { return stressIssues }
        return baseIssues
    }()

    /// Exactly four rows, with the identifiers, titles, priorities, states and assignees the
    /// UI tests count on. ENG-1 additionally carries everything a detail screen can show —
    /// a project, the running cycle, labels, a due date, an estimate and a sub-issue
    /// roll-up — so that screen has something to render without a second fixture.
    public static let baseIssues: [Issue] = [
        issue(id: "i1", identifier: "ENG-1", title: "Sync drops a comment on reconnect",
              priority: .urgent, state: states[2], assignee: users[0], creator: users[1],
              labels: [labels[0], labels[2]], estimate: 3, dueDate: "2026-09-12",
              project: projects[0].ref, cycle: activeCycle.ref,
              progress: IssueProgress(total: 2, completed: 1, canceled: 0, percent: 50)),
        issue(id: "i2", identifier: "ENG-2", title: "Command menu forgets its last action",
              priority: .medium, state: states[1], creator: users[0]),
        issue(id: "i3", identifier: "ENG-3", title: "Ship the iOS client",
              priority: .high, state: states[0], assignee: users[1], creator: users[0],
              project: projects[0].ref),
        issue(id: "i4", identifier: "ENG-4", title: "Retire the old exporter",
              priority: Priority.none, state: states[3], creator: users[1]),
    ]

    /// ENG-1's sub-issues. Numbered well clear of what `createIssue` mints, which counts up
    /// from the list length.
    public static let children: [Issue] = [
        issue(id: "i1a", identifier: "ENG-91", title: "Replay the outbox against the server watermark",
              priority: .high, state: states[3], assignee: users[0], creator: users[0],
              parent: baseIssues[0].ref, cycle: activeCycle.ref),
        issue(id: "i1b", identifier: "ENG-92", title: "Add a reconnect integration test",
              priority: .medium, state: states[1], assignee: users[1], creator: users[0],
              parent: baseIssues[0].ref),
    ]

    public static let attachments: [String: [Attachment]] = [
        "i1": [decoded("""
        {"id":"att1","url":"https://github.com/peixotolabs/polaris/pull/481",
         "title":"Pull request #481","subtitle":"peixotolabs/polaris","iconUrl":null,
         "createdAt":"2026-08-19T12:00:00Z"}
        """)],
    ]

    /// ENG-1 blocks ENG-2: one row, which the detail of ENG-1 lists under `relations` and
    /// the detail of ENG-2 under `blockedBy`.
    public static let relations: [IssueRelation] = [
        decoded("""
        {"id":"rel1","type":"BLOCKS",
         "issue":{"id":"i1","identifier":"ENG-1","title":"Sync drops a comment on reconnect"},
         "relatedIssue":{"id":"i2","identifier":"ENG-2","title":"Command menu forgets its last action"}}
        """),
    ]

    /// Who follows what. ENG-3 carries an explicit opt-out, so the "subscribed" scope has a
    /// row it must leave out.
    public static let subscriptions: [String: [IssueSubscription]] = [
        "i1": [
            IssueSubscription(userId: "u1", unsubscribed: false, reason: "ASSIGNED"),
            IssueSubscription(userId: "u2", unsubscribed: false, reason: "CREATED"),
        ],
        "i2": [IssueSubscription(userId: "u1", unsubscribed: false, reason: "MANUAL")],
        "i3": [IssueSubscription(userId: "u1", unsubscribed: true, reason: "SUBSCRIBED")],
    ]

    public static let history: [String: [IssueHistoryEntry]] = [
        "i1": decoded("""
        [{"id":"h1","kind":"created","actor":{"type":"USER","id":"u2"},
          "fromValue":null,"toValue":null,"createdAt":"2026-08-01T09:00:00Z"},
         {"id":"h2","kind":"state","actor":{"type":"USER","id":"u1"},
          "fromValue":{"id":"s2","name":"Todo"},"toValue":{"id":"s3","name":"In Progress"},
          "createdAt":"2026-08-19T13:00:00Z"},
         {"id":"h3","kind":"assignee","actor":{"type":"USER","id":"u2"},
          "fromValue":null,"toValue":"u1","createdAt":"2026-08-20T09:00:00Z"}]
        """),
    ]

    /// The stock comments: whatever `-qa-comments` seeds on ENG-1, plus one on ENG-2 that
    /// carries a reaction. ENG-1 stays empty by default because the detail tests post into
    /// it and count what they posted.
    public static let comments: [String: [Comment]] = {
        var all = QAFixtureSwitches.seededComments
        all["i2", default: []].append(decoded("""
        {"id":"c-eng2","body":"Repro: open the menu, run anything, reopen — the last action is gone.",
         "actor":{"type":"USER","id":"u2"},"editedAt":null,"createdAt":"2026-08-21T10:00:00Z",
         "parentId":null,"resolvedAt":null,
         "reactions":[{"id":"r1","commentId":"c-eng2","userId":"u1","emoji":"👍","createdAt":"2026-08-21T10:05:00Z"}]}
        """))
        return all
    }()

    public static let favorites: [Favorite] = [
        Favorite(id: "fav1", kind: .issue, targetId: "i3", name: nil),
    ]

    public static let notificationPrefs = NotificationPrefs(
        muted: ["PULSE_DIGEST"], emailDigest: "daily", emailPerNotification: false, desktop: nil
    )

    /// Everything assigned is finished, so the default filter renders an empty list.
    public static let completedOnlyIssues: [Issue] = [
        issue(id: "c1", identifier: "ENG-1", title: "Retire the old exporter",
              priority: .high, state: states[3], assignee: users[0]),
        issue(id: "c2", identifier: "ENG-2", title: "Delete the dead feature flag",
              priority: Priority.none, state: states[3], assignee: users[0]),
    ]

    /// Volume plus the layout edge cases: a title far past two lines, five labels where the
    /// row shows two, no assignee, a long identifier, every priority, and a due date.
    public static let stressIssues: [Issue] = {
        let longTitle = "A deliberately enormous issue title that keeps going well past any "
            + "reasonable two-line clamp so the row has to decide what to do about it, and "
            + "then keeps going a good deal further still just to be certain"
        var list: [Issue] = [
            qaIssue(id: "x1", identifier: "PLATFORM-100234", title: longTitle,
                    priority: .urgent, state: states[2], assignee: nil, labelCount: 5,
                    dueDate: "2026-09-30"),
            qaIssue(id: "x2", identifier: "ENG-2", title: "Row with five labels and no assignee",
                    priority: .high, state: states[1], assignee: nil, labelCount: 5),
            qaIssue(id: "x3", identifier: "INFRASTRUCTURE-9912",
                    title: "Unbroken token: Supercalifragilisticexpialidocious_Antidisestablishmentarianism_Pneumonoultramicroscopicsilicovolcanoconiosis",
                    priority: .low, state: states[0], assignee: users[1], labelCount: 1),
            qaIssue(id: "x4", identifier: "ENG-4", title: "No priority, sorts last among open",
                    priority: Priority.none, state: states[1], assignee: users[0], labelCount: 0),
        ]
        // Enough rows to scroll several screens, so the stagger can be watched under a flick.
        let cycle: [Priority] = [.urgent, .high, .medium, .low, Priority.none]
        for index in 0..<40 {
            list.append(
                qaIssue(
                    id: "v\(index)", identifier: "ENG-\(100 + index)",
                    title: "Volume row \(index) — enough text to occupy a full line of the row",
                    priority: cycle[index % cycle.count],
                    state: states[index % 3],
                    assignee: index.isMultiple(of: 2) ? users[0] : nil,
                    labelCount: index % 4
                )
            )
        }
        // One completed issue so "Show completed" has something to reveal at this volume.
        list.append(
            qaIssue(id: "vdone", identifier: "ENG-999", title: "Finished, and hidden by default",
                    priority: .urgent, state: states[3], assignee: users[0], labelCount: 2)
        )
        return list
    }()

    /// Like `issue(...)` but able to attach labels and a due date, which the row renders and
    /// the original builder cannot express.
    public static func qaIssue(
        id: String,
        identifier: String,
        title: String,
        priority: Priority,
        state: WorkflowState,
        assignee: User?,
        labelCount: Int,
        dueDate: String? = nil
    ) -> Issue {
        let names = ["backend", "needs-design", "regression", "customer-reported", "p0-escalation"]
        let colors = ["#5B8DEF", "#F5B700", "#3FB950", "#EF5B5B", "#B65BEF"]
        let labels = (0..<max(0, min(labelCount, names.count))).map { index in
            "{\"id\":\"l\(id)-\(index)\",\"name\":\"\(names[index])\",\"color\":\"\(colors[index])\"}"
        }
        let assigneeJSON = assignee.map {
            "{\"id\":\"\($0.id)\",\"name\":\"\($0.name)\",\"displayName\":\"\($0.displayName)\",\"avatarUrl\":null,\"email\":null}"
        } ?? "null"
        let stateJSON = "{\"id\":\"\(state.id)\",\"name\":\"\(state.name)\",\"color\":\"\(state.color)\",\"category\":\"\(state.category.rawValue)\",\"position\":\"\(state.position)\"}"
        let dueJSON = dueDate.map { "\"\($0)\"" } ?? "null"
        return decoded("""
        {"id":"\(id)","identifier":"\(identifier)","title":"\(title)","description":"",
         "priority":\(priority.rawValue),"estimate":null,"dueDate":\(dueJSON),
         "state":\(stateJSON),
         "team":{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF"},
         "assignee":\(assigneeJSON),"creator":null,"labels":[\(labels.joined(separator: ","))],
         "createdAt":"2026-08-01T09:00:00Z","updatedAt":"2026-08-20T09:00:00Z"}
        """)
    }
    // ===== end QA-ONLY =====

    public static func issue(
        id: String,
        identifier: String,
        title: String,
        priority: Priority,
        state: WorkflowState,
        assignee: User? = nil
    ) -> Issue {
        issue(id: id, identifier: identifier, title: title, priority: priority, state: state,
              assignee: assignee, creator: nil, description: "")
    }

    /// The inbox, as the fixture serves it: one unread mention, one unread assignment, and
    /// one already-read status change — enough for the list to show both row states and for a
    /// badge to be non-zero.
    ///
    /// `-qa-empty-inbox` empties it, which is the state the inbox's own empty view exists for
    /// and the one a stock fixture can never reach.
    public static let notifications: [PolarisNotification] = {
        if ProcessInfo.processInfo.arguments.contains("-qa-empty-inbox") { return [] }
        let issues = FixtureData.issues
        guard !issues.isEmpty else { return [] }
        return [
            notification(id: "n1", type: "MENTION", issue: issues[0],
                         at: "2026-08-25T09:00:00Z", readAt: nil),
            notification(id: "n2", type: "ISSUE_ASSIGNED", issue: issues.count > 1 ? issues[1] : issues[0],
                         at: "2026-08-24T16:30:00Z", readAt: nil),
            notification(id: "n3", type: "ISSUE_STATUS_CHANGED", issue: issues[0],
                         at: "2026-08-23T11:00:00Z", readAt: "2026-08-23T12:00:00Z"),
        ]
    }()

    public static func notification(
        id: String,
        type: String,
        issue: Issue?,
        at: String,
        readAt: String?
    ) -> PolarisNotification {
        // Re-encoded rather than hand-built, for the reason the whole file gives: the wire
        // type has a custom `init(from:)` and a fixture that skips it would keep passing
        // after a decoding bug was introduced.
        let issueJSON: String
        if let issue, let data = try? PolarisJSON.encoder().encode(issue),
           let text = String(data: data, encoding: .utf8) {
            issueJSON = text
        } else {
            issueJSON = "null"
        }
        let readJSON = readAt.map { "\"\($0)\"" } ?? "null"
        return decoded("""
        {"id":"\(id)","type":"\(type)","issueId":\(issue.map { "\"\($0.id)\"" } ?? "null"),
         "commentId":null,"actor":{"type":"USER","id":"u2"},"count":1,
         "readAt":\(readJSON),"snoozedUntil":null,"createdAt":"\(at)","issue":\(issueJSON)}
        """)
    }

    public static func comment(body: String) -> Comment {
        decoded("""
        {"id":"\(UUIDv7.string())","body":"\(body)",
         "actor":{"type":"USER","id":"u1"},"editedAt":null,"createdAt":"2026-08-20T10:00:00Z"}
        """)
    }

    /// Force-decodes. A malformed fixture is a programming error in this file, not a runtime
    /// condition, and failing loudly here beats every test failing somewhere confusing.
    private static func decoded<T: Decodable>(_ json: String) -> T {
        do {
            return try PolarisJSON.decoder().decode(T.self, from: Data(json.utf8))
        } catch {
            fatalError("fixture JSON does not decode as \(T.self): \(error)")
        }
    }

    /// The general builder. Everything past `description` is what a detail screen renders
    /// and a list row does not; each is optional so the four base rows stay as terse as the
    /// day they were written.
    public static func issue(
        id: String,
        identifier: String,
        title: String,
        priority: Priority,
        state: WorkflowState,
        assignee: User? = nil,
        creator: User? = nil,
        description: String = "",
        labels: [Label] = [],
        estimate: Int? = nil,
        dueDate: String? = nil,
        parent: IssueRef? = nil,
        project: ProjectRef? = nil,
        cycle: CycleRef? = nil,
        progress: IssueProgress? = nil
    ) -> Issue {
        func encoded<T: Encodable>(_ value: T?) -> String {
            guard let value, let data = try? PolarisJSON.encoder().encode(value),
                  let text = String(data: data, encoding: .utf8)
            else { return "null" }
            return text
        }
        let stateJSON = "{\"id\":\"\(state.id)\",\"name\":\"\(state.name)\",\"color\":\"\(state.color)\",\"category\":\"\(state.category.rawValue)\",\"position\":\"\(state.position)\"}"
        return decoded("""
        {"id":"\(id)","identifier":"\(identifier)","title":"\(title)","description":"\(description)",
         "priority":\(priority.rawValue),"estimate":\(estimate.map(String.init) ?? "null"),
         "dueDate":\(dueDate.map { "\"\($0)\"" } ?? "null"),
         "state":\(stateJSON),
         "team":{"id":"t1","key":"ENG","name":"Engineering","icon":null,"color":"#5B8DEF","triageEnabled":true,"cyclesEnabled":true},
         "assignee":\(encoded(assignee)),"creator":\(encoded(creator)),"labels":\(encoded(labels)),
         "parentId":\(parent.map { "\"\($0.id)\"" } ?? "null"),
         "projectId":\(project.map { "\"\($0.id)\"" } ?? "null"),
         "cycleId":\(cycle.map { "\"\($0.id)\"" } ?? "null"),
         "parent":\(encoded(parent)),"project":\(encoded(project)),"cycle":\(encoded(cycle)),
         "progress":\(encoded(progress)),
         "createdAt":"2026-08-01T09:00:00Z","updatedAt":"2026-08-20T09:00:00Z"}
        """)
    }

}


/// Launch-argument switches that reshape the fixture for a QA pass.
///
/// The states worth testing on the detail and settings screens are exactly the ones the stock
/// fixture cannot produce: a team with no workflow states, a write the server refuses, a plan
/// string other than `pro`, a title long enough to wrap, comments by an author who is not in
/// the loaded user list. Each is a launch argument rather than a constructor parameter because
/// a UI test drives the app as a process and cannot reach the composition root.
///
/// Read only by `FixturePolarisClient`, which is already the test/preview double — no shipping
/// code path consults these.
public enum QAFixtureSwitches {
    private static var args: [String] { ProcessInfo.processInfo.arguments }

    private static func value(_ flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    public static var plan: String { value("-qa-plan") ?? "pro" }
    public static var noStates: Bool { args.contains("-qa-no-states") }

    public static var armedWriteFailure: PolarisError? {
        args.contains("-qa-fail-writes")
            ? .server(status: 500, message: "Polaris had a problem handling that.")
            : nil
    }

    public static var workspaceName: String {
        args.contains("-qa-long-names")
            ? "The Extremely Long Peixoto Laboratories Research And Development Workspace"
            : "Peixoto Labs"
    }

    public static var workspaceKey: String {
        args.contains("-qa-long-names")
            ? "peixoto-laboratories-research-and-development-workspace-primary"
            : "peixotolabs"
    }

    public static var firstIssueTitle: String {
        args.contains("-qa-long-text")
            ? "Sync drops a comment on reconnect when the websocket is resumed after a long "
                + "background period and the client replays its outbox against a watermark that "
                + "the server has already advanced past, which loses the comment silently"
            : "Sync drops a comment on reconnect"
    }

    public static var firstIssueDescription: String {
        args.contains("-qa-long-text")
            ? "Steps: put the app in the background for ten minutes, post a comment while "
                + "offline, then bring it back. Expected the comment to arrive. Actual: it is "
                + "dropped with no error anywhere. This paragraph is deliberately long so the "
                + "detail screen has to lay out a real description rather than an empty string, "
                + "and so the scroll view is exercised past one screenful of content."
            : ""
    }

    public static var seededComments: [String: [Comment]] {
        guard args.contains("-qa-comments") else { return [:] }
        return ["i1": [
            qaComment(id: "c1", actorType: "USER", actorId: "u2",
                      body: "Reproduced on 2026-08-19.", at: "2026-08-19T10:00:00Z"),
            qaComment(
                id: "c2",
                actorType: "USER", actorId: "u404",
                body: "This comment's author is not in the loaded user list.",
                at: "2026-08-19T11:00:00Z"
            ),
            qaComment(id: "c3", actorType: "INTEGRATION", actorId: "gh",
                      body: "Linked pull request #481.", at: "2026-08-19T12:00:00Z"),
            qaComment(id: "c4", actorType: "SYSTEM", actorId: nil,
                      body: "Moved to In Progress.", at: "2026-08-19T13:00:00Z"),
            qaComment(
                id: "c5", actorType: "USER", actorId: "u1",
                body: "A very long body. " + String(repeating: "The reconnect path replays the outbox and the watermark has already moved. ", count: 12),
                at: "2026-08-19T14:00:00Z"
            ),
        ]]
    }

    private static func qaComment(
        id: String,
        actorType: String = "USER",
        actorId: String? = "u1",
        body: String,
        at: String
    ) -> Comment {
        let actorIdJSON = actorId.map { "\"\($0)\"" } ?? "null"
        let json = """
        {"id":"\(id)","body":"\(body)",
         "actor":{"type":"\(actorType)","id":\(actorIdJSON)},"editedAt":null,"createdAt":"\(at)"}
        """
        return try! PolarisJSON.decoder().decode(Comment.self, from: Data(json.utf8))
    }
}
