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

export const REACTION_FIELDS = /* GraphQL */ `
  fragment ReactionFields on Reaction {
    id
    workspaceId
    commentId
    userId
    emoji
    createdAt
  }
`;

/**
 * Adding a reaction that is already there succeeds with `version: 0` — nothing was
 * written, so no delta is coming and the optimistic state should settle immediately
 * rather than wait for one.
 */
export const ADD_REACTION = /* GraphQL */ `
  ${REACTION_FIELDS}
  mutation AddReaction($commentId: UUID!, $emoji: String!, $clientId: UUID!, $opId: UUID!) {
    addReaction(commentId: $commentId, emoji: $emoji, clientId: $clientId, opId: $opId) {
      version
      reaction {
        ...ReactionFields
      }
    }
  }
`;

/** Removing one that is not there is also a success, with `version: 0` and the nil id. */
export const REMOVE_REACTION = /* GraphQL */ `
  mutation RemoveReaction($commentId: UUID!, $emoji: String!, $clientId: UUID!, $opId: UUID!) {
    removeReaction(commentId: $commentId, emoji: $emoji, clientId: $clientId, opId: $opId) {
      version
      id
    }
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
  mutation CreateTeam($input: CreateTeamInput!, $clientId: UUID!, $opId: UUID!) {
    createTeam(input: $input, clientId: $clientId, opId: $opId) {
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
  mutation CreateWorkflowState($input: CreateWorkflowStateInput!, $clientId: UUID!, $opId: UUID!) {
    createWorkflowState(input: $input, clientId: $clientId, opId: $opId) {
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

/**
 * The in-app agent.
 *
 * These entities are deliberately absent from the replica: a session holds what one person
 * asked and what they were told, it is never visible to a teammate, and there is no delta
 * stream behind it. So the panel queries them directly and holds the answers in React
 * state, and these documents are the whole of its read path rather than a boot-time
 * projection of it.
 *
 * `AgentSessionFields` and `AgentMessageFields` end in `Fields` like every other fragment
 * here, and mean the same thing: everything the type has. They are not checked by
 * gql/fragments.test.ts, which only knows about entities the store replicates.
 */
export const AGENT_SESSION_FIELDS = /* GraphQL */ `
  fragment AgentSessionFields on AgentSession {
    id
    title
    status
    error
    origin
    issueId
    commentId
    createdAt
    updatedAt
  }
`;

export const AGENT_MESSAGE_FIELDS = /* GraphQL */ `
  fragment AgentMessageFields on AgentMessage {
    id
    sessionId
    role
    body
    toolCalls {
      name
      summary
      isError
    }
    proposal {
      summary
      steps {
        tool
        description
        arguments
      }
    }
    proposalState
    inputTokens
    outputTokens
    createdAt
  }
`;

export const AGENT_CONFIG = /* GraphQL */ `
  query AgentConfig {
    agentConfig {
      enabled
      model
      creditsRemaining
    }
  }
`;

/**
 * The conversation list and one transcript in a single round trip.
 *
 * They are asked for together because they are polled together: a run finishes on the
 * session's `status`, and the turn that finished it is in `agentMessages`, so fetching one
 * without the other leaves the panel showing a settled session with the last answer
 * missing, or the answer with a spinner still over it.
 */
export const AGENT_THREAD = /* GraphQL */ `
  ${AGENT_SESSION_FIELDS}
  ${AGENT_MESSAGE_FIELDS}
  query AgentThread($sessionId: UUID!, $limit: Int) {
    agentSessions(limit: $limit) {
      ...AgentSessionFields
    }
    agentMessages(sessionId: $sessionId) {
      ...AgentMessageFields
    }
  }
`;

/** The list on its own, for a panel opening with no conversation chosen yet. */
export const AGENT_SESSIONS = /* GraphQL */ `
  ${AGENT_SESSION_FIELDS}
  query AgentSessions($limit: Int) {
    agentSessions(limit: $limit) {
      ...AgentSessionFields
    }
  }
`;

export const CREATE_AGENT_SESSION = /* GraphQL */ `
  ${AGENT_SESSION_FIELDS}
  ${AGENT_MESSAGE_FIELDS}
  mutation CreateAgentSession($input: CreateAgentSessionInput!) {
    createAgentSession(input: $input) {
      version
      session {
        ...AgentSessionFields
      }
      message {
        ...AgentMessageFields
      }
    }
  }
`;

export const SEND_AGENT_MESSAGE = /* GraphQL */ `
  ${AGENT_MESSAGE_FIELDS}
  mutation SendAgentMessage($sessionId: UUID!, $body: String!) {
    sendAgentMessage(sessionId: $sessionId, body: $body) {
      version
      message {
        ...AgentMessageFields
      }
    }
  }
`;

export const APPLY_AGENT_PROPOSAL = /* GraphQL */ `
  ${AGENT_MESSAGE_FIELDS}
  mutation ApplyAgentProposal($messageId: UUID!) {
    applyAgentProposal(messageId: $messageId) {
      version
      message {
        ...AgentMessageFields
      }
      applied
    }
  }
`;

export const REJECT_AGENT_PROPOSAL = /* GraphQL */ `
  ${AGENT_MESSAGE_FIELDS}
  mutation RejectAgentProposal($messageId: UUID!) {
    rejectAgentProposal(messageId: $messageId) {
      version
      message {
        ...AgentMessageFields
      }
    }
  }
`;

export const DELETE_AGENT_SESSION = /* GraphQL */ `
  mutation DeleteAgentSession($id: UUID!) {
    deleteAgentSession(id: $id) {
      version
      id
    }
  }
`;
