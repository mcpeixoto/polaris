/**
 * GraphQL operations.
 *
 * Written by hand as tagged strings rather than generated from the schema, because there
 * are few of them and the shapes are stable — and because the client's real read path is
 * the local store, not these documents. Queries here are used for boot, for the parts of
 * an issue that are loaded on demand, and by tests; the interactive UI never waits on one.
 *
 * Fragments mirror the fields the sync stream carries, so an entity fetched by query and
 * the same entity arriving as a delta land in the store with identical shapes.
 */

export const ISSUE_FIELDS = /* GraphQL */ `
  fragment IssueFields on Issue {
    id
    workspaceId
    teamId
    number
    identifier
    title
    description
    stateId
    assigneeId
    creatorId
    priority
    sortOrder
    estimate
    dueDate
    dueDateSource
    parentId
    subIssueSortOrder
    templateId
    formTemplateId
    recurringIssueId
    projectId
    projectMilestoneId
    cycleId
    snoozedUntil
    autoClosedAt
    startedAt
    completedAt
    canceledAt
    archivedAt
    createdAt
    updatedAt
  }
`;

export const TEAM_FIELDS = /* GraphQL */ `
  fragment TeamFields on Team {
    id
    workspaceId
    key
    name
    description
    icon
    color
    timezone
    parentTeamId
    private
    estimateScale
    estimateAllowZero
    estimateExtended
    cyclesEnabled
    cycleDurationWeeks
    cycleCooldownWeeks
    cycleStartDay
    cycleUpcomingCount
    cycleAutoAddStarted
    cycleAutoAddCompleted
    triageEnabled
    triageRequirePriority
    autoCloseDays
    autoArchiveDays
    autoCloseParent
    autoCloseChildren
    defaultTemplateForMembersId
    defaultTemplateForNonMembersId
    emailIntakeEnabled
    emailIntakeAddress
    createdAt
    updatedAt
    retiredAt
    archivedAt
  }
`;

export const STATE_FIELDS = /* GraphQL */ `
  fragment StateFields on WorkflowState {
    id
    workspaceId
    teamId
    name
    description
    color
    category
    position
    isDefault
    isSystem
    createdAt
    updatedAt
    archivedAt
  }
`;

export const USER_FIELDS = /* GraphQL */ `
  fragment UserFields on User {
    id
    workspaceId
    name
    displayName
    avatarUrl
    timezone
    role
    status
    kind
    email
    notificationPrefs
    lastSeenAt
    createdAt
    updatedAt
    archivedAt
  }
`;

export const COMMENT_FIELDS = /* GraphQL */ `
  fragment CommentFields on Comment {
    id
    workspaceId
    issueId
    parentId
    body
    actor {
      type
      id
    }
    editedAt
    resolvedAt
    resolvedBy
    anchorStart
    anchorEnd
    quote
    createdAt
    updatedAt
  }
`;

export const ATTACHMENT_FIELDS = /* GraphQL */ `
  fragment AttachmentFields on Attachment {
    id
    workspaceId
    issueId
    teamId
    url
    title
    subtitle
    iconUrl
    metadata
    creatorId
    createdAt
    updatedAt
  }
`;

export const VIEWER_QUERY = /* GraphQL */ `
  ${USER_FIELDS}
  query Viewer {
    viewer {
      syncVersion
      user {
        ...UserFields
      }
      workspace {
        id
        name
        urlKey
        logoUrl
        plan
        createdAt
        updatedAt
      }
      workspaces {
        id
        name
        urlKey
        logoUrl
        plan
        createdAt
        updatedAt
      }
    }
  }
`;

/**
 * Comments and history are deliberately absent from the bootstrap snapshot beyond a
 * recent window, so opening an issue fetches the rest. This is the one place the
 * interactive UI does hit the network, and it happens behind already-rendered content.
 */
export const ISSUE_DETAIL_QUERY = /* GraphQL */ `
  ${COMMENT_FIELDS}
  query IssueDetail($id: UUID!) {
    comments(issueId: $id) {
      ...CommentFields
    }
    issueHistory(issueId: $id) {
      id
      issueId
      kind
      fromValue
      toValue
      createdAt
      actor {
        type
        id
      }
    }
  }
`;

