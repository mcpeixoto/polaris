/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        lapsed\n      }\n    }\n  }\n": typeof types.EntitlementsDocument,
    "\n  query Invites {\n    invites {\n      id\n      email\n      role\n      invitedBy\n      teamIds\n      expiresAt\n      createdAt\n    }\n  }\n": typeof types.InvitesDocument,
    "\n  mutation InviteToWorkspace($input: InviteInput!) {\n    inviteToWorkspace(input: $input) {\n      id\n      email\n      role\n      expiresAt\n      token\n    }\n  }\n": typeof types.InviteToWorkspaceDocument,
    "\n  mutation RevokeInvite($id: UUID!) {\n    revokeInvite(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.RevokeInviteDocument,
    "\n  mutation RemoveUser($userId: UUID!) {\n    removeUser(userId: $userId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveUserDocument,
    "\n  \n  query DeletedIssues {\n    deletedIssues {\n      ...IssueFields\n    }\n  }\n": typeof types.DeletedIssuesDocument,
    "\n  \n  mutation RestoreIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.RestoreIssueDocument,
    "\n  fragment ApiKeyFields on ApiKey {\n    id\n    userId\n    name\n    prefix\n    scopes\n    lastUsedAt\n    expiresAt\n    revokedAt\n    createdAt\n  }\n": typeof types.ApiKeyFieldsFragmentDoc,
    "\n  \n  query ApiKeys {\n    apiKeys {\n      ...ApiKeyFields\n    }\n  }\n": typeof types.ApiKeysDocument,
    "\n  \n  mutation CreateApiKey($input: CreateApiKeyInput!) {\n    createApiKey(input: $input) {\n      version\n      created {\n        token\n        apiKey {\n          ...ApiKeyFields\n        }\n      }\n    }\n  }\n": typeof types.CreateApiKeyDocument,
    "\n  mutation RevokeApiKey($id: UUID!) {\n    revokeApiKey(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.RevokeApiKeyDocument,
    "\n  \n  query ArchivedIssues($teamId: UUID!) {\n    archivedIssues(teamId: $teamId) {\n      ...IssueFields\n    }\n  }\n": typeof types.ArchivedIssuesDocument,
    "\n  \n  query ArchivedCycles($teamId: UUID!) {\n    archivedCycles(teamId: $teamId) {\n      ...CycleFields\n    }\n  }\n": typeof types.ArchivedCyclesDocument,
    "\n  \n  query ArchivedProjects($teamId: UUID!) {\n    archivedProjects(teamId: $teamId) {\n      ...ProjectFields\n    }\n  }\n": typeof types.ArchivedProjectsDocument,
    "\n  mutation ArchiveCycle($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCycle(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveCycleDocument,
    "\n  mutation ArchiveProject($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveProject(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveProjectDocument,
    "\n  fragment NotificationFields on Notification {\n    id\n    workspaceId\n    userId\n    type\n    issueId\n    commentId\n    actor {\n      type\n      id\n    }\n    changeVersion\n    groupKey\n    count\n    payload\n    readAt\n    snoozedUntil\n    createdAt\n    updatedAt\n  }\n": typeof types.NotificationFieldsFragmentDoc,
    "\n  \n  query Inbox($first: Int!) {\n    notifications(includeRead: true, includeSnoozed: true, first: $first) {\n      ...NotificationFields\n    }\n  }\n": typeof types.InboxDocument,
    "\n  query UnreadNotificationCount {\n    unreadNotificationCount\n  }\n": typeof types.UnreadNotificationCountDocument,
    "\n  \n  mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {\n    markNotificationRead(id: $id, read: $read) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": typeof types.MarkNotificationReadDocument,
    "\n  \n  mutation MarkAllNotificationsRead {\n    markAllNotificationsRead {\n      version\n      notifications {\n        ...NotificationFields\n      }\n    }\n  }\n": typeof types.MarkAllNotificationsReadDocument,
    "\n  \n  mutation SnoozeNotification($id: UUID!, $until: Time) {\n    snoozeNotification(id: $id, until: $until) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": typeof types.SnoozeNotificationDocument,
    "\n  mutation DeleteNotification($id: UUID!) {\n    deleteNotification(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteNotificationDocument,
    "\n  \n  mutation UpdateNotificationPrefs($prefs: JSON!) {\n    updateNotificationPrefs(prefs: $prefs) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": typeof types.UpdateNotificationPrefsDocument,
    "\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.SubIssueFieldsFragmentDoc,
    "\n  fragment RelationFields on IssueRelation {\n    id\n    workspaceId\n    issueId\n    relatedIssueId\n    type\n    teamId\n    relatedTeamId\n    createdBy\n    createdAt\n  }\n": typeof types.RelationFieldsFragmentDoc,
    "\n  fragment SubscriptionFields on IssueSubscription {\n    id\n    workspaceId\n    issueId\n    userId\n    reason\n    unsubscribed\n    createdAt\n    updatedAt\n  }\n": typeof types.SubscriptionFieldsFragmentDoc,
    "\n  \n  mutation CreateSubIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...SubIssueFields\n      }\n    }\n  }\n": typeof types.CreateSubIssueDocument,
    "\n  \n  mutation CreateIssueRelation(\n    $issueId: UUID!\n    $relatedIssueId: UUID!\n    $type: RelationType!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createIssueRelation(\n      issueId: $issueId\n      relatedIssueId: $relatedIssueId\n      type: $type\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      relation {\n        ...RelationFields\n      }\n    }\n  }\n": typeof types.CreateIssueRelationDocument,
    "\n  mutation DeleteIssueRelation($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssueRelation(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteIssueRelationDocument,
    "\n  \n  mutation SetIssueSubscription($issueId: UUID!, $subscribed: Boolean!) {\n    setIssueSubscription(issueId: $issueId, subscribed: $subscribed) {\n      version\n      subscription {\n        ...SubscriptionFields\n      }\n    }\n  }\n": typeof types.SetIssueSubscriptionDocument,
    "\n  fragment LabelFields on Label {\n    id\n    workspaceId\n    teamId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.LabelFieldsFragmentDoc,
    "\n  fragment IssueLabelFields on IssueLabel {\n    id\n    workspaceId\n    issueId\n    labelId\n    teamId\n    groupId\n    createdBy\n    createdAt\n  }\n": typeof types.IssueLabelFieldsFragmentDoc,
    "\n  \n  mutation CreateLabel($input: CreateLabelInput!, $clientId: UUID, $opId: UUID) {\n    createLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n": typeof types.CreateLabelDocument,
    "\n  \n  mutation UpdateLabel($input: UpdateLabelInput!, $clientId: UUID, $opId: UUID) {\n    updateLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n": typeof types.UpdateLabelDocument,
    "\n  mutation ArchiveLabel($id: UUID!, $archived: Boolean!) {\n    archiveLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveLabelDocument,
    "\n  \n  mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      issueLabel {\n        ...IssueLabelFields\n      }\n    }\n  }\n": typeof types.AddIssueLabelDocument,
    "\n  mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveIssueLabelDocument,
    "\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ProjectStatusFieldsFragmentDoc,
    "\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": typeof types.ProjectFieldsFragmentDoc,
    "\n  fragment ProjectTeamFields on ProjectTeam {\n    id\n    workspaceId\n    projectId\n    teamId\n    createdAt\n  }\n": typeof types.ProjectTeamFieldsFragmentDoc,
    "\n  fragment ProjectMemberFields on ProjectMember {\n    id\n    workspaceId\n    projectId\n    userId\n    createdAt\n  }\n": typeof types.ProjectMemberFieldsFragmentDoc,
    "\n  fragment ProjectMilestoneFields on ProjectMilestone {\n    id\n    workspaceId\n    projectId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ProjectMilestoneFieldsFragmentDoc,
    "\n  \n  mutation CreateProject($input: CreateProjectInput!, $clientId: UUID, $opId: UUID) {\n    createProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": typeof types.CreateProjectDocument,
    "\n  \n  mutation UpdateProject($input: UpdateProjectInput!, $clientId: UUID, $opId: UUID) {\n    updateProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": typeof types.UpdateProjectDocument,
    "\n  mutation DeleteProject($id: UUID!, $clientId: UUID, $opId: UUID) {\n    deleteProject(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteProjectDocument,
    "\n  \n  mutation AddProjectTeam($projectId: UUID!, $teamId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectTeam(projectId: $projectId, teamId: $teamId, clientId: $clientId, opId: $opId) {\n      version\n      projectTeam {\n        ...ProjectTeamFields\n      }\n    }\n  }\n": typeof types.AddProjectTeamDocument,
    "\n  \n  mutation AddProjectMember($projectId: UUID!, $userId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectMember(projectId: $projectId, userId: $userId, clientId: $clientId, opId: $opId) {\n      version\n      projectMember {\n        ...ProjectMemberFields\n      }\n    }\n  }\n": typeof types.AddProjectMemberDocument,
    "\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n": typeof types.SearchDocument,
    "\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.IssueTemplateFieldsFragmentDoc,
    "\n  \n  mutation CreateIssueTemplate($input: CreateIssueTemplateInput!) {\n    createIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": typeof types.CreateIssueTemplateDocument,
    "\n  \n  mutation UpdateIssueTemplate($input: UpdateIssueTemplateInput!) {\n    updateIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": typeof types.UpdateIssueTemplateDocument,
    "\n  mutation ArchiveIssueTemplate($id: UUID!, $archived: Boolean!) {\n    archiveIssueTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveIssueTemplateDocument,
    "\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ViewFieldsFragmentDoc,
    "\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n": typeof types.ViewPreferenceFieldsFragmentDoc,
    "\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    position\n    createdAt\n    updatedAt\n  }\n": typeof types.FavoriteFieldsFragmentDoc,
    "\n  \n  mutation CreateView($input: CreateViewInput!) {\n    createView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": typeof types.CreateViewDocument,
    "\n  \n  mutation UpdateView($input: UpdateViewInput!) {\n    updateView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": typeof types.UpdateViewDocument,
    "\n  mutation DeleteView($id: UUID!) {\n    deleteView(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteViewDocument,
    "\n  \n  mutation SetViewPreference($viewKey: String!, $display: JSON!) {\n    setViewPreference(viewKey: $viewKey, display: $display) {\n      version\n      preference {\n        ...ViewPreferenceFields\n      }\n    }\n  }\n": typeof types.SetViewPreferenceDocument,
    "\n  \n  mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!, $afterFavoriteId: UUID) {\n    addFavorite(kind: $kind, targetId: $targetId, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": typeof types.AddFavoriteDocument,
    "\n  mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {\n    removeFavorite(kind: $kind, targetId: $targetId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveFavoriteDocument,
    "\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.IssueFieldsFragmentDoc,
    "\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n": typeof types.TeamFieldsFragmentDoc,
    "\n  fragment StateFields on WorkflowState {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    isSystem\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.StateFieldsFragmentDoc,
    "\n  fragment UserFields on User {\n    id\n    workspaceId\n    name\n    displayName\n    avatarUrl\n    timezone\n    role\n    status\n    kind\n    email\n    notificationPrefs\n    lastSeenAt\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.UserFieldsFragmentDoc,
    "\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    createdAt\n    updatedAt\n  }\n": typeof types.CommentFieldsFragmentDoc,
    "\n  fragment AttachmentFields on Attachment {\n    id\n    workspaceId\n    issueId\n    teamId\n    url\n    title\n    subtitle\n    iconUrl\n    metadata\n    creatorId\n    createdAt\n    updatedAt\n  }\n": typeof types.AttachmentFieldsFragmentDoc,
    "\n  \n  query Viewer {\n    viewer {\n      syncVersion\n      user {\n        ...UserFields\n      }\n      workspace {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n      workspaces {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": typeof types.ViewerDocument,
    "\n  \n  query IssueDetail($id: UUID!) {\n    comments(issueId: $id) {\n      ...CommentFields\n    }\n    issueHistory(issueId: $id) {\n      id\n      issueId\n      kind\n      fromValue\n      toValue\n      createdAt\n      actor {\n        type\n        id\n      }\n    }\n  }\n": typeof types.IssueDetailDocument,
    "\n  \n  mutation CreateIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.CreateIssueDocument,
    "\n  \n  mutation UpdateIssue($input: UpdateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    updateIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.UpdateIssueDocument,
    "\n  mutation ArchiveIssue($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveIssue(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveIssueDocument,
    "\n  mutation DeleteIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteIssueDocument,
    "\n  \n  mutation CreateComment($input: CreateCommentInput!, $clientId: UUID!, $opId: UUID!) {\n    createComment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n": typeof types.CreateCommentDocument,
    "\n  \n  mutation UpdateComment($id: UUID!, $body: String!, $clientId: UUID!, $opId: UUID!) {\n    updateComment(id: $id, body: $body, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n": typeof types.UpdateCommentDocument,
    "\n  mutation DeleteComment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteComment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteCommentDocument,
    "\n  \n  mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    createAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": typeof types.CreateAttachmentDocument,
    "\n  \n  mutation UpdateAttachment($input: UpdateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": typeof types.UpdateAttachmentDocument,
    "\n  mutation DeleteAttachment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAttachment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteAttachmentDocument,
    "\n  \n  \n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n        states {\n          ...StateFields\n        }\n      }\n    }\n  }\n": typeof types.CreateTeamDocument,
    "\n  \n  mutation UpdateTeam($input: UpdateTeamInput!) {\n    updateTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamDocument,
    "\n  fragment CycleFields on Cycle {\n    id\n    workspaceId\n    teamId\n    number\n    name\n    description\n    startsAt\n    endsAt\n    completedAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.CycleFieldsFragmentDoc,
    "\n  \n  mutation UpdateTeamCycles($input: UpdateTeamCyclesInput!) {\n    updateTeamCycles(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamCyclesDocument,
    "\n  \n  mutation UpdateTeamTriage($input: UpdateTeamTriageInput!) {\n    updateTeamTriage(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamTriageDocument,
    "\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamArchiveDocument,
    "\n  \n  mutation AcceptTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    acceptTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.AcceptTriageIssueDocument,
    "\n  \n  mutation DeclineTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    declineTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.DeclineTriageIssueDocument,
    "\n  \n  mutation MarkIssueDuplicate($id: UUID!, $canonicalId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    markIssueDuplicate(id: $id, canonicalId: $canonicalId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.MarkIssueDuplicateDocument,
    "\n  \n  mutation SnoozeIssue($id: UUID!, $until: Time!, $clientId: UUID!, $opId: UUID!) {\n    snoozeIssue(id: $id, until: $until, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.SnoozeIssueDocument,
    "\n  \n  mutation CreateWorkflowState($input: CreateWorkflowStateInput!) {\n    createWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n": typeof types.CreateWorkflowStateDocument,
    "\n  \n  mutation UpdateWorkflowState($input: UpdateWorkflowStateInput!) {\n    updateWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n": typeof types.UpdateWorkflowStateDocument,
    "\n  mutation ArchiveWorkflowState($id: UUID!, $archived: Boolean!) {\n    archiveWorkflowState(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveWorkflowStateDocument,
    "\n  \n  mutation SetUserRole($userId: UUID!, $role: UserRole!) {\n    setUserRole(userId: $userId, role: $role) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": typeof types.SetUserRoleDocument,
    "\n  \n  mutation SuspendUser($userId: UUID!, $suspended: Boolean!) {\n    suspendUser(userId: $userId, suspended: $suspended) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": typeof types.SuspendUserDocument,
    "\n  \n  mutation UpdateProfile($input: UpdateProfileInput!) {\n    updateProfile(input: $input) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": typeof types.UpdateProfileDocument,
};
const documents: Documents = {
    "\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        lapsed\n      }\n    }\n  }\n": types.EntitlementsDocument,
    "\n  query Invites {\n    invites {\n      id\n      email\n      role\n      invitedBy\n      teamIds\n      expiresAt\n      createdAt\n    }\n  }\n": types.InvitesDocument,
    "\n  mutation InviteToWorkspace($input: InviteInput!) {\n    inviteToWorkspace(input: $input) {\n      id\n      email\n      role\n      expiresAt\n      token\n    }\n  }\n": types.InviteToWorkspaceDocument,
    "\n  mutation RevokeInvite($id: UUID!) {\n    revokeInvite(id: $id) {\n      version\n      id\n    }\n  }\n": types.RevokeInviteDocument,
    "\n  mutation RemoveUser($userId: UUID!) {\n    removeUser(userId: $userId) {\n      version\n      id\n    }\n  }\n": types.RemoveUserDocument,
    "\n  \n  query DeletedIssues {\n    deletedIssues {\n      ...IssueFields\n    }\n  }\n": types.DeletedIssuesDocument,
    "\n  \n  mutation RestoreIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.RestoreIssueDocument,
    "\n  fragment ApiKeyFields on ApiKey {\n    id\n    userId\n    name\n    prefix\n    scopes\n    lastUsedAt\n    expiresAt\n    revokedAt\n    createdAt\n  }\n": types.ApiKeyFieldsFragmentDoc,
    "\n  \n  query ApiKeys {\n    apiKeys {\n      ...ApiKeyFields\n    }\n  }\n": types.ApiKeysDocument,
    "\n  \n  mutation CreateApiKey($input: CreateApiKeyInput!) {\n    createApiKey(input: $input) {\n      version\n      created {\n        token\n        apiKey {\n          ...ApiKeyFields\n        }\n      }\n    }\n  }\n": types.CreateApiKeyDocument,
    "\n  mutation RevokeApiKey($id: UUID!) {\n    revokeApiKey(id: $id) {\n      version\n      id\n    }\n  }\n": types.RevokeApiKeyDocument,
    "\n  \n  query ArchivedIssues($teamId: UUID!) {\n    archivedIssues(teamId: $teamId) {\n      ...IssueFields\n    }\n  }\n": types.ArchivedIssuesDocument,
    "\n  \n  query ArchivedCycles($teamId: UUID!) {\n    archivedCycles(teamId: $teamId) {\n      ...CycleFields\n    }\n  }\n": types.ArchivedCyclesDocument,
    "\n  \n  query ArchivedProjects($teamId: UUID!) {\n    archivedProjects(teamId: $teamId) {\n      ...ProjectFields\n    }\n  }\n": types.ArchivedProjectsDocument,
    "\n  mutation ArchiveCycle($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCycle(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.ArchiveCycleDocument,
    "\n  mutation ArchiveProject($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveProject(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.ArchiveProjectDocument,
    "\n  fragment NotificationFields on Notification {\n    id\n    workspaceId\n    userId\n    type\n    issueId\n    commentId\n    actor {\n      type\n      id\n    }\n    changeVersion\n    groupKey\n    count\n    payload\n    readAt\n    snoozedUntil\n    createdAt\n    updatedAt\n  }\n": types.NotificationFieldsFragmentDoc,
    "\n  \n  query Inbox($first: Int!) {\n    notifications(includeRead: true, includeSnoozed: true, first: $first) {\n      ...NotificationFields\n    }\n  }\n": types.InboxDocument,
    "\n  query UnreadNotificationCount {\n    unreadNotificationCount\n  }\n": types.UnreadNotificationCountDocument,
    "\n  \n  mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {\n    markNotificationRead(id: $id, read: $read) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": types.MarkNotificationReadDocument,
    "\n  \n  mutation MarkAllNotificationsRead {\n    markAllNotificationsRead {\n      version\n      notifications {\n        ...NotificationFields\n      }\n    }\n  }\n": types.MarkAllNotificationsReadDocument,
    "\n  \n  mutation SnoozeNotification($id: UUID!, $until: Time) {\n    snoozeNotification(id: $id, until: $until) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": types.SnoozeNotificationDocument,
    "\n  mutation DeleteNotification($id: UUID!) {\n    deleteNotification(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteNotificationDocument,
    "\n  \n  mutation UpdateNotificationPrefs($prefs: JSON!) {\n    updateNotificationPrefs(prefs: $prefs) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": types.UpdateNotificationPrefsDocument,
    "\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": types.SubIssueFieldsFragmentDoc,
    "\n  fragment RelationFields on IssueRelation {\n    id\n    workspaceId\n    issueId\n    relatedIssueId\n    type\n    teamId\n    relatedTeamId\n    createdBy\n    createdAt\n  }\n": types.RelationFieldsFragmentDoc,
    "\n  fragment SubscriptionFields on IssueSubscription {\n    id\n    workspaceId\n    issueId\n    userId\n    reason\n    unsubscribed\n    createdAt\n    updatedAt\n  }\n": types.SubscriptionFieldsFragmentDoc,
    "\n  \n  mutation CreateSubIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...SubIssueFields\n      }\n    }\n  }\n": types.CreateSubIssueDocument,
    "\n  \n  mutation CreateIssueRelation(\n    $issueId: UUID!\n    $relatedIssueId: UUID!\n    $type: RelationType!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createIssueRelation(\n      issueId: $issueId\n      relatedIssueId: $relatedIssueId\n      type: $type\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      relation {\n        ...RelationFields\n      }\n    }\n  }\n": types.CreateIssueRelationDocument,
    "\n  mutation DeleteIssueRelation($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssueRelation(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteIssueRelationDocument,
    "\n  \n  mutation SetIssueSubscription($issueId: UUID!, $subscribed: Boolean!) {\n    setIssueSubscription(issueId: $issueId, subscribed: $subscribed) {\n      version\n      subscription {\n        ...SubscriptionFields\n      }\n    }\n  }\n": types.SetIssueSubscriptionDocument,
    "\n  fragment LabelFields on Label {\n    id\n    workspaceId\n    teamId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.LabelFieldsFragmentDoc,
    "\n  fragment IssueLabelFields on IssueLabel {\n    id\n    workspaceId\n    issueId\n    labelId\n    teamId\n    groupId\n    createdBy\n    createdAt\n  }\n": types.IssueLabelFieldsFragmentDoc,
    "\n  \n  mutation CreateLabel($input: CreateLabelInput!, $clientId: UUID, $opId: UUID) {\n    createLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n": types.CreateLabelDocument,
    "\n  \n  mutation UpdateLabel($input: UpdateLabelInput!, $clientId: UUID, $opId: UUID) {\n    updateLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n": types.UpdateLabelDocument,
    "\n  mutation ArchiveLabel($id: UUID!, $archived: Boolean!) {\n    archiveLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveLabelDocument,
    "\n  \n  mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      issueLabel {\n        ...IssueLabelFields\n      }\n    }\n  }\n": types.AddIssueLabelDocument,
    "\n  mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.RemoveIssueLabelDocument,
    "\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ProjectStatusFieldsFragmentDoc,
    "\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": types.ProjectFieldsFragmentDoc,
    "\n  fragment ProjectTeamFields on ProjectTeam {\n    id\n    workspaceId\n    projectId\n    teamId\n    createdAt\n  }\n": types.ProjectTeamFieldsFragmentDoc,
    "\n  fragment ProjectMemberFields on ProjectMember {\n    id\n    workspaceId\n    projectId\n    userId\n    createdAt\n  }\n": types.ProjectMemberFieldsFragmentDoc,
    "\n  fragment ProjectMilestoneFields on ProjectMilestone {\n    id\n    workspaceId\n    projectId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ProjectMilestoneFieldsFragmentDoc,
    "\n  \n  mutation CreateProject($input: CreateProjectInput!, $clientId: UUID, $opId: UUID) {\n    createProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": types.CreateProjectDocument,
    "\n  \n  mutation UpdateProject($input: UpdateProjectInput!, $clientId: UUID, $opId: UUID) {\n    updateProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": types.UpdateProjectDocument,
    "\n  mutation DeleteProject($id: UUID!, $clientId: UUID, $opId: UUID) {\n    deleteProject(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteProjectDocument,
    "\n  \n  mutation AddProjectTeam($projectId: UUID!, $teamId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectTeam(projectId: $projectId, teamId: $teamId, clientId: $clientId, opId: $opId) {\n      version\n      projectTeam {\n        ...ProjectTeamFields\n      }\n    }\n  }\n": types.AddProjectTeamDocument,
    "\n  \n  mutation AddProjectMember($projectId: UUID!, $userId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectMember(projectId: $projectId, userId: $userId, clientId: $clientId, opId: $opId) {\n      version\n      projectMember {\n        ...ProjectMemberFields\n      }\n    }\n  }\n": types.AddProjectMemberDocument,
    "\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n": types.SearchDocument,
    "\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.IssueTemplateFieldsFragmentDoc,
    "\n  \n  mutation CreateIssueTemplate($input: CreateIssueTemplateInput!) {\n    createIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": types.CreateIssueTemplateDocument,
    "\n  \n  mutation UpdateIssueTemplate($input: UpdateIssueTemplateInput!) {\n    updateIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": types.UpdateIssueTemplateDocument,
    "\n  mutation ArchiveIssueTemplate($id: UUID!, $archived: Boolean!) {\n    archiveIssueTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveIssueTemplateDocument,
    "\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ViewFieldsFragmentDoc,
    "\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n": types.ViewPreferenceFieldsFragmentDoc,
    "\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    position\n    createdAt\n    updatedAt\n  }\n": types.FavoriteFieldsFragmentDoc,
    "\n  \n  mutation CreateView($input: CreateViewInput!) {\n    createView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": types.CreateViewDocument,
    "\n  \n  mutation UpdateView($input: UpdateViewInput!) {\n    updateView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": types.UpdateViewDocument,
    "\n  mutation DeleteView($id: UUID!) {\n    deleteView(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteViewDocument,
    "\n  \n  mutation SetViewPreference($viewKey: String!, $display: JSON!) {\n    setViewPreference(viewKey: $viewKey, display: $display) {\n      version\n      preference {\n        ...ViewPreferenceFields\n      }\n    }\n  }\n": types.SetViewPreferenceDocument,
    "\n  \n  mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!, $afterFavoriteId: UUID) {\n    addFavorite(kind: $kind, targetId: $targetId, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": types.AddFavoriteDocument,
    "\n  mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {\n    removeFavorite(kind: $kind, targetId: $targetId) {\n      version\n      id\n    }\n  }\n": types.RemoveFavoriteDocument,
    "\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": types.IssueFieldsFragmentDoc,
    "\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n": types.TeamFieldsFragmentDoc,
    "\n  fragment StateFields on WorkflowState {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    isSystem\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.StateFieldsFragmentDoc,
    "\n  fragment UserFields on User {\n    id\n    workspaceId\n    name\n    displayName\n    avatarUrl\n    timezone\n    role\n    status\n    kind\n    email\n    notificationPrefs\n    lastSeenAt\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.UserFieldsFragmentDoc,
    "\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    createdAt\n    updatedAt\n  }\n": types.CommentFieldsFragmentDoc,
    "\n  fragment AttachmentFields on Attachment {\n    id\n    workspaceId\n    issueId\n    teamId\n    url\n    title\n    subtitle\n    iconUrl\n    metadata\n    creatorId\n    createdAt\n    updatedAt\n  }\n": types.AttachmentFieldsFragmentDoc,
    "\n  \n  query Viewer {\n    viewer {\n      syncVersion\n      user {\n        ...UserFields\n      }\n      workspace {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n      workspaces {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": types.ViewerDocument,
    "\n  \n  query IssueDetail($id: UUID!) {\n    comments(issueId: $id) {\n      ...CommentFields\n    }\n    issueHistory(issueId: $id) {\n      id\n      issueId\n      kind\n      fromValue\n      toValue\n      createdAt\n      actor {\n        type\n        id\n      }\n    }\n  }\n": types.IssueDetailDocument,
    "\n  \n  mutation CreateIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.CreateIssueDocument,
    "\n  \n  mutation UpdateIssue($input: UpdateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    updateIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.UpdateIssueDocument,
    "\n  mutation ArchiveIssue($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveIssue(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.ArchiveIssueDocument,
    "\n  mutation DeleteIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteIssueDocument,
    "\n  \n  mutation CreateComment($input: CreateCommentInput!, $clientId: UUID!, $opId: UUID!) {\n    createComment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n": types.CreateCommentDocument,
    "\n  \n  mutation UpdateComment($id: UUID!, $body: String!, $clientId: UUID!, $opId: UUID!) {\n    updateComment(id: $id, body: $body, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n": types.UpdateCommentDocument,
    "\n  mutation DeleteComment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteComment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteCommentDocument,
    "\n  \n  mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    createAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": types.CreateAttachmentDocument,
    "\n  \n  mutation UpdateAttachment($input: UpdateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": types.UpdateAttachmentDocument,
    "\n  mutation DeleteAttachment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAttachment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteAttachmentDocument,
    "\n  \n  \n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n        states {\n          ...StateFields\n        }\n      }\n    }\n  }\n": types.CreateTeamDocument,
    "\n  \n  mutation UpdateTeam($input: UpdateTeamInput!) {\n    updateTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamDocument,
    "\n  fragment CycleFields on Cycle {\n    id\n    workspaceId\n    teamId\n    number\n    name\n    description\n    startsAt\n    endsAt\n    completedAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": types.CycleFieldsFragmentDoc,
    "\n  \n  mutation UpdateTeamCycles($input: UpdateTeamCyclesInput!) {\n    updateTeamCycles(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamCyclesDocument,
    "\n  \n  mutation UpdateTeamTriage($input: UpdateTeamTriageInput!) {\n    updateTeamTriage(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamTriageDocument,
    "\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamArchiveDocument,
    "\n  \n  mutation AcceptTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    acceptTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.AcceptTriageIssueDocument,
    "\n  \n  mutation DeclineTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    declineTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.DeclineTriageIssueDocument,
    "\n  \n  mutation MarkIssueDuplicate($id: UUID!, $canonicalId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    markIssueDuplicate(id: $id, canonicalId: $canonicalId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.MarkIssueDuplicateDocument,
    "\n  \n  mutation SnoozeIssue($id: UUID!, $until: Time!, $clientId: UUID!, $opId: UUID!) {\n    snoozeIssue(id: $id, until: $until, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.SnoozeIssueDocument,
    "\n  \n  mutation CreateWorkflowState($input: CreateWorkflowStateInput!) {\n    createWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n": types.CreateWorkflowStateDocument,
    "\n  \n  mutation UpdateWorkflowState($input: UpdateWorkflowStateInput!) {\n    updateWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n": types.UpdateWorkflowStateDocument,
    "\n  mutation ArchiveWorkflowState($id: UUID!, $archived: Boolean!) {\n    archiveWorkflowState(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveWorkflowStateDocument,
    "\n  \n  mutation SetUserRole($userId: UUID!, $role: UserRole!) {\n    setUserRole(userId: $userId, role: $role) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": types.SetUserRoleDocument,
    "\n  \n  mutation SuspendUser($userId: UUID!, $suspended: Boolean!) {\n    suspendUser(userId: $userId, suspended: $suspended) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": types.SuspendUserDocument,
    "\n  \n  mutation UpdateProfile($input: UpdateProfileInput!) {\n    updateProfile(input: $input) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": types.UpdateProfileDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        lapsed\n      }\n    }\n  }\n"): (typeof documents)["\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        lapsed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Invites {\n    invites {\n      id\n      email\n      role\n      invitedBy\n      teamIds\n      expiresAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query Invites {\n    invites {\n      id\n      email\n      role\n      invitedBy\n      teamIds\n      expiresAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation InviteToWorkspace($input: InviteInput!) {\n    inviteToWorkspace(input: $input) {\n      id\n      email\n      role\n      expiresAt\n      token\n    }\n  }\n"): (typeof documents)["\n  mutation InviteToWorkspace($input: InviteInput!) {\n    inviteToWorkspace(input: $input) {\n      id\n      email\n      role\n      expiresAt\n      token\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RevokeInvite($id: UUID!) {\n    revokeInvite(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RevokeInvite($id: UUID!) {\n    revokeInvite(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveUser($userId: UUID!) {\n    removeUser(userId: $userId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveUser($userId: UUID!) {\n    removeUser(userId: $userId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query DeletedIssues {\n    deletedIssues {\n      ...IssueFields\n    }\n  }\n"): (typeof documents)["\n  \n  query DeletedIssues {\n    deletedIssues {\n      ...IssueFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation RestoreIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation RestoreIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ApiKeyFields on ApiKey {\n    id\n    userId\n    name\n    prefix\n    scopes\n    lastUsedAt\n    expiresAt\n    revokedAt\n    createdAt\n  }\n"): (typeof documents)["\n  fragment ApiKeyFields on ApiKey {\n    id\n    userId\n    name\n    prefix\n    scopes\n    lastUsedAt\n    expiresAt\n    revokedAt\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query ApiKeys {\n    apiKeys {\n      ...ApiKeyFields\n    }\n  }\n"): (typeof documents)["\n  \n  query ApiKeys {\n    apiKeys {\n      ...ApiKeyFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateApiKey($input: CreateApiKeyInput!) {\n    createApiKey(input: $input) {\n      version\n      created {\n        token\n        apiKey {\n          ...ApiKeyFields\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateApiKey($input: CreateApiKeyInput!) {\n    createApiKey(input: $input) {\n      version\n      created {\n        token\n        apiKey {\n          ...ApiKeyFields\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RevokeApiKey($id: UUID!) {\n    revokeApiKey(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RevokeApiKey($id: UUID!) {\n    revokeApiKey(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query ArchivedIssues($teamId: UUID!) {\n    archivedIssues(teamId: $teamId) {\n      ...IssueFields\n    }\n  }\n"): (typeof documents)["\n  \n  query ArchivedIssues($teamId: UUID!) {\n    archivedIssues(teamId: $teamId) {\n      ...IssueFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query ArchivedCycles($teamId: UUID!) {\n    archivedCycles(teamId: $teamId) {\n      ...CycleFields\n    }\n  }\n"): (typeof documents)["\n  \n  query ArchivedCycles($teamId: UUID!) {\n    archivedCycles(teamId: $teamId) {\n      ...CycleFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query ArchivedProjects($teamId: UUID!) {\n    archivedProjects(teamId: $teamId) {\n      ...ProjectFields\n    }\n  }\n"): (typeof documents)["\n  \n  query ArchivedProjects($teamId: UUID!) {\n    archivedProjects(teamId: $teamId) {\n      ...ProjectFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveCycle($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCycle(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveCycle($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCycle(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveProject($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveProject(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveProject($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveProject(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment NotificationFields on Notification {\n    id\n    workspaceId\n    userId\n    type\n    issueId\n    commentId\n    actor {\n      type\n      id\n    }\n    changeVersion\n    groupKey\n    count\n    payload\n    readAt\n    snoozedUntil\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment NotificationFields on Notification {\n    id\n    workspaceId\n    userId\n    type\n    issueId\n    commentId\n    actor {\n      type\n      id\n    }\n    changeVersion\n    groupKey\n    count\n    payload\n    readAt\n    snoozedUntil\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query Inbox($first: Int!) {\n    notifications(includeRead: true, includeSnoozed: true, first: $first) {\n      ...NotificationFields\n    }\n  }\n"): (typeof documents)["\n  \n  query Inbox($first: Int!) {\n    notifications(includeRead: true, includeSnoozed: true, first: $first) {\n      ...NotificationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query UnreadNotificationCount {\n    unreadNotificationCount\n  }\n"): (typeof documents)["\n  query UnreadNotificationCount {\n    unreadNotificationCount\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {\n    markNotificationRead(id: $id, read: $read) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {\n    markNotificationRead(id: $id, read: $read) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation MarkAllNotificationsRead {\n    markAllNotificationsRead {\n      version\n      notifications {\n        ...NotificationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation MarkAllNotificationsRead {\n    markAllNotificationsRead {\n      version\n      notifications {\n        ...NotificationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SnoozeNotification($id: UUID!, $until: Time) {\n    snoozeNotification(id: $id, until: $until) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SnoozeNotification($id: UUID!, $until: Time) {\n    snoozeNotification(id: $id, until: $until) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteNotification($id: UUID!) {\n    deleteNotification(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteNotification($id: UUID!) {\n    deleteNotification(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateNotificationPrefs($prefs: JSON!) {\n    updateNotificationPrefs(prefs: $prefs) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateNotificationPrefs($prefs: JSON!) {\n    updateNotificationPrefs(prefs: $prefs) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment RelationFields on IssueRelation {\n    id\n    workspaceId\n    issueId\n    relatedIssueId\n    type\n    teamId\n    relatedTeamId\n    createdBy\n    createdAt\n  }\n"): (typeof documents)["\n  fragment RelationFields on IssueRelation {\n    id\n    workspaceId\n    issueId\n    relatedIssueId\n    type\n    teamId\n    relatedTeamId\n    createdBy\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SubscriptionFields on IssueSubscription {\n    id\n    workspaceId\n    issueId\n    userId\n    reason\n    unsubscribed\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment SubscriptionFields on IssueSubscription {\n    id\n    workspaceId\n    issueId\n    userId\n    reason\n    unsubscribed\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateSubIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...SubIssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateSubIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...SubIssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateIssueRelation(\n    $issueId: UUID!\n    $relatedIssueId: UUID!\n    $type: RelationType!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createIssueRelation(\n      issueId: $issueId\n      relatedIssueId: $relatedIssueId\n      type: $type\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      relation {\n        ...RelationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateIssueRelation(\n    $issueId: UUID!\n    $relatedIssueId: UUID!\n    $type: RelationType!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createIssueRelation(\n      issueId: $issueId\n      relatedIssueId: $relatedIssueId\n      type: $type\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      relation {\n        ...RelationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteIssueRelation($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssueRelation(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteIssueRelation($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssueRelation(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SetIssueSubscription($issueId: UUID!, $subscribed: Boolean!) {\n    setIssueSubscription(issueId: $issueId, subscribed: $subscribed) {\n      version\n      subscription {\n        ...SubscriptionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SetIssueSubscription($issueId: UUID!, $subscribed: Boolean!) {\n    setIssueSubscription(issueId: $issueId, subscribed: $subscribed) {\n      version\n      subscription {\n        ...SubscriptionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment LabelFields on Label {\n    id\n    workspaceId\n    teamId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment LabelFields on Label {\n    id\n    workspaceId\n    teamId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment IssueLabelFields on IssueLabel {\n    id\n    workspaceId\n    issueId\n    labelId\n    teamId\n    groupId\n    createdBy\n    createdAt\n  }\n"): (typeof documents)["\n  fragment IssueLabelFields on IssueLabel {\n    id\n    workspaceId\n    issueId\n    labelId\n    teamId\n    groupId\n    createdBy\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateLabel($input: CreateLabelInput!, $clientId: UUID, $opId: UUID) {\n    createLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateLabel($input: CreateLabelInput!, $clientId: UUID, $opId: UUID) {\n    createLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateLabel($input: UpdateLabelInput!, $clientId: UUID, $opId: UUID) {\n    updateLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateLabel($input: UpdateLabelInput!, $clientId: UUID, $opId: UUID) {\n    updateLabel(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveLabel($id: UUID!, $archived: Boolean!) {\n    archiveLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveLabel($id: UUID!, $archived: Boolean!) {\n    archiveLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      issueLabel {\n        ...IssueLabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      issueLabel {\n        ...IssueLabelFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectTeamFields on ProjectTeam {\n    id\n    workspaceId\n    projectId\n    teamId\n    createdAt\n  }\n"): (typeof documents)["\n  fragment ProjectTeamFields on ProjectTeam {\n    id\n    workspaceId\n    projectId\n    teamId\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectMemberFields on ProjectMember {\n    id\n    workspaceId\n    projectId\n    userId\n    createdAt\n  }\n"): (typeof documents)["\n  fragment ProjectMemberFields on ProjectMember {\n    id\n    workspaceId\n    projectId\n    userId\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectMilestoneFields on ProjectMilestone {\n    id\n    workspaceId\n    projectId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment ProjectMilestoneFields on ProjectMilestone {\n    id\n    workspaceId\n    projectId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateProject($input: CreateProjectInput!, $clientId: UUID, $opId: UUID) {\n    createProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateProject($input: CreateProjectInput!, $clientId: UUID, $opId: UUID) {\n    createProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProject($input: UpdateProjectInput!, $clientId: UUID, $opId: UUID) {\n    updateProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProject($input: UpdateProjectInput!, $clientId: UUID, $opId: UUID) {\n    updateProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteProject($id: UUID!, $clientId: UUID, $opId: UUID) {\n    deleteProject(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteProject($id: UUID!, $clientId: UUID, $opId: UUID) {\n    deleteProject(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddProjectTeam($projectId: UUID!, $teamId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectTeam(projectId: $projectId, teamId: $teamId, clientId: $clientId, opId: $opId) {\n      version\n      projectTeam {\n        ...ProjectTeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddProjectTeam($projectId: UUID!, $teamId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectTeam(projectId: $projectId, teamId: $teamId, clientId: $clientId, opId: $opId) {\n      version\n      projectTeam {\n        ...ProjectTeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddProjectMember($projectId: UUID!, $userId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectMember(projectId: $projectId, userId: $userId, clientId: $clientId, opId: $opId) {\n      version\n      projectMember {\n        ...ProjectMemberFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddProjectMember($projectId: UUID!, $userId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectMember(projectId: $projectId, userId: $userId, clientId: $clientId, opId: $opId) {\n      version\n      projectMember {\n        ...ProjectMemberFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateIssueTemplate($input: CreateIssueTemplateInput!) {\n    createIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateIssueTemplate($input: CreateIssueTemplateInput!) {\n    createIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateIssueTemplate($input: UpdateIssueTemplateInput!) {\n    updateIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateIssueTemplate($input: UpdateIssueTemplateInput!) {\n    updateIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveIssueTemplate($id: UUID!, $archived: Boolean!) {\n    archiveIssueTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveIssueTemplate($id: UUID!, $archived: Boolean!) {\n    archiveIssueTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    position\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    position\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateView($input: CreateViewInput!) {\n    createView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateView($input: CreateViewInput!) {\n    createView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateView($input: UpdateViewInput!) {\n    updateView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateView($input: UpdateViewInput!) {\n    updateView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteView($id: UUID!) {\n    deleteView(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteView($id: UUID!) {\n    deleteView(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SetViewPreference($viewKey: String!, $display: JSON!) {\n    setViewPreference(viewKey: $viewKey, display: $display) {\n      version\n      preference {\n        ...ViewPreferenceFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SetViewPreference($viewKey: String!, $display: JSON!) {\n    setViewPreference(viewKey: $viewKey, display: $display) {\n      version\n      preference {\n        ...ViewPreferenceFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!, $afterFavoriteId: UUID) {\n    addFavorite(kind: $kind, targetId: $targetId, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!, $afterFavoriteId: UUID) {\n    addFavorite(kind: $kind, targetId: $targetId, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {\n    removeFavorite(kind: $kind, targetId: $targetId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {\n    removeFavorite(kind: $kind, targetId: $targetId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment StateFields on WorkflowState {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    isSystem\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment StateFields on WorkflowState {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    isSystem\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment UserFields on User {\n    id\n    workspaceId\n    name\n    displayName\n    avatarUrl\n    timezone\n    role\n    status\n    kind\n    email\n    notificationPrefs\n    lastSeenAt\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment UserFields on User {\n    id\n    workspaceId\n    name\n    displayName\n    avatarUrl\n    timezone\n    role\n    status\n    kind\n    email\n    notificationPrefs\n    lastSeenAt\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AttachmentFields on Attachment {\n    id\n    workspaceId\n    issueId\n    teamId\n    url\n    title\n    subtitle\n    iconUrl\n    metadata\n    creatorId\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment AttachmentFields on Attachment {\n    id\n    workspaceId\n    issueId\n    teamId\n    url\n    title\n    subtitle\n    iconUrl\n    metadata\n    creatorId\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query Viewer {\n    viewer {\n      syncVersion\n      user {\n        ...UserFields\n      }\n      workspace {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n      workspaces {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  query Viewer {\n    viewer {\n      syncVersion\n      user {\n        ...UserFields\n      }\n      workspace {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n      workspaces {\n        id\n        name\n        urlKey\n        logoUrl\n        plan\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query IssueDetail($id: UUID!) {\n    comments(issueId: $id) {\n      ...CommentFields\n    }\n    issueHistory(issueId: $id) {\n      id\n      issueId\n      kind\n      fromValue\n      toValue\n      createdAt\n      actor {\n        type\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  query IssueDetail($id: UUID!) {\n    comments(issueId: $id) {\n      ...CommentFields\n    }\n    issueHistory(issueId: $id) {\n      id\n      issueId\n      kind\n      fromValue\n      toValue\n      createdAt\n      actor {\n        type\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    createIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateIssue($input: UpdateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    updateIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateIssue($input: UpdateIssueInput!, $clientId: UUID!, $opId: UUID!) {\n    updateIssue(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveIssue($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveIssue(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveIssue($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveIssue(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateComment($input: CreateCommentInput!, $clientId: UUID!, $opId: UUID!) {\n    createComment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateComment($input: CreateCommentInput!, $clientId: UUID!, $opId: UUID!) {\n    createComment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateComment($id: UUID!, $body: String!, $clientId: UUID!, $opId: UUID!) {\n    updateComment(id: $id, body: $body, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateComment($id: UUID!, $body: String!, $clientId: UUID!, $opId: UUID!) {\n    updateComment(id: $id, body: $body, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteComment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteComment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteComment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteComment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    createAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    createAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateAttachment($input: UpdateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateAttachment($input: UpdateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAttachment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAttachment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteAttachment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAttachment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  \n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n        states {\n          ...StateFields\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  \n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n        states {\n          ...StateFields\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateTeam($input: UpdateTeamInput!) {\n    updateTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateTeam($input: UpdateTeamInput!) {\n    updateTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CycleFields on Cycle {\n    id\n    workspaceId\n    teamId\n    number\n    name\n    description\n    startsAt\n    endsAt\n    completedAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment CycleFields on Cycle {\n    id\n    workspaceId\n    teamId\n    number\n    name\n    description\n    startsAt\n    endsAt\n    completedAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateTeamCycles($input: UpdateTeamCyclesInput!) {\n    updateTeamCycles(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateTeamCycles($input: UpdateTeamCyclesInput!) {\n    updateTeamCycles(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateTeamTriage($input: UpdateTeamTriageInput!) {\n    updateTeamTriage(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateTeamTriage($input: UpdateTeamTriageInput!) {\n    updateTeamTriage(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AcceptTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    acceptTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AcceptTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    acceptTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation DeclineTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    declineTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation DeclineTriageIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    declineTriageIssue(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation MarkIssueDuplicate($id: UUID!, $canonicalId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    markIssueDuplicate(id: $id, canonicalId: $canonicalId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation MarkIssueDuplicate($id: UUID!, $canonicalId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    markIssueDuplicate(id: $id, canonicalId: $canonicalId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SnoozeIssue($id: UUID!, $until: Time!, $clientId: UUID!, $opId: UUID!) {\n    snoozeIssue(id: $id, until: $until, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SnoozeIssue($id: UUID!, $until: Time!, $clientId: UUID!, $opId: UUID!) {\n    snoozeIssue(id: $id, until: $until, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateWorkflowState($input: CreateWorkflowStateInput!) {\n    createWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateWorkflowState($input: CreateWorkflowStateInput!) {\n    createWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateWorkflowState($input: UpdateWorkflowStateInput!) {\n    updateWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateWorkflowState($input: UpdateWorkflowStateInput!) {\n    updateWorkflowState(input: $input) {\n      version\n      state {\n        ...StateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveWorkflowState($id: UUID!, $archived: Boolean!) {\n    archiveWorkflowState(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveWorkflowState($id: UUID!, $archived: Boolean!) {\n    archiveWorkflowState(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SetUserRole($userId: UUID!, $role: UserRole!) {\n    setUserRole(userId: $userId, role: $role) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SetUserRole($userId: UUID!, $role: UserRole!) {\n    setUserRole(userId: $userId, role: $role) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SuspendUser($userId: UUID!, $suspended: Boolean!) {\n    suspendUser(userId: $userId, suspended: $suspended) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SuspendUser($userId: UUID!, $suspended: Boolean!) {\n    suspendUser(userId: $userId, suspended: $suspended) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProfile($input: UpdateProfileInput!) {\n    updateProfile(input: $input) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProfile($input: UpdateProfileInput!) {\n    updateProfile(input: $input) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;