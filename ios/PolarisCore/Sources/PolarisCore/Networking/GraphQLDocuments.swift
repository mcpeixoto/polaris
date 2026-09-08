import Foundation

/// The GraphQL documents this client sends, kept in one file so the whole wire surface can be
/// read at once and diffed against schema/schema.graphql.
///
/// Written as strings rather than generated: a codegen step in an Xcode build for a few
/// dozen queries costs more than it returns. `scripts/lint-ios-graphql.mjs` validates every
/// literal here against the schema, resolving exactly one interpolation — `issueFields` —
/// which is why every other repeated selection is written out in full rather than shared as
/// a second fragment: a second interpolation would validate something other than what is
/// sent.
enum GraphQLDocuments {
    /// Selected on every issue the app renders. Kept to one fragment so a list row and a
    /// detail screen can never disagree about what an issue is.
    ///
    /// The parent, project and cycle are the one-line forms — `IssueRef`, `ProjectRef`,
    /// `CycleRef` — because a list of five hundred rows must not carry a second issue each.
    static let issueFields = """
    fragment IssueFields on Issue {
      id identifier title description priority estimate dueDate createdAt updatedAt
      parentId projectId cycleId
      state { id name color category position }
      team { id key name icon color triageEnabled cyclesEnabled }
      assignee { id name displayName avatarUrl email }
      creator { id name displayName avatarUrl email }
      labels { id name color teamId parentId isGroup }
      parent { id identifier title }
      project { id name color icon }
      cycle { id number name startsAt endsAt }
      progress { total completed canceled percent }
    }
    """

    /// `notificationPrefs` is selected here and nowhere else: it is the viewer's own bag,
    /// and the directory query has no business carrying everybody's.
    static let viewer = """
    query Viewer {
      viewer {
        user { id name displayName avatarUrl email notificationPrefs }
        workspace { id name urlKey plan }
        workspaces { id name urlKey plan }
        syncVersion
      }
    }
    """

    /// Deliberately the smallest query in the file: it is polled, and its only job is to say
    /// whether anything changed.
    static let syncVersion = """
    query SyncVersion { viewer { syncVersion } }
    """

    static let myIssues = """
    query MyIssues($includeCompleted: Boolean) {
      myIssues(includeCompleted: $includeCompleted) { ...IssueFields }
    }
    \(issueFields)
    """

    static let teamIssues = """
    query TeamIssues($teamId: UUID!) {
      issues(teamId: $teamId) { ...IssueFields }
    }
    \(issueFields)
    """

    /// The team list with each issue's subscribers beside it, for the "subscribed" scope of
    /// My issues. Separate from `teamIssues` so the ordinary list does not carry a
    /// subscriber array per row it never reads.
    static let teamIssuesWithSubscribers = """
    query TeamIssuesWithSubscribers($teamId: UUID!) {
      issues(teamId: $teamId) {
        ...IssueFields
        subscribers { userId unsubscribed reason }
      }
    }
    \(issueFields)
    """

    static let issue = """
    query IssueById($id: UUID!) {
      issue(id: $id) { ...IssueFields }
    }
    \(issueFields)
    """

    static let issueByIdentifier = """
    query IssueByIdentifier($identifier: String!) {
      issueByIdentifier(identifier: $identifier) { ...IssueFields }
    }
    \(issueFields)
    """

    /// The detail screen's whole read. Both ends of every relation are selected because a
    /// `blockedBy` row arrives with the blocker as `issue` — the same row read from the
    /// other side — and the screen wants to name the *other* issue whichever list it is in.
    static let issueDetail = """
    query IssueDetail($id: UUID!) {
      issue(id: $id) {
        ...IssueFields
        children { ...IssueFields }
        attachments { id url title subtitle iconUrl createdAt }
        relations {
          id type
          issue { id identifier title }
          relatedIssue { id identifier title }
        }
        blockedBy {
          id type
          issue { id identifier title }
          relatedIssue { id identifier title }
        }
        subscribers { userId unsubscribed reason }
      }
    }
    \(issueFields)
    """

    static let issueHistory = """
    query IssueHistory($issueId: UUID!) {
      issueHistory(issueId: $issueId) {
        id kind fromValue toValue createdAt
        actor { type id }
      }
    }
    """

    static let comments = """
    query Comments($issueId: UUID!) {
      comments(issueId: $issueId) {
        id body editedAt createdAt parentId resolvedAt
        actor { type id }
        reactions { id commentId userId emoji createdAt }
      }
    }
    """

    static let teams = """
    query Teams { teams { id key name icon color triageEnabled cyclesEnabled } }
    """

    static let workflowStates = """
    query WorkflowStates($teamId: UUID!) {
      workflowStates(teamId: $teamId) { id name color category position }
    }
    """

