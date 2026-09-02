import Foundation

/// The GraphQL documents this client sends, kept in one file so the whole wire surface can be
/// read at once and diffed against schema/schema.graphql.
///
/// Written as strings rather than generated: the app asks for eleven operations, and a
/// codegen step in an Xcode build for eleven queries costs more than it returns.
enum GraphQLDocuments {
    /// Selected on every issue the app renders. Kept to one fragment so a list row and a
    /// detail screen can never disagree about what an issue is.
    static let issueFields = """
    fragment IssueFields on Issue {
      id identifier title description priority estimate dueDate createdAt updatedAt
      state { id name color category position }
      team { id key name icon color }
      assignee { id name displayName avatarUrl email }
      creator { id name displayName avatarUrl email }
      labels { id name color }
    }
    """

    static let viewer = """
    query Viewer {
      viewer {
        user { id name displayName avatarUrl email }
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

    static let issue = """
    query IssueById($id: UUID!) {
      issue(id: $id) { ...IssueFields }
    }
    \(issueFields)
    """

    static let comments = """
    query Comments($issueId: UUID!) {
      comments(issueId: $issueId) {
        id body editedAt createdAt
        actor { type id }
      }
    }
    """

    static let teams = """
    query Teams { teams { id key name icon color } }
    """

    static let workflowStates = """
    query WorkflowStates($teamId: UUID!) {
      workflowStates(teamId: $teamId) { id name color category position }
    }
    """

    static let users = """
    query Users { users { id name displayName avatarUrl email } }
    """

    static let unreadNotificationCount = """
    query UnreadCount { unreadNotificationCount }
    """

    /// The inbox. `payload` is deliberately not selected: it is a `JSON` scalar whose shape
    /// varies by notification type, and everything a row renders is either on the row or on
    /// the issue it hangs off.
    ///
    /// The notification selection is written out in full in each of the three documents that
    /// need it rather than shared as a fragment, because `scripts/lint-ios-graphql.mjs`
    /// resolves exactly one interpolation — `issueFields` — and a second one would validate
    /// something other than what is sent.
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

    static let createComment = """
    mutation CreateComment($input: CreateCommentInput!, $clientId: UUID, $opId: UUID) {
      createComment(input: $input, clientId: $clientId, opId: $opId) {
        version
        comment {
          id body editedAt createdAt
          actor { type id }
        }
      }
    }
    """
}