export const CREATE_ISSUE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation CreateIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {
    createIssue(input: $input, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;

export const UPDATE_ISSUE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation UpdateIssue($input: UpdateIssueInput!, $clientId: UUID!, $opId: UUID!) {
    updateIssue(input: $input, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;

export const ARCHIVE_ISSUE = /* GraphQL */ `
  mutation ArchiveIssue($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {
    archiveIssue(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const DELETE_ISSUE = /* GraphQL */ `
  mutation DeleteIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteIssue(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const CREATE_COMMENT = /* GraphQL */ `
  ${COMMENT_FIELDS}
  mutation CreateComment($input: CreateCommentInput!, $clientId: UUID!, $opId: UUID!) {
    createComment(input: $input, clientId: $clientId, opId: $opId) {
      version
      comment {
        ...CommentFields
      }
    }
  }
`;

export const UPDATE_COMMENT = /* GraphQL */ `
  ${COMMENT_FIELDS}
  mutation UpdateComment($id: UUID!, $body: String!, $clientId: UUID!, $opId: UUID!) {
    updateComment(id: $id, body: $body, clientId: $clientId, opId: $opId) {
      version
      comment {
        ...CommentFields
      }
    }
  }
`;

export const DELETE_COMMENT = /* GraphQL */ `
  mutation DeleteComment($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteComment(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const RESOLVE_COMMENT = /* GraphQL */ `
  ${COMMENT_FIELDS}
  mutation ResolveComment($id: UUID!, $resolved: Boolean!, $clientId: UUID!, $opId: UUID!) {
    resolveComment(id: $id, resolved: $resolved, clientId: $clientId, opId: $opId) {
      version
      comment {
        ...CommentFields
      }
    }
  }
`;

export const CREATE_ATTACHMENT = /* GraphQL */ `
  ${ATTACHMENT_FIELDS}
  mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {
    createAttachment(input: $input, clientId: $clientId, opId: $opId) {
      version
      attachment {
        ...AttachmentFields
      }
    }
  }
`;

export const UPDATE_ATTACHMENT = /* GraphQL */ `
  ${ATTACHMENT_FIELDS}
  mutation UpdateAttachment($input: UpdateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {
    updateAttachment(input: $input, clientId: $clientId, opId: $opId) {
      version
      attachment {
        ...AttachmentFields
      }
    }
  }
`;

export const DELETE_ATTACHMENT = /* GraphQL */ `
  mutation DeleteAttachment($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteAttachment(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const CREATE_TEAM = /* GraphQL */ `
  ${TEAM_FIELDS}
  ${STATE_FIELDS}
  mutation CreateTeam($input: CreateTeamInput!) {
    createTeam(input: $input) {
      version
      team {
        ...TeamFields
        states {
          ...StateFields
        }
      }
    }
  }
`;

export const UPDATE_TEAM = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation UpdateTeam($input: UpdateTeamInput!) {
    updateTeam(input: $input) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const CYCLE_FIELDS = /* GraphQL */ `
  fragment CycleFields on Cycle {
    id
    workspaceId
    teamId
    number
    name
    description
    startsAt
    endsAt
    completedAt
    archivedAt
    createdAt
    updatedAt
  }
`;

export const UPDATE_TEAM_CYCLES = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation UpdateTeamCycles($input: UpdateTeamCyclesInput!) {
    updateTeamCycles(input: $input) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const UPDATE_TEAM_TRIAGE = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation UpdateTeamTriage($input: UpdateTeamTriageInput!) {
    updateTeamTriage(input: $input) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const UPDATE_TEAM_EMAIL_INTAKE = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation UpdateTeamEmailIntake($input: UpdateTeamEmailIntakeInput!) {
    updateTeamEmailIntake(input: $input) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const UPDATE_TEAM_ARCHIVE = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {
    updateTeamArchive(input: $input) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const UPDATE_TEAM_TEMPLATES = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation UpdateTeamTemplates($input: UpdateTeamTemplatesInput!) {
    updateTeamTemplates(input: $input) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const ACCEPT_TRIAGE_ISSUE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation AcceptTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    acceptTriageIssue(id: $id, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;

export const DECLINE_TRIAGE_ISSUE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation DeclineTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    declineTriageIssue(id: $id, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;

export const MARK_ISSUE_DUPLICATE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation MarkIssueDuplicate($id: UUID!, $canonicalId: UUID!, $clientId: UUID!, $opId: UUID!) {
    markIssueDuplicate(id: $id, canonicalId: $canonicalId, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;

export const SNOOZE_ISSUE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation SnoozeIssue($id: UUID!, $until: Time!, $clientId: UUID!, $opId: UUID!) {
    snoozeIssue(id: $id, until: $until, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;

export const CREATE_WORKFLOW_STATE = /* GraphQL */ `
  ${STATE_FIELDS}
  mutation CreateWorkflowState($input: CreateWorkflowStateInput!) {
    createWorkflowState(input: $input) {
      version
      state {
        ...StateFields
      }
    }
  }
`;

export const UPDATE_WORKFLOW_STATE = /* GraphQL */ `
  ${STATE_FIELDS}
  mutation UpdateWorkflowState($input: UpdateWorkflowStateInput!) {
    updateWorkflowState(input: $input) {
      version
      state {
        ...StateFields
      }
    }
  }
`;

export const ARCHIVE_WORKFLOW_STATE = /* GraphQL */ `
  mutation ArchiveWorkflowState($id: UUID!, $archived: Boolean!) {
    archiveWorkflowState(id: $id, archived: $archived) {
      version
      id
    }
  }
`;

export const SET_USER_ROLE = /* GraphQL */ `
  ${USER_FIELDS}
  mutation SetUserRole($userId: UUID!, $role: UserRole!) {
    setUserRole(userId: $userId, role: $role) {
      version
      user {
        ...UserFields
      }
    }
  }
`;

export const SUSPEND_USER = /* GraphQL */ `
  ${USER_FIELDS}
  mutation SuspendUser($userId: UUID!, $suspended: Boolean!) {
    suspendUser(userId: $userId, suspended: $suspended) {
      version
      user {
        ...UserFields
      }
    }
  }
`;

export const UPDATE_PROFILE = /* GraphQL */ `
  ${USER_FIELDS}
  mutation UpdateProfile($input: UpdateProfileInput!) {
    updateProfile(input: $input) {
      version
      user {
        ...UserFields
      }
    }
  }
`;