    static let users = """
    query Users { users { id name displayName avatarUrl email } }
    """

    static let labels = """
    query Labels { labels { id name color teamId parentId isGroup } }
    """

    /// The projects list. Deliberately a THINNER selection than `project` below, which is the
    /// only pair in this file that differs — so it is worth saying why.
    ///
    /// `Query.projects` takes no pagination argument, so it is charged the default page of 50,
    /// and `teams` is an unpaginated list inside it: fifty projects times fifty team links is a
    /// 2,500× multiplier on everything selected under `team`. With `milestones` beside it the
    /// whole query scored 10,245 points against a 10,000-point ceiling and was refused outright
    /// — the list screen simply never loaded.
    ///
    /// So this selects what the list actually draws. `description`, `priority` and `leadId` have
    /// no reader anywhere in the app; `milestones` is read only by the detail header, which
    /// fetches `project` a moment later anyway and shows its milestones then. Each scalar under
    /// `team` costs 250 points, so that block is narrowed to the four fields
    /// `ProjectDetailView` and `projects(forTeam:)` read.
    static let projects = """
    query Projects {
      projects {
        id name summary icon color startDate targetDate
        status { id name color category }
        lead { id name displayName avatarUrl email }
        teams { team { id key name color } }
      }
    }
    """

    /// One project, in full. Not a list, so nothing here is multiplied and it can afford the
    /// fields `projects` above drops.
    static let project = """
    query ProjectById($id: UUID!) {
      project(id: $id) {
        id name summary description icon color priority leadId startDate targetDate
        status { id name color category }
        lead { id name displayName avatarUrl email }
        teams { team { id key name icon color triageEnabled cyclesEnabled } }
        milestones { id name targetDate }
      }
    }
    """

    static let projectStatuses = """
    query ProjectStatuses { projectStatuses { id name color category } }
    """

    static let cycles = """
    query Cycles($teamId: UUID!) {
      cycles(teamId: $teamId) {
        id teamId number name description startsAt endsAt completedAt
      }
    }
    """

    static let cycle = """
    query CycleById($id: UUID!) {
      cycle(id: $id) { id teamId number name description startsAt endsAt completedAt }
    }
    """

    static let favorites = """
    query Favorites { favorites { id kind targetId name } }
    """

    static let unreadNotificationCount = """
    query UnreadCount { unreadNotificationCount }
    """

    /// The inbox. `payload` is deliberately not selected: it is a `JSON` scalar whose shape
    /// varies by notification type, and everything a row renders is either on the row or on
    /// the issue it hangs off.
    static let notifications = """
    query Notifications($includeRead: Boolean, $includeSnoozed: Boolean, $first: Int) {
      notifications(includeRead: $includeRead, includeSnoozed: $includeSnoozed, first: $first) {
        id type issueId commentId count readAt snoozedUntil createdAt
        actor { type id }
        issue { ...IssueFields }
      }
    }
    \(issueFields)
    """

    static let search = """
    query Search($input: SearchInput!) {
      search(input: $input) {
        issueCount
        issues { ...IssueFields }
      }
    }
    \(issueFields)
    """

    static let markNotificationRead = """
    mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {
      markNotificationRead(id: $id, read: $read) {
        version
        notification {
          id type issueId commentId count readAt snoozedUntil createdAt
          actor { type id }
          issue { ...IssueFields }
        }
      }
    }
    \(issueFields)
    """

    static let snoozeNotification = """
    mutation SnoozeNotification($id: UUID!, $until: Time) {
      snoozeNotification(id: $id, until: $until) {
        version
        notification {
          id type issueId commentId count readAt snoozedUntil createdAt
          actor { type id }
          issue { ...IssueFields }
        }
      }
    }
    \(issueFields)
    """

    static let deleteNotification = """
    mutation DeleteNotification($id: UUID!) {
      deleteNotification(id: $id) { version id }
    }
    """

    static let archiveIssue = """
    mutation ArchiveIssue($id: UUID!, $archived: Boolean!, $clientId: UUID, $opId: UUID) {
      archiveIssue(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
        version
        id
      }
    }
    """

    static let deleteIssue = """
    mutation DeleteIssue($id: UUID!, $clientId: UUID, $opId: UUID) {
      deleteIssue(id: $id, clientId: $clientId, opId: $opId) { version id }
    }
    """

    static let createIssue = """
    mutation CreateIssue($input: CreateIssueInput!, $clientId: UUID, $opId: UUID) {
      createIssue(input: $input, clientId: $clientId, opId: $opId) {
        version
        issue { ...IssueFields }
      }
    }
    \(issueFields)
    """

    static let updateIssue = """
    mutation UpdateIssue($input: UpdateIssueInput!, $clientId: UUID, $opId: UUID) {
      updateIssue(input: $input, clientId: $clientId, opId: $opId) {
        version
        issue { ...IssueFields }
      }
    }
    \(issueFields)
    """

    static let acceptTriageIssue = """
    mutation AcceptTriageIssue($id: UUID!, $clientId: UUID, $opId: UUID) {
      acceptTriageIssue(id: $id, clientId: $clientId, opId: $opId) {
        version
        issue { ...IssueFields }
      }
    }
    \(issueFields)
    """

    static let declineTriageIssue = """
    mutation DeclineTriageIssue($id: UUID!, $clientId: UUID, $opId: UUID) {
      declineTriageIssue(id: $id, clientId: $clientId, opId: $opId) {
        version
        issue { ...IssueFields }
      }
    }
    \(issueFields)
    """

    static let createComment = """
    mutation CreateComment($input: CreateCommentInput!, $clientId: UUID, $opId: UUID) {
      createComment(input: $input, clientId: $clientId, opId: $opId) {
        version
        comment {
          id body editedAt createdAt parentId resolvedAt
          actor { type id }
          reactions { id commentId userId emoji createdAt }
        }
      }
    }
    """

    static let updateComment = """
    mutation UpdateComment($id: UUID!, $body: String!, $clientId: UUID, $opId: UUID) {
      updateComment(id: $id, body: $body, clientId: $clientId, opId: $opId) {
        version
        comment {
          id body editedAt createdAt parentId resolvedAt
          actor { type id }
          reactions { id commentId userId emoji createdAt }
        }
      }
    }
    """

    static let deleteComment = """
    mutation DeleteComment($id: UUID!, $clientId: UUID, $opId: UUID) {
      deleteComment(id: $id, clientId: $clientId, opId: $opId) { version id }
    }
    """

    static let addReaction = """
    mutation AddReaction($commentId: UUID!, $emoji: String!, $clientId: UUID, $opId: UUID) {
      addReaction(commentId: $commentId, emoji: $emoji, clientId: $clientId, opId: $opId) {
        version
        reaction { id commentId userId emoji createdAt }
      }
    }
    """

    static let removeReaction = """
    mutation RemoveReaction($commentId: UUID!, $emoji: String!, $clientId: UUID, $opId: UUID) {
      removeReaction(commentId: $commentId, emoji: $emoji, clientId: $clientId, opId: $opId) {
        version
        id
      }
    }
    """

    static let addIssueLabel = """
    mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {
      addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {
        version
        issueLabel { id label { id name color teamId parentId isGroup } }
      }
    }
    """

    static let removeIssueLabel = """
    mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {
      removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {
        version
        id
      }
    }
    """

    static let setIssueSubscription = """
    mutation SetIssueSubscription($issueId: UUID!, $subscribed: Boolean!) {
      setIssueSubscription(issueId: $issueId, subscribed: $subscribed) {
        version
        subscription { userId unsubscribed reason }
      }
    }
    """

    static let createIssueRelation = """
    mutation CreateIssueRelation($issueId: UUID!, $relatedIssueId: UUID!, $type: RelationType!, $clientId: UUID, $opId: UUID) {
      createIssueRelation(issueId: $issueId, relatedIssueId: $relatedIssueId, type: $type, clientId: $clientId, opId: $opId) {
        version
        relation {
          id type
          issue { id identifier title }
          relatedIssue { id identifier title }
        }
      }
    }
    """

    static let deleteIssueRelation = """
    mutation DeleteIssueRelation($id: UUID!, $clientId: UUID, $opId: UUID) {
      deleteIssueRelation(id: $id, clientId: $clientId, opId: $opId) { version id }
    }
    """

    static let createAttachment = """
    mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID, $opId: UUID) {
      createAttachment(input: $input, clientId: $clientId, opId: $opId) {
        version
        attachment { id url title subtitle iconUrl createdAt }
      }
    }
    """

    static let addFavorite = """
    mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!) {
      addFavorite(kind: $kind, targetId: $targetId) {
        version
        favorite { id kind targetId name }
      }
    }
    """

    static let removeFavorite = """
    mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {
      removeFavorite(kind: $kind, targetId: $targetId) { version id }
    }
    """

    static let updateProfile = """
    mutation UpdateProfile($input: UpdateProfileInput!) {
      updateProfile(input: $input) {
        version
        user { id name displayName avatarUrl email notificationPrefs }
      }
    }
    """

    static let updateNotificationPrefs = """
    mutation UpdateNotificationPrefs($prefs: JSON!) {
      updateNotificationPrefs(prefs: $prefs) {
        version
        user { id name displayName avatarUrl email notificationPrefs }
      }
    }
    """
}
