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
    "\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        subTeams\n        multiLevelSubTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        slas\n        slack\n        lapsed\n      }\n    }\n  }\n": typeof types.EntitlementsDocument,
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
    "\n  fragment AskFormFields on AskForm {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    token\n    creatorId\n    archivedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.AskFormFieldsFragmentDoc,
    "\n  \n  mutation CreateAskForm($input: CreateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    createAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n": typeof types.CreateAskFormDocument,
    "\n  \n  mutation UpdateAskForm($input: UpdateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n": typeof types.UpdateAskFormDocument,
    "\n  mutation ArchiveAskForm($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveAskForm(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveAskFormDocument,
    "\n  mutation DeleteAskForm($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAskForm(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteAskFormDocument,
    "\n  fragment CustomerFields on Customer {\n    id\n    workspaceId\n    name\n    domains\n    revenue\n    size\n    tier\n    status\n    ownerId\n    logoUrl\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": typeof types.CustomerFieldsFragmentDoc,
    "\n  fragment CustomerRequestFields on CustomerRequest {\n    id\n    workspaceId\n    customerId\n    issueId\n    projectId\n    body\n    important\n    creatorId\n    createdAt\n    updatedAt\n  }\n": typeof types.CustomerRequestFieldsFragmentDoc,
    "\n  \n  mutation CreateCustomer($input: CreateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    createCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n": typeof types.CreateCustomerDocument,
    "\n  \n  mutation UpdateCustomer($input: UpdateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n": typeof types.UpdateCustomerDocument,
    "\n  \n  mutation CreateCustomerRequest(\n    $input: CreateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n": typeof types.CreateCustomerRequestDocument,
    "\n  \n  mutation UpdateCustomerRequest(\n    $input: UpdateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n": typeof types.UpdateCustomerRequestDocument,
    "\n  mutation DeleteCustomerRequest($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteCustomerRequest(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteCustomerRequestDocument,
    "\n  mutation ArchiveCustomer($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCustomer(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveCustomerDocument,
    "\n  \n  mutation MergeCustomers($sourceId: UUID!, $intoId: UUID!) {\n    mergeCustomers(sourceId: $sourceId, intoId: $intoId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n": typeof types.MergeCustomersDocument,
    "\n  mutation EnsureCycleCalendarFeed($teamId: UUID!) {\n    ensureCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": typeof types.EnsureCycleCalendarFeedDocument,
    "\n  mutation RotateCycleCalendarFeed($teamId: UUID!) {\n    rotateCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": typeof types.RotateCycleCalendarFeedDocument,
    "\n  \n  mutation UpdateCycle($input: UpdateCycleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCycle(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n": typeof types.UpdateCycleDocument,
    "\n  \n  mutation StartCycleToday($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    startCycleToday(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n": typeof types.StartCycleTodayDocument,
    "\n  fragment DashboardFields on Dashboard {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    filter\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": typeof types.DashboardFieldsFragmentDoc,
    "\n  fragment DashboardTileFields on DashboardTile {\n    id\n    workspaceId\n    dashboardId\n    title\n    measure\n    slice\n    display\n    filter\n    sortOrder\n    createdAt\n    updatedAt\n  }\n": typeof types.DashboardTileFieldsFragmentDoc,
    "\n  \n  mutation CreateDashboard($input: CreateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n": typeof types.CreateDashboardDocument,
    "\n  \n  mutation UpdateDashboard($input: UpdateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n": typeof types.UpdateDashboardDocument,
    "\n  mutation DeleteDashboard($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboard(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteDashboardDocument,
    "\n  \n  mutation CreateDashboardTile($input: CreateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n": typeof types.CreateDashboardTileDocument,
    "\n  \n  mutation UpdateDashboardTile($input: UpdateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n": typeof types.UpdateDashboardTileDocument,
    "\n  mutation DeleteDashboardTile($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboardTile(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteDashboardTileDocument,
    "\n  fragment DocumentFields on Document {\n    id\n    workspaceId\n    teamId\n    projectId\n    title\n    body\n    sortOrder\n    creatorId\n    updatedBy\n    createdAt\n    updatedAt\n    archivedAt\n    deletedAt\n  }\n": typeof types.DocumentFieldsFragmentDoc,
    "\n  \n  mutation CreateDocument($input: CreateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    createDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n": typeof types.CreateDocumentDocument,
    "\n  \n  mutation UpdateDocument($input: UpdateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n": typeof types.UpdateDocumentDocument,
    "\n  mutation ArchiveDocument($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveDocument(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveDocumentDocument,
    "\n  mutation DeleteDocument($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDocument(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteDocumentDocument,
    "\n  fragment DraftFields on Draft {\n    id\n    workspaceId\n    userId\n    kind\n    payload\n    createdAt\n    updatedAt\n  }\n": typeof types.DraftFieldsFragmentDoc,
    "\n  \n  query Drafts {\n    drafts {\n      ...DraftFields\n    }\n  }\n": typeof types.DraftsDocument,
    "\n  \n  mutation CreateDraft($input: CreateDraftInput!) {\n    createDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n": typeof types.CreateDraftDocument,
    "\n  \n  mutation UpdateDraft($input: UpdateDraftInput!) {\n    updateDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n": typeof types.UpdateDraftDocument,
    "\n  mutation DeleteDraft($id: UUID!) {\n    deleteDraft(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteDraftDocument,
    "\n  fragment FormTemplateFields on FormTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.FormTemplateFieldsFragmentDoc,
    "\n  fragment FormTemplateFieldFields on FormTemplateField {\n    id\n    workspaceId\n    formTemplateId\n    fieldType\n    label\n    description\n    required\n    sortOrder\n    config\n    createdAt\n    updatedAt\n  }\n": typeof types.FormTemplateFieldFieldsFragmentDoc,
    "\n  \n  mutation CreateFormTemplate($input: CreateFormTemplateInput!) {\n    createFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n": typeof types.CreateFormTemplateDocument,
    "\n  \n  mutation UpdateFormTemplate($input: UpdateFormTemplateInput!) {\n    updateFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n": typeof types.UpdateFormTemplateDocument,
    "\n  mutation ArchiveFormTemplate($id: UUID!, $archived: Boolean!) {\n    archiveFormTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveFormTemplateDocument,
    "\n  \n  mutation CreateFormTemplateField($input: CreateFormTemplateFieldInput!) {\n    createFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n": typeof types.CreateFormTemplateFieldDocument,
    "\n  \n  mutation UpdateFormTemplateField($input: UpdateFormTemplateFieldInput!) {\n    updateFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n": typeof types.UpdateFormTemplateFieldDocument,
    "\n  mutation DeleteFormTemplateField($id: UUID!) {\n    deleteFormTemplateField(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteFormTemplateFieldDocument,
    "\n  fragment GitHubConnectionFields on GitHubConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    orgLogin\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.GitHubConnectionFieldsFragmentDoc,
    "\n  fragment GitHubUserLinkFields on GitHubUserLink {\n    id\n    workspaceId\n    userId\n    githubLogin\n    createdAt\n    updatedAt\n  }\n": typeof types.GitHubUserLinkFieldsFragmentDoc,
    "\n  query GitHubSettings {\n    githubOAuthConfigured\n    githubCommitWebhook {\n      url\n      secret\n    }\n  }\n": typeof types.GitHubSettingsDocument,
    "\n  \n  mutation CreateGitHubConnection($input: CreateGitHubConnectionInput!) {\n    createGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n": typeof types.CreateGitHubConnectionDocument,
    "\n  \n  mutation UpdateGitHubConnection($input: UpdateGitHubConnectionInput!) {\n    updateGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n": typeof types.UpdateGitHubConnectionDocument,
    "\n  mutation DeleteGitHubConnection {\n    deleteGitHubConnection {\n      version\n      id\n    }\n  }\n": typeof types.DeleteGitHubConnectionDocument,
    "\n  \n  mutation CreateGitHubUserLink($input: CreateGitHubUserLinkInput!) {\n    createGitHubUserLink(input: $input) {\n      version\n      githubUserLink {\n        ...GitHubUserLinkFields\n      }\n    }\n  }\n": typeof types.CreateGitHubUserLinkDocument,
    "\n  mutation DeleteGitHubUserLink {\n    deleteGitHubUserLink {\n      version\n      id\n    }\n  }\n": typeof types.DeleteGitHubUserLinkDocument,
    "\n  fragment GitHubTeamAutomationFields on GitHubTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n": typeof types.GitHubTeamAutomationFieldsFragmentDoc,
    "\n  \n  query GitHubTeamAutomation($teamId: UUID!) {\n    githubTeamAutomation(teamId: $teamId) {\n      ...GitHubTeamAutomationFields\n    }\n  }\n": typeof types.GitHubTeamAutomationDocument,
    "\n  \n  mutation UpdateGitHubTeamAutomation($input: UpdateGitHubTeamAutomationInput!) {\n    updateGitHubTeamAutomation(input: $input) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n": typeof types.UpdateGitHubTeamAutomationDocument,
    "\n  \n  mutation DeleteGitHubTeamAutomation($teamId: UUID!) {\n    deleteGitHubTeamAutomation(teamId: $teamId) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n": typeof types.DeleteGitHubTeamAutomationDocument,
    "\n  fragment GitLabConnectionFields on GitLabConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    instanceUrl\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.GitLabConnectionFieldsFragmentDoc,
    "\n  fragment GitLabUserLinkFields on GitLabUserLink {\n    id\n    workspaceId\n    userId\n    gitlabUsername\n    createdAt\n    updatedAt\n  }\n": typeof types.GitLabUserLinkFieldsFragmentDoc,
    "\n  query GitLabSettings {\n    gitlabWebhook {\n      url\n      secret\n    }\n  }\n": typeof types.GitLabSettingsDocument,
    "\n  \n  mutation CreateGitLabConnection($input: CreateGitLabConnectionInput!) {\n    createGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n": typeof types.CreateGitLabConnectionDocument,
    "\n  \n  mutation UpdateGitLabConnection($input: UpdateGitLabConnectionInput!) {\n    updateGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n": typeof types.UpdateGitLabConnectionDocument,
    "\n  mutation DeleteGitLabConnection {\n    deleteGitLabConnection {\n      version\n      id\n    }\n  }\n": typeof types.DeleteGitLabConnectionDocument,
    "\n  \n  mutation CreateGitLabUserLink($input: CreateGitLabUserLinkInput!) {\n    createGitLabUserLink(input: $input) {\n      version\n      gitlabUserLink {\n        ...GitLabUserLinkFields\n      }\n    }\n  }\n": typeof types.CreateGitLabUserLinkDocument,
    "\n  mutation DeleteGitLabUserLink {\n    deleteGitLabUserLink {\n      version\n      id\n    }\n  }\n": typeof types.DeleteGitLabUserLinkDocument,
    "\n  fragment GitLabTeamAutomationFields on GitLabTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n": typeof types.GitLabTeamAutomationFieldsFragmentDoc,
    "\n  \n  query GitLabTeamAutomation($teamId: UUID!) {\n    gitlabTeamAutomation(teamId: $teamId) {\n      ...GitLabTeamAutomationFields\n    }\n  }\n": typeof types.GitLabTeamAutomationDocument,
    "\n  \n  mutation UpdateGitLabTeamAutomation($input: UpdateGitLabTeamAutomationInput!) {\n    updateGitLabTeamAutomation(input: $input) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n": typeof types.UpdateGitLabTeamAutomationDocument,
    "\n  \n  mutation DeleteGitLabTeamAutomation($teamId: UUID!) {\n    deleteGitLabTeamAutomation(teamId: $teamId) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n": typeof types.DeleteGitLabTeamAutomationDocument,
    "\n  fragment NotificationFields on Notification {\n    id\n    workspaceId\n    userId\n    type\n    issueId\n    commentId\n    actor {\n      type\n      id\n    }\n    changeVersion\n    groupKey\n    count\n    payload\n    readAt\n    snoozedUntil\n    createdAt\n    updatedAt\n  }\n": typeof types.NotificationFieldsFragmentDoc,
    "\n  \n  query Inbox($first: Int!) {\n    notifications(includeRead: true, includeSnoozed: true, first: $first) {\n      ...NotificationFields\n    }\n  }\n": typeof types.InboxDocument,
    "\n  query UnreadNotificationCount {\n    unreadNotificationCount\n  }\n": typeof types.UnreadNotificationCountDocument,
    "\n  \n  mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {\n    markNotificationRead(id: $id, read: $read) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": typeof types.MarkNotificationReadDocument,
    "\n  \n  mutation MarkAllNotificationsRead {\n    markAllNotificationsRead {\n      version\n      notifications {\n        ...NotificationFields\n      }\n    }\n  }\n": typeof types.MarkAllNotificationsReadDocument,
    "\n  \n  mutation SnoozeNotification($id: UUID!, $until: Time) {\n    snoozeNotification(id: $id, until: $until) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": typeof types.SnoozeNotificationDocument,
    "\n  mutation DeleteNotification($id: UUID!) {\n    deleteNotification(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteNotificationDocument,
    "\n  \n  mutation UpdateNotificationPrefs($prefs: JSON!) {\n    updateNotificationPrefs(prefs: $prefs) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": typeof types.UpdateNotificationPrefsDocument,
    "\n  fragment InitiativeLabelFields on InitiativeLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.InitiativeLabelFieldsFragmentDoc,
    "\n  fragment InitiativeLabelLinkFields on InitiativeLabelLink {\n    id\n    workspaceId\n    initiativeId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n": typeof types.InitiativeLabelLinkFieldsFragmentDoc,
    "\n  \n  mutation CreateInitiativeLabel($input: CreateInitiativeLabelInput!) {\n    createInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n": typeof types.CreateInitiativeLabelDocument,
    "\n  \n  mutation UpdateInitiativeLabel($input: UpdateInitiativeLabelInput!) {\n    updateInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n": typeof types.UpdateInitiativeLabelDocument,
    "\n  mutation ArchiveInitiativeLabel($id: UUID!, $archived: Boolean!) {\n    archiveInitiativeLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveInitiativeLabelDocument,
    "\n  \n  mutation AddInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    addInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      initiativeLabelLink {\n        ...InitiativeLabelLinkFields\n      }\n    }\n  }\n": typeof types.AddInitiativeLabelDocument,
    "\n  mutation RemoveInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    removeInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveInitiativeLabelDocument,
    "\n  fragment InitiativeUpdateFields on InitiativeUpdate {\n    id\n    workspaceId\n    initiativeId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.InitiativeUpdateFieldsFragmentDoc,
    "\n  \n  mutation CreateInitiativeUpdate(\n    $input: CreateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n": typeof types.CreateInitiativeUpdateDocument,
    "\n  \n  mutation UpdateInitiativeUpdate(\n    $input: UpdateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n": typeof types.UpdateInitiativeUpdateDocument,
    "\n  mutation DeleteInitiativeUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteInitiativeUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteInitiativeUpdateDocument,
    "\n  fragment InitiativeFields on Initiative {\n    id\n    workspaceId\n    name\n    description\n    status\n    priority\n    ownerId\n    leadTeamId\n    sortOrder\n    targetDate\n    targetDateGranularity\n    creatorId\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": typeof types.InitiativeFieldsFragmentDoc,
    "\n  fragment InitiativeProjectFields on InitiativeProject {\n    id\n    workspaceId\n    initiativeId\n    projectId\n    createdAt\n  }\n": typeof types.InitiativeProjectFieldsFragmentDoc,
    "\n  \n  mutation CreateInitiative($input: CreateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    createInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n": typeof types.CreateInitiativeDocument,
    "\n  \n  mutation UpdateInitiative($input: UpdateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    updateInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n": typeof types.UpdateInitiativeDocument,
    "\n  \n  mutation AddInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeProject {\n        ...InitiativeProjectFields\n      }\n    }\n  }\n": typeof types.AddInitiativeProjectDocument,
    "\n  mutation RemoveInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveInitiativeProjectDocument,
    "\n  mutation ArchiveInitiative($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveInitiative(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveInitiativeDocument,
    "\n  fragment InitiativeRelationFields on InitiativeRelation {\n    id\n    workspaceId\n    parentInitiativeId\n    childInitiativeId\n    sortOrder\n    createdBy\n    createdAt\n  }\n": typeof types.InitiativeRelationFieldsFragmentDoc,
    "\n  \n  mutation AddInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeRelation {\n        ...InitiativeRelationFields\n      }\n    }\n  }\n": typeof types.AddInitiativeRelationDocument,
    "\n  mutation RemoveInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveInitiativeRelationDocument,
    "\n  query IntegrationSubmissions {\n    integrationSubmissions {\n      id\n      workspaceId\n      submittedBy\n      name\n      website\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.IntegrationSubmissionsDocument,
    "\n  mutation SubmitIntegration($input: SubmitIntegrationInput!) {\n    submitIntegration(input: $input) {\n      submission {\n        id\n        workspaceId\n        submittedBy\n        name\n        website\n        summary\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": typeof types.SubmitIntegrationDocument,
    "\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.SubIssueFieldsFragmentDoc,
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
    "\n  \n  mutation MergeLabels($sourceId: UUID!, $intoId: UUID!) {\n    mergeLabels(sourceId: $sourceId, intoId: $intoId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n": typeof types.MergeLabelsDocument,
    "\n  \n  mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      issueLabel {\n        ...IssueLabelFields\n      }\n    }\n  }\n": typeof types.AddIssueLabelDocument,
    "\n  mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveIssueLabelDocument,
    "\n  fragment OauthClientFields on OauthClient {\n    id\n    workspaceId\n    creatorId\n    clientId\n    name\n    description\n    developer\n    developerUrl\n    imageUrl\n    redirectUris\n    allowedScopes\n    publicEnabled\n    clientCredentialsEnabled\n    webhookUrl\n    createdAt\n    updatedAt\n  }\n": typeof types.OauthClientFieldsFragmentDoc,
    "\n  \n  query OauthClients {\n    oauthClients {\n      ...OauthClientFields\n    }\n  }\n": typeof types.OauthClientsDocument,
    "\n  query OauthClientInfo($clientId: String!) {\n    oauthClientInfo(clientId: $clientId) {\n      clientId\n      name\n      description\n      developer\n      developerUrl\n      imageUrl\n      allowedScopes\n    }\n  }\n": typeof types.OauthClientInfoDocument,
    "\n  \n  mutation CreateOauthClient($input: CreateOauthClientInput!) {\n    createOauthClient(input: $input) {\n      version\n      created {\n        clientSecret\n        oauthClient {\n          ...OauthClientFields\n        }\n      }\n    }\n  }\n": typeof types.CreateOauthClientDocument,
    "\n  \n  mutation UpdateOauthClient($input: UpdateOauthClientInput!) {\n    updateOauthClient(input: $input) {\n      version\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n": typeof types.UpdateOauthClientDocument,
    "\n  \n  mutation RotateOauthClientSecret($id: UUID!) {\n    rotateOauthClientSecret(id: $id) {\n      version\n      clientSecret\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n": typeof types.RotateOauthClientSecretDocument,
    "\n  mutation DeleteOauthClient($id: UUID!) {\n    deleteOauthClient(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteOauthClientDocument,
    "\n  mutation CreateOauthAuthorization($input: CreateOauthAuthorizationInput!) {\n    createOauthAuthorization(input: $input) {\n      redirectUri\n    }\n  }\n": typeof types.CreateOauthAuthorizationDocument,
    "\n  fragment ProjectLabelFields on ProjectLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ProjectLabelFieldsFragmentDoc,
    "\n  fragment ProjectLabelLinkFields on ProjectLabelLink {\n    id\n    workspaceId\n    projectId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n": typeof types.ProjectLabelLinkFieldsFragmentDoc,
    "\n  \n  mutation CreateProjectLabel($input: CreateProjectLabelInput!) {\n    createProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n": typeof types.CreateProjectLabelDocument,
    "\n  \n  mutation UpdateProjectLabel($input: UpdateProjectLabelInput!) {\n    updateProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n": typeof types.UpdateProjectLabelDocument,
    "\n  mutation ArchiveProjectLabel($id: UUID!, $archived: Boolean!) {\n    archiveProjectLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveProjectLabelDocument,
    "\n  \n  mutation AddProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    addProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      projectLabelLink {\n        ...ProjectLabelLinkFields\n      }\n    }\n  }\n": typeof types.AddProjectLabelDocument,
    "\n  mutation RemoveProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    removeProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveProjectLabelDocument,
    "\n  fragment ProjectTemplateFields on ProjectTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    summary\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ProjectTemplateFieldsFragmentDoc,
    "\n  fragment ProjectTemplateMilestoneFields on ProjectTemplateMilestone {\n    id\n    workspaceId\n    projectTemplateId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n  }\n": typeof types.ProjectTemplateMilestoneFieldsFragmentDoc,
    "\n  fragment ProjectTemplateIssueFields on ProjectTemplateIssue {\n    id\n    workspaceId\n    projectTemplateId\n    parentId\n    title\n    description\n    properties\n    sortOrder\n    createdAt\n    updatedAt\n  }\n": typeof types.ProjectTemplateIssueFieldsFragmentDoc,
    "\n  \n  mutation CreateProjectTemplate($input: CreateProjectTemplateInput!) {\n    createProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n": typeof types.CreateProjectTemplateDocument,
    "\n  \n  mutation UpdateProjectTemplate($input: UpdateProjectTemplateInput!) {\n    updateProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n": typeof types.UpdateProjectTemplateDocument,
    "\n  mutation ArchiveProjectTemplate($id: UUID!, $archived: Boolean!) {\n    archiveProjectTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveProjectTemplateDocument,
    "\n  \n  mutation CreateProjectTemplateMilestone($input: CreateProjectTemplateMilestoneInput!) {\n    createProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n": typeof types.CreateProjectTemplateMilestoneDocument,
    "\n  \n  mutation UpdateProjectTemplateMilestone($input: UpdateProjectTemplateMilestoneInput!) {\n    updateProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n": typeof types.UpdateProjectTemplateMilestoneDocument,
    "\n  mutation DeleteProjectTemplateMilestone($id: UUID!) {\n    deleteProjectTemplateMilestone(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteProjectTemplateMilestoneDocument,
    "\n  \n  mutation CreateProjectTemplateIssue($input: CreateProjectTemplateIssueInput!) {\n    createProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n": typeof types.CreateProjectTemplateIssueDocument,
    "\n  \n  mutation UpdateProjectTemplateIssue($input: UpdateProjectTemplateIssueInput!) {\n    updateProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n": typeof types.UpdateProjectTemplateIssueDocument,
    "\n  mutation DeleteProjectTemplateIssue($id: UUID!) {\n    deleteProjectTemplateIssue(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteProjectTemplateIssueDocument,
    "\n  fragment ProjectUpdateFields on ProjectUpdate {\n    id\n    workspaceId\n    projectId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.ProjectUpdateFieldsFragmentDoc,
    "\n  \n  mutation CreateProjectUpdate($input: CreateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    createProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n": typeof types.CreateProjectUpdateDocument,
    "\n  \n  mutation UpdateProjectUpdate($input: UpdateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    updateProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n": typeof types.UpdateProjectUpdateDocument,
    "\n  mutation DeleteProjectUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteProjectUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteProjectUpdateDocument,
    "\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ProjectStatusFieldsFragmentDoc,
    "\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    updateSchedule\n    updateReminderIntervalDays\n    updateReminderWeekday\n    updateReminderHour\n    archivedAt\n    deletedAt\n    deletedBy\n    projectTemplateId\n    createdAt\n    updatedAt\n  }\n": typeof types.ProjectFieldsFragmentDoc,
    "\n  fragment ProjectTeamFields on ProjectTeam {\n    id\n    workspaceId\n    projectId\n    teamId\n    createdAt\n  }\n": typeof types.ProjectTeamFieldsFragmentDoc,
    "\n  fragment ProjectMemberFields on ProjectMember {\n    id\n    workspaceId\n    projectId\n    userId\n    createdAt\n  }\n": typeof types.ProjectMemberFieldsFragmentDoc,
    "\n  fragment ProjectMilestoneFields on ProjectMilestone {\n    id\n    workspaceId\n    projectId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ProjectMilestoneFieldsFragmentDoc,
    "\n  \n  mutation CreateProject($input: CreateProjectInput!, $clientId: UUID, $opId: UUID) {\n    createProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": typeof types.CreateProjectDocument,
    "\n  \n  mutation UpdateProject($input: UpdateProjectInput!, $clientId: UUID, $opId: UUID) {\n    updateProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": typeof types.UpdateProjectDocument,
    "\n  mutation DeleteProject($id: UUID!, $clientId: UUID, $opId: UUID) {\n    deleteProject(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteProjectDocument,
    "\n  \n  mutation AddProjectTeam($projectId: UUID!, $teamId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectTeam(projectId: $projectId, teamId: $teamId, clientId: $clientId, opId: $opId) {\n      version\n      projectTeam {\n        ...ProjectTeamFields\n      }\n    }\n  }\n": typeof types.AddProjectTeamDocument,
    "\n  \n  mutation AddProjectMember($projectId: UUID!, $userId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectMember(projectId: $projectId, userId: $userId, clientId: $clientId, opId: $opId) {\n      version\n      projectMember {\n        ...ProjectMemberFields\n      }\n    }\n  }\n": typeof types.AddProjectMemberDocument,
    "\n  fragment ProjectDependencyFields on ProjectDependency {\n    id\n    workspaceId\n    blockingProjectId\n    blockedProjectId\n    createdAt\n  }\n": typeof types.ProjectDependencyFieldsFragmentDoc,
    "\n  \n  mutation AddProjectDependency(\n    $blockingProjectId: UUID!\n    $blockedProjectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addProjectDependency(\n      blockingProjectId: $blockingProjectId\n      blockedProjectId: $blockedProjectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      projectDependency {\n        ...ProjectDependencyFields\n      }\n    }\n  }\n": typeof types.AddProjectDependencyDocument,
    "\n  mutation RemoveProjectDependency($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    removeProjectDependency(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveProjectDependencyDocument,
    "\n  \n  mutation CreateProjectStatus($input: CreateProjectStatusInput!) {\n    createProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n": typeof types.CreateProjectStatusDocument,
    "\n  \n  mutation UpdateProjectStatus($input: UpdateProjectStatusInput!) {\n    updateProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n": typeof types.UpdateProjectStatusDocument,
    "\n  mutation ArchiveProjectStatus($id: UUID!, $archived: Boolean!) {\n    archiveProjectStatus(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveProjectStatusDocument,
    "\n  fragment PulseFeedFields on PulseFeed {\n    id\n    workspaceId\n    userId\n    name\n    projectIds\n    createdAt\n    updatedAt\n  }\n": typeof types.PulseFeedFieldsFragmentDoc,
    "\n  \n  mutation CreatePulseFeed($input: CreatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    createPulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n": typeof types.CreatePulseFeedDocument,
    "\n  \n  mutation UpdatePulseFeed($input: UpdatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    updatePulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n": typeof types.UpdatePulseFeedDocument,
    "\n  mutation DeletePulseFeed($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deletePulseFeed(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeletePulseFeedDocument,
    "\n  fragment RecurringIssueFields on RecurringIssue {\n    id\n    workspaceId\n    teamId\n    title\n    body\n    properties\n    templateId\n    cadence\n    nextDueDate\n    lastCreatedAt\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.RecurringIssueFieldsFragmentDoc,
    "\n  \n  mutation CreateRecurringIssue($input: CreateRecurringIssueInput!) {\n    createRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n": typeof types.CreateRecurringIssueDocument,
    "\n  \n  mutation UpdateRecurringIssue($input: UpdateRecurringIssueInput!) {\n    updateRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n": typeof types.UpdateRecurringIssueDocument,
    "\n  mutation ArchiveRecurringIssue($id: UUID!, $archived: Boolean!) {\n    archiveRecurringIssue(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveRecurringIssueDocument,
    "\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n": typeof types.SearchDocument,
    "\n  fragment SentryConnectionFields on SentryConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    organizationSlug\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.SentryConnectionFieldsFragmentDoc,
    "\n  query SentrySettings {\n    sentryWebhook {\n      url\n      secret\n    }\n  }\n": typeof types.SentrySettingsDocument,
    "\n  \n  mutation CreateSentryConnection($input: CreateSentryConnectionInput!) {\n    createSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n": typeof types.CreateSentryConnectionDocument,
    "\n  \n  mutation UpdateSentryConnection($input: UpdateSentryConnectionInput!) {\n    updateSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n": typeof types.UpdateSentryConnectionDocument,
    "\n  mutation DeleteSentryConnection {\n    deleteSentryConnection {\n      version\n      id\n    }\n  }\n": typeof types.DeleteSentryConnectionDocument,
    "\n  fragment SlackConnectionFields on SlackConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    channelName\n    notifyIssues\n    notifyComments\n    asksEnabled\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.SlackConnectionFieldsFragmentDoc,
    "\n  query SlackInbound {\n    slackInbound {\n      commandUrl\n      eventsUrl\n      webhookConfigured\n      signingSecretConfigured\n      botTokenConfigured\n    }\n  }\n": typeof types.SlackInboundDocument,
    "\n  \n  mutation CreateSlackConnection($input: CreateSlackConnectionInput!) {\n    createSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n": typeof types.CreateSlackConnectionDocument,
    "\n  \n  mutation UpdateSlackConnection($input: UpdateSlackConnectionInput!) {\n    updateSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n": typeof types.UpdateSlackConnectionDocument,
    "\n  mutation DeleteSlackConnection {\n    deleteSlackConnection {\n      version\n      id\n    }\n  }\n": typeof types.DeleteSlackConnectionDocument,
    "\n  fragment SlaRuleFields on SlaRule {\n    id\n    workspaceId\n    position\n    filter\n    action\n    durationMinutes\n    createdAt\n    updatedAt\n  }\n": typeof types.SlaRuleFieldsFragmentDoc,
    "\n  \n  mutation CreateSlaRule($input: CreateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    createSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n": typeof types.CreateSlaRuleDocument,
    "\n  \n  mutation UpdateSlaRule($input: UpdateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n": typeof types.UpdateSlaRuleDocument,
    "\n  mutation DeleteSlaRule($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteSlaRule(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteSlaRuleDocument,
    "\n  \n  mutation SetIssueSla($input: SetIssueSlaInput!, $clientId: UUID!, $opId: UUID!) {\n    setIssueSla(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.SetIssueSlaDocument,
    "\n  \n  mutation ClearIssueSla($issueId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    clearIssueSla(issueId: $issueId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": typeof types.ClearIssueSlaDocument,
    "\n  \n  query DeletedTeams {\n    deletedTeams {\n      ...TeamFields\n      deletedAt\n    }\n  }\n": typeof types.DeletedTeamsDocument,
    "\n  \n  mutation RetireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    retireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.RetireTeamDocument,
    "\n  \n  mutation UnretireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    unretireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UnretireTeamDocument,
    "\n  mutation DeleteTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteTeamDocument,
    "\n  \n  mutation RestoreTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.RestoreTeamDocument,
    "\n  \n  mutation MoveTeam($teamId: UUID!, $parentTeamId: UUID, $clientId: UUID!, $opId: UUID!) {\n    moveTeam(teamId: $teamId, parentTeamId: $parentTeamId, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.MoveTeamDocument,
    "\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    subIssues {\n      title\n    }\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n    emailIntakeEnabled\n    emailIntakeAddress\n  }\n": typeof types.IssueTemplateFieldsFragmentDoc,
    "\n  \n  mutation CreateIssueTemplate($input: CreateIssueTemplateInput!) {\n    createIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": typeof types.CreateIssueTemplateDocument,
    "\n  \n  mutation UpdateIssueTemplate($input: UpdateIssueTemplateInput!) {\n    updateIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": typeof types.UpdateIssueTemplateDocument,
    "\n  mutation ArchiveIssueTemplate($id: UUID!, $archived: Boolean!) {\n    archiveIssueTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": typeof types.ArchiveIssueTemplateDocument,
    "\n  \n  mutation UpdateIssueTemplateEmailIntake($input: UpdateIssueTemplateEmailIntakeInput!) {\n    updateIssueTemplateEmailIntake(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": typeof types.UpdateIssueTemplateEmailIntakeDocument,
    "\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    projectId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.ViewFieldsFragmentDoc,
    "\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n": typeof types.ViewPreferenceFieldsFragmentDoc,
    "\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    folderId\n    name\n    position\n    createdAt\n    updatedAt\n  }\n": typeof types.FavoriteFieldsFragmentDoc,
    "\n  \n  mutation CreateView($input: CreateViewInput!) {\n    createView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": typeof types.CreateViewDocument,
    "\n  \n  mutation UpdateView($input: UpdateViewInput!) {\n    updateView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": typeof types.UpdateViewDocument,
    "\n  mutation DeleteView($id: UUID!) {\n    deleteView(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteViewDocument,
    "\n  \n  mutation SetViewPreference($viewKey: String!, $display: JSON!) {\n    setViewPreference(viewKey: $viewKey, display: $display) {\n      version\n      preference {\n        ...ViewPreferenceFields\n      }\n    }\n  }\n": typeof types.SetViewPreferenceDocument,
    "\n  \n  mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!, $afterFavoriteId: UUID) {\n    addFavorite(kind: $kind, targetId: $targetId, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": typeof types.AddFavoriteDocument,
    "\n  mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {\n    removeFavorite(kind: $kind, targetId: $targetId) {\n      version\n      id\n    }\n  }\n": typeof types.RemoveFavoriteDocument,
    "\n  \n  mutation CreateFavoriteFolder($name: String!, $afterFavoriteId: UUID) {\n    createFavoriteFolder(name: $name, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": typeof types.CreateFavoriteFolderDocument,
    "\n  \n  mutation UpdateFavoriteFolder($id: UUID!, $name: String!) {\n    updateFavoriteFolder(id: $id, name: $name) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": typeof types.UpdateFavoriteFolderDocument,
    "\n  \n  mutation MoveFavorite($input: MoveFavoriteInput!) {\n    moveFavorite(input: $input) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": typeof types.MoveFavoriteDocument,
    "\n  fragment ViewSubscriptionFields on ViewSubscription {\n    id\n    workspaceId\n    viewId\n    userId\n    added\n    completed\n    createdAt\n    updatedAt\n  }\n": typeof types.ViewSubscriptionFieldsFragmentDoc,
    "\n  \n  mutation SetViewSubscription($input: SetViewSubscriptionInput!) {\n    setViewSubscription(input: $input) {\n      version\n      viewSubscription {\n        ...ViewSubscriptionFields\n      }\n    }\n  }\n": typeof types.SetViewSubscriptionDocument,
    "\n  mutation DeleteViewSubscription($viewId: UUID!) {\n    deleteViewSubscription(viewId: $viewId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteViewSubscriptionDocument,
    "\n  fragment WebhookSummary on Webhook {\n    id\n    url\n    enabled\n    allPublicTeams\n    teamId\n    resourceTypes\n    consecutiveFailures\n    disabledAt\n    createdAt\n  }\n": typeof types.WebhookSummaryFragmentDoc,
    "\n  \n  query Webhooks {\n    webhooks {\n      ...WebhookSummary\n    }\n  }\n": typeof types.WebhooksDocument,
    "\n  query WebhookDeliveries($webhookId: UUID!) {\n    webhookDeliveries(webhookId: $webhookId, first: 20) {\n      id\n      attempt\n      lastStatus\n      lastError\n      deliveredAt\n      createdAt\n      entityType\n    }\n  }\n": typeof types.WebhookDeliveriesDocument,
    "\n  \n  mutation CreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      version\n      created {\n        secret\n        webhook {\n          ...WebhookSummary\n        }\n      }\n    }\n  }\n": typeof types.CreateWebhookDocument,
    "\n  \n  mutation UpdateWebhook($input: UpdateWebhookInput!) {\n    updateWebhook(input: $input) {\n      version\n      webhook {\n        ...WebhookSummary\n      }\n    }\n  }\n": typeof types.UpdateWebhookDocument,
    "\n  mutation DeleteWebhook($id: UUID!) {\n    deleteWebhook(id: $id) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteWebhookDocument,
    "\n  fragment WorkspaceFields on Workspace {\n    id\n    name\n    urlKey\n    logoUrl\n    plan\n    planExpiresAt\n    planLapsedAt\n    seatLimit\n    projectUpdateReminderIntervalDays\n    projectUpdateReminderWeekday\n    projectUpdateReminderHour\n    pulseEnabled\n    pulseDigestCadence\n    customerRequestsEnabled\n    customerDefaultTeamId\n    customerRevenueUnit\n    customerTiers\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.WorkspaceFieldsFragmentDoc,
    "\n  \n  mutation UpdateWorkspace($input: UpdateWorkspaceInput!) {\n    updateWorkspace(input: $input) {\n      version\n      workspace {\n        ...WorkspaceFields\n      }\n    }\n  }\n": typeof types.UpdateWorkspaceDocument,
    "\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.IssueFieldsFragmentDoc,
    "\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    defaultTemplateForMembersId\n    defaultTemplateForNonMembersId\n    emailIntakeEnabled\n    emailIntakeAddress\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n": typeof types.TeamFieldsFragmentDoc,
    "\n  fragment StateFields on WorkflowState {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    isSystem\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.StateFieldsFragmentDoc,
    "\n  fragment UserFields on User {\n    id\n    workspaceId\n    name\n    displayName\n    avatarUrl\n    timezone\n    role\n    status\n    kind\n    email\n    notificationPrefs\n    lastSeenAt\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": typeof types.UserFieldsFragmentDoc,
    "\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    anchorStart\n    anchorEnd\n    quote\n    createdAt\n    updatedAt\n  }\n": typeof types.CommentFieldsFragmentDoc,
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
    "\n  \n  mutation ResolveComment($id: UUID!, $resolved: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    resolveComment(id: $id, resolved: $resolved, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n": typeof types.ResolveCommentDocument,
    "\n  \n  mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    createAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": typeof types.CreateAttachmentDocument,
    "\n  \n  mutation UpdateAttachment($input: UpdateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": typeof types.UpdateAttachmentDocument,
    "\n  mutation DeleteAttachment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAttachment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": typeof types.DeleteAttachmentDocument,
    "\n  \n  \n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n        states {\n          ...StateFields\n        }\n      }\n    }\n  }\n": typeof types.CreateTeamDocument,
    "\n  \n  mutation UpdateTeam($input: UpdateTeamInput!) {\n    updateTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamDocument,
    "\n  fragment CycleFields on Cycle {\n    id\n    workspaceId\n    teamId\n    number\n    name\n    description\n    startsAt\n    endsAt\n    completedAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": typeof types.CycleFieldsFragmentDoc,
    "\n  \n  mutation UpdateTeamCycles($input: UpdateTeamCyclesInput!) {\n    updateTeamCycles(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamCyclesDocument,
    "\n  \n  mutation UpdateTeamTriage($input: UpdateTeamTriageInput!) {\n    updateTeamTriage(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamTriageDocument,
    "\n  \n  mutation UpdateTeamEmailIntake($input: UpdateTeamEmailIntakeInput!) {\n    updateTeamEmailIntake(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamEmailIntakeDocument,
    "\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamArchiveDocument,
    "\n  \n  mutation UpdateTeamTemplates($input: UpdateTeamTemplatesInput!) {\n    updateTeamTemplates(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": typeof types.UpdateTeamTemplatesDocument,
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
    "\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        subTeams\n        multiLevelSubTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        slas\n        slack\n        lapsed\n      }\n    }\n  }\n": types.EntitlementsDocument,
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
    "\n  fragment AskFormFields on AskForm {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    token\n    creatorId\n    archivedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n": types.AskFormFieldsFragmentDoc,
    "\n  \n  mutation CreateAskForm($input: CreateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    createAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n": types.CreateAskFormDocument,
    "\n  \n  mutation UpdateAskForm($input: UpdateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n": types.UpdateAskFormDocument,
    "\n  mutation ArchiveAskForm($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveAskForm(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.ArchiveAskFormDocument,
    "\n  mutation DeleteAskForm($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAskForm(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteAskFormDocument,
    "\n  fragment CustomerFields on Customer {\n    id\n    workspaceId\n    name\n    domains\n    revenue\n    size\n    tier\n    status\n    ownerId\n    logoUrl\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": types.CustomerFieldsFragmentDoc,
    "\n  fragment CustomerRequestFields on CustomerRequest {\n    id\n    workspaceId\n    customerId\n    issueId\n    projectId\n    body\n    important\n    creatorId\n    createdAt\n    updatedAt\n  }\n": types.CustomerRequestFieldsFragmentDoc,
    "\n  \n  mutation CreateCustomer($input: CreateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    createCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n": types.CreateCustomerDocument,
    "\n  \n  mutation UpdateCustomer($input: UpdateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n": types.UpdateCustomerDocument,
    "\n  \n  mutation CreateCustomerRequest(\n    $input: CreateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n": types.CreateCustomerRequestDocument,
    "\n  \n  mutation UpdateCustomerRequest(\n    $input: UpdateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n": types.UpdateCustomerRequestDocument,
    "\n  mutation DeleteCustomerRequest($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteCustomerRequest(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteCustomerRequestDocument,
    "\n  mutation ArchiveCustomer($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCustomer(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.ArchiveCustomerDocument,
    "\n  \n  mutation MergeCustomers($sourceId: UUID!, $intoId: UUID!) {\n    mergeCustomers(sourceId: $sourceId, intoId: $intoId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n": types.MergeCustomersDocument,
    "\n  mutation EnsureCycleCalendarFeed($teamId: UUID!) {\n    ensureCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": types.EnsureCycleCalendarFeedDocument,
    "\n  mutation RotateCycleCalendarFeed($teamId: UUID!) {\n    rotateCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": types.RotateCycleCalendarFeedDocument,
    "\n  \n  mutation UpdateCycle($input: UpdateCycleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCycle(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n": types.UpdateCycleDocument,
    "\n  \n  mutation StartCycleToday($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    startCycleToday(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n": types.StartCycleTodayDocument,
    "\n  fragment DashboardFields on Dashboard {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    filter\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": types.DashboardFieldsFragmentDoc,
    "\n  fragment DashboardTileFields on DashboardTile {\n    id\n    workspaceId\n    dashboardId\n    title\n    measure\n    slice\n    display\n    filter\n    sortOrder\n    createdAt\n    updatedAt\n  }\n": types.DashboardTileFieldsFragmentDoc,
    "\n  \n  mutation CreateDashboard($input: CreateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n": types.CreateDashboardDocument,
    "\n  \n  mutation UpdateDashboard($input: UpdateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n": types.UpdateDashboardDocument,
    "\n  mutation DeleteDashboard($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboard(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteDashboardDocument,
    "\n  \n  mutation CreateDashboardTile($input: CreateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n": types.CreateDashboardTileDocument,
    "\n  \n  mutation UpdateDashboardTile($input: UpdateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n": types.UpdateDashboardTileDocument,
    "\n  mutation DeleteDashboardTile($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboardTile(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteDashboardTileDocument,
    "\n  fragment DocumentFields on Document {\n    id\n    workspaceId\n    teamId\n    projectId\n    title\n    body\n    sortOrder\n    creatorId\n    updatedBy\n    createdAt\n    updatedAt\n    archivedAt\n    deletedAt\n  }\n": types.DocumentFieldsFragmentDoc,
    "\n  \n  mutation CreateDocument($input: CreateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    createDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n": types.CreateDocumentDocument,
    "\n  \n  mutation UpdateDocument($input: UpdateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n": types.UpdateDocumentDocument,
    "\n  mutation ArchiveDocument($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveDocument(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.ArchiveDocumentDocument,
    "\n  mutation DeleteDocument($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDocument(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteDocumentDocument,
    "\n  fragment DraftFields on Draft {\n    id\n    workspaceId\n    userId\n    kind\n    payload\n    createdAt\n    updatedAt\n  }\n": types.DraftFieldsFragmentDoc,
    "\n  \n  query Drafts {\n    drafts {\n      ...DraftFields\n    }\n  }\n": types.DraftsDocument,
    "\n  \n  mutation CreateDraft($input: CreateDraftInput!) {\n    createDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n": types.CreateDraftDocument,
    "\n  \n  mutation UpdateDraft($input: UpdateDraftInput!) {\n    updateDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n": types.UpdateDraftDocument,
    "\n  mutation DeleteDraft($id: UUID!) {\n    deleteDraft(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteDraftDocument,
    "\n  fragment FormTemplateFields on FormTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.FormTemplateFieldsFragmentDoc,
    "\n  fragment FormTemplateFieldFields on FormTemplateField {\n    id\n    workspaceId\n    formTemplateId\n    fieldType\n    label\n    description\n    required\n    sortOrder\n    config\n    createdAt\n    updatedAt\n  }\n": types.FormTemplateFieldFieldsFragmentDoc,
    "\n  \n  mutation CreateFormTemplate($input: CreateFormTemplateInput!) {\n    createFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n": types.CreateFormTemplateDocument,
    "\n  \n  mutation UpdateFormTemplate($input: UpdateFormTemplateInput!) {\n    updateFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n": types.UpdateFormTemplateDocument,
    "\n  mutation ArchiveFormTemplate($id: UUID!, $archived: Boolean!) {\n    archiveFormTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveFormTemplateDocument,
    "\n  \n  mutation CreateFormTemplateField($input: CreateFormTemplateFieldInput!) {\n    createFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n": types.CreateFormTemplateFieldDocument,
    "\n  \n  mutation UpdateFormTemplateField($input: UpdateFormTemplateFieldInput!) {\n    updateFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n": types.UpdateFormTemplateFieldDocument,
    "\n  mutation DeleteFormTemplateField($id: UUID!) {\n    deleteFormTemplateField(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteFormTemplateFieldDocument,
    "\n  fragment GitHubConnectionFields on GitHubConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    orgLogin\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": types.GitHubConnectionFieldsFragmentDoc,
    "\n  fragment GitHubUserLinkFields on GitHubUserLink {\n    id\n    workspaceId\n    userId\n    githubLogin\n    createdAt\n    updatedAt\n  }\n": types.GitHubUserLinkFieldsFragmentDoc,
    "\n  query GitHubSettings {\n    githubOAuthConfigured\n    githubCommitWebhook {\n      url\n      secret\n    }\n  }\n": types.GitHubSettingsDocument,
    "\n  \n  mutation CreateGitHubConnection($input: CreateGitHubConnectionInput!) {\n    createGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n": types.CreateGitHubConnectionDocument,
    "\n  \n  mutation UpdateGitHubConnection($input: UpdateGitHubConnectionInput!) {\n    updateGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n": types.UpdateGitHubConnectionDocument,
    "\n  mutation DeleteGitHubConnection {\n    deleteGitHubConnection {\n      version\n      id\n    }\n  }\n": types.DeleteGitHubConnectionDocument,
    "\n  \n  mutation CreateGitHubUserLink($input: CreateGitHubUserLinkInput!) {\n    createGitHubUserLink(input: $input) {\n      version\n      githubUserLink {\n        ...GitHubUserLinkFields\n      }\n    }\n  }\n": types.CreateGitHubUserLinkDocument,
    "\n  mutation DeleteGitHubUserLink {\n    deleteGitHubUserLink {\n      version\n      id\n    }\n  }\n": types.DeleteGitHubUserLinkDocument,
    "\n  fragment GitHubTeamAutomationFields on GitHubTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n": types.GitHubTeamAutomationFieldsFragmentDoc,
    "\n  \n  query GitHubTeamAutomation($teamId: UUID!) {\n    githubTeamAutomation(teamId: $teamId) {\n      ...GitHubTeamAutomationFields\n    }\n  }\n": types.GitHubTeamAutomationDocument,
    "\n  \n  mutation UpdateGitHubTeamAutomation($input: UpdateGitHubTeamAutomationInput!) {\n    updateGitHubTeamAutomation(input: $input) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n": types.UpdateGitHubTeamAutomationDocument,
    "\n  \n  mutation DeleteGitHubTeamAutomation($teamId: UUID!) {\n    deleteGitHubTeamAutomation(teamId: $teamId) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n": types.DeleteGitHubTeamAutomationDocument,
    "\n  fragment GitLabConnectionFields on GitLabConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    instanceUrl\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": types.GitLabConnectionFieldsFragmentDoc,
    "\n  fragment GitLabUserLinkFields on GitLabUserLink {\n    id\n    workspaceId\n    userId\n    gitlabUsername\n    createdAt\n    updatedAt\n  }\n": types.GitLabUserLinkFieldsFragmentDoc,
    "\n  query GitLabSettings {\n    gitlabWebhook {\n      url\n      secret\n    }\n  }\n": types.GitLabSettingsDocument,
    "\n  \n  mutation CreateGitLabConnection($input: CreateGitLabConnectionInput!) {\n    createGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n": types.CreateGitLabConnectionDocument,
    "\n  \n  mutation UpdateGitLabConnection($input: UpdateGitLabConnectionInput!) {\n    updateGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n": types.UpdateGitLabConnectionDocument,
    "\n  mutation DeleteGitLabConnection {\n    deleteGitLabConnection {\n      version\n      id\n    }\n  }\n": types.DeleteGitLabConnectionDocument,
    "\n  \n  mutation CreateGitLabUserLink($input: CreateGitLabUserLinkInput!) {\n    createGitLabUserLink(input: $input) {\n      version\n      gitlabUserLink {\n        ...GitLabUserLinkFields\n      }\n    }\n  }\n": types.CreateGitLabUserLinkDocument,
    "\n  mutation DeleteGitLabUserLink {\n    deleteGitLabUserLink {\n      version\n      id\n    }\n  }\n": types.DeleteGitLabUserLinkDocument,
    "\n  fragment GitLabTeamAutomationFields on GitLabTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n": types.GitLabTeamAutomationFieldsFragmentDoc,
    "\n  \n  query GitLabTeamAutomation($teamId: UUID!) {\n    gitlabTeamAutomation(teamId: $teamId) {\n      ...GitLabTeamAutomationFields\n    }\n  }\n": types.GitLabTeamAutomationDocument,
    "\n  \n  mutation UpdateGitLabTeamAutomation($input: UpdateGitLabTeamAutomationInput!) {\n    updateGitLabTeamAutomation(input: $input) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n": types.UpdateGitLabTeamAutomationDocument,
    "\n  \n  mutation DeleteGitLabTeamAutomation($teamId: UUID!) {\n    deleteGitLabTeamAutomation(teamId: $teamId) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n": types.DeleteGitLabTeamAutomationDocument,
    "\n  fragment NotificationFields on Notification {\n    id\n    workspaceId\n    userId\n    type\n    issueId\n    commentId\n    actor {\n      type\n      id\n    }\n    changeVersion\n    groupKey\n    count\n    payload\n    readAt\n    snoozedUntil\n    createdAt\n    updatedAt\n  }\n": types.NotificationFieldsFragmentDoc,
    "\n  \n  query Inbox($first: Int!) {\n    notifications(includeRead: true, includeSnoozed: true, first: $first) {\n      ...NotificationFields\n    }\n  }\n": types.InboxDocument,
    "\n  query UnreadNotificationCount {\n    unreadNotificationCount\n  }\n": types.UnreadNotificationCountDocument,
    "\n  \n  mutation MarkNotificationRead($id: UUID!, $read: Boolean!) {\n    markNotificationRead(id: $id, read: $read) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": types.MarkNotificationReadDocument,
    "\n  \n  mutation MarkAllNotificationsRead {\n    markAllNotificationsRead {\n      version\n      notifications {\n        ...NotificationFields\n      }\n    }\n  }\n": types.MarkAllNotificationsReadDocument,
    "\n  \n  mutation SnoozeNotification($id: UUID!, $until: Time) {\n    snoozeNotification(id: $id, until: $until) {\n      version\n      notification {\n        ...NotificationFields\n      }\n    }\n  }\n": types.SnoozeNotificationDocument,
    "\n  mutation DeleteNotification($id: UUID!) {\n    deleteNotification(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteNotificationDocument,
    "\n  \n  mutation UpdateNotificationPrefs($prefs: JSON!) {\n    updateNotificationPrefs(prefs: $prefs) {\n      version\n      user {\n        ...UserFields\n      }\n    }\n  }\n": types.UpdateNotificationPrefsDocument,
    "\n  fragment InitiativeLabelFields on InitiativeLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.InitiativeLabelFieldsFragmentDoc,
    "\n  fragment InitiativeLabelLinkFields on InitiativeLabelLink {\n    id\n    workspaceId\n    initiativeId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n": types.InitiativeLabelLinkFieldsFragmentDoc,
    "\n  \n  mutation CreateInitiativeLabel($input: CreateInitiativeLabelInput!) {\n    createInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n": types.CreateInitiativeLabelDocument,
    "\n  \n  mutation UpdateInitiativeLabel($input: UpdateInitiativeLabelInput!) {\n    updateInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n": types.UpdateInitiativeLabelDocument,
    "\n  mutation ArchiveInitiativeLabel($id: UUID!, $archived: Boolean!) {\n    archiveInitiativeLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveInitiativeLabelDocument,
    "\n  \n  mutation AddInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    addInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      initiativeLabelLink {\n        ...InitiativeLabelLinkFields\n      }\n    }\n  }\n": types.AddInitiativeLabelDocument,
    "\n  mutation RemoveInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    removeInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n": types.RemoveInitiativeLabelDocument,
    "\n  fragment InitiativeUpdateFields on InitiativeUpdate {\n    id\n    workspaceId\n    initiativeId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n": types.InitiativeUpdateFieldsFragmentDoc,
    "\n  \n  mutation CreateInitiativeUpdate(\n    $input: CreateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n": types.CreateInitiativeUpdateDocument,
    "\n  \n  mutation UpdateInitiativeUpdate(\n    $input: UpdateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n": types.UpdateInitiativeUpdateDocument,
    "\n  mutation DeleteInitiativeUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteInitiativeUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteInitiativeUpdateDocument,
    "\n  fragment InitiativeFields on Initiative {\n    id\n    workspaceId\n    name\n    description\n    status\n    priority\n    ownerId\n    leadTeamId\n    sortOrder\n    targetDate\n    targetDateGranularity\n    creatorId\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n": types.InitiativeFieldsFragmentDoc,
    "\n  fragment InitiativeProjectFields on InitiativeProject {\n    id\n    workspaceId\n    initiativeId\n    projectId\n    createdAt\n  }\n": types.InitiativeProjectFieldsFragmentDoc,
    "\n  \n  mutation CreateInitiative($input: CreateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    createInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n": types.CreateInitiativeDocument,
    "\n  \n  mutation UpdateInitiative($input: UpdateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    updateInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n": types.UpdateInitiativeDocument,
    "\n  \n  mutation AddInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeProject {\n        ...InitiativeProjectFields\n      }\n    }\n  }\n": types.AddInitiativeProjectDocument,
    "\n  mutation RemoveInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n": types.RemoveInitiativeProjectDocument,
    "\n  mutation ArchiveInitiative($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveInitiative(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.ArchiveInitiativeDocument,
    "\n  fragment InitiativeRelationFields on InitiativeRelation {\n    id\n    workspaceId\n    parentInitiativeId\n    childInitiativeId\n    sortOrder\n    createdBy\n    createdAt\n  }\n": types.InitiativeRelationFieldsFragmentDoc,
    "\n  \n  mutation AddInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeRelation {\n        ...InitiativeRelationFields\n      }\n    }\n  }\n": types.AddInitiativeRelationDocument,
    "\n  mutation RemoveInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n": types.RemoveInitiativeRelationDocument,
    "\n  query IntegrationSubmissions {\n    integrationSubmissions {\n      id\n      workspaceId\n      submittedBy\n      name\n      website\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n": types.IntegrationSubmissionsDocument,
    "\n  mutation SubmitIntegration($input: SubmitIntegrationInput!) {\n    submitIntegration(input: $input) {\n      submission {\n        id\n        workspaceId\n        submittedBy\n        name\n        website\n        summary\n        createdAt\n        updatedAt\n      }\n    }\n  }\n": types.SubmitIntegrationDocument,
    "\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": types.SubIssueFieldsFragmentDoc,
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
    "\n  \n  mutation MergeLabels($sourceId: UUID!, $intoId: UUID!) {\n    mergeLabels(sourceId: $sourceId, intoId: $intoId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n": types.MergeLabelsDocument,
    "\n  \n  mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      issueLabel {\n        ...IssueLabelFields\n      }\n    }\n  }\n": types.AddIssueLabelDocument,
    "\n  mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {\n    removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.RemoveIssueLabelDocument,
    "\n  fragment OauthClientFields on OauthClient {\n    id\n    workspaceId\n    creatorId\n    clientId\n    name\n    description\n    developer\n    developerUrl\n    imageUrl\n    redirectUris\n    allowedScopes\n    publicEnabled\n    clientCredentialsEnabled\n    webhookUrl\n    createdAt\n    updatedAt\n  }\n": types.OauthClientFieldsFragmentDoc,
    "\n  \n  query OauthClients {\n    oauthClients {\n      ...OauthClientFields\n    }\n  }\n": types.OauthClientsDocument,
    "\n  query OauthClientInfo($clientId: String!) {\n    oauthClientInfo(clientId: $clientId) {\n      clientId\n      name\n      description\n      developer\n      developerUrl\n      imageUrl\n      allowedScopes\n    }\n  }\n": types.OauthClientInfoDocument,
    "\n  \n  mutation CreateOauthClient($input: CreateOauthClientInput!) {\n    createOauthClient(input: $input) {\n      version\n      created {\n        clientSecret\n        oauthClient {\n          ...OauthClientFields\n        }\n      }\n    }\n  }\n": types.CreateOauthClientDocument,
    "\n  \n  mutation UpdateOauthClient($input: UpdateOauthClientInput!) {\n    updateOauthClient(input: $input) {\n      version\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n": types.UpdateOauthClientDocument,
    "\n  \n  mutation RotateOauthClientSecret($id: UUID!) {\n    rotateOauthClientSecret(id: $id) {\n      version\n      clientSecret\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n": types.RotateOauthClientSecretDocument,
    "\n  mutation DeleteOauthClient($id: UUID!) {\n    deleteOauthClient(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteOauthClientDocument,
    "\n  mutation CreateOauthAuthorization($input: CreateOauthAuthorizationInput!) {\n    createOauthAuthorization(input: $input) {\n      redirectUri\n    }\n  }\n": types.CreateOauthAuthorizationDocument,
    "\n  fragment ProjectLabelFields on ProjectLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ProjectLabelFieldsFragmentDoc,
    "\n  fragment ProjectLabelLinkFields on ProjectLabelLink {\n    id\n    workspaceId\n    projectId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n": types.ProjectLabelLinkFieldsFragmentDoc,
    "\n  \n  mutation CreateProjectLabel($input: CreateProjectLabelInput!) {\n    createProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n": types.CreateProjectLabelDocument,
    "\n  \n  mutation UpdateProjectLabel($input: UpdateProjectLabelInput!) {\n    updateProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n": types.UpdateProjectLabelDocument,
    "\n  mutation ArchiveProjectLabel($id: UUID!, $archived: Boolean!) {\n    archiveProjectLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveProjectLabelDocument,
    "\n  \n  mutation AddProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    addProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      projectLabelLink {\n        ...ProjectLabelLinkFields\n      }\n    }\n  }\n": types.AddProjectLabelDocument,
    "\n  mutation RemoveProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    removeProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n": types.RemoveProjectLabelDocument,
    "\n  fragment ProjectTemplateFields on ProjectTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    summary\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ProjectTemplateFieldsFragmentDoc,
    "\n  fragment ProjectTemplateMilestoneFields on ProjectTemplateMilestone {\n    id\n    workspaceId\n    projectTemplateId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n  }\n": types.ProjectTemplateMilestoneFieldsFragmentDoc,
    "\n  fragment ProjectTemplateIssueFields on ProjectTemplateIssue {\n    id\n    workspaceId\n    projectTemplateId\n    parentId\n    title\n    description\n    properties\n    sortOrder\n    createdAt\n    updatedAt\n  }\n": types.ProjectTemplateIssueFieldsFragmentDoc,
    "\n  \n  mutation CreateProjectTemplate($input: CreateProjectTemplateInput!) {\n    createProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n": types.CreateProjectTemplateDocument,
    "\n  \n  mutation UpdateProjectTemplate($input: UpdateProjectTemplateInput!) {\n    updateProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n": types.UpdateProjectTemplateDocument,
    "\n  mutation ArchiveProjectTemplate($id: UUID!, $archived: Boolean!) {\n    archiveProjectTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveProjectTemplateDocument,
    "\n  \n  mutation CreateProjectTemplateMilestone($input: CreateProjectTemplateMilestoneInput!) {\n    createProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n": types.CreateProjectTemplateMilestoneDocument,
    "\n  \n  mutation UpdateProjectTemplateMilestone($input: UpdateProjectTemplateMilestoneInput!) {\n    updateProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n": types.UpdateProjectTemplateMilestoneDocument,
    "\n  mutation DeleteProjectTemplateMilestone($id: UUID!) {\n    deleteProjectTemplateMilestone(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteProjectTemplateMilestoneDocument,
    "\n  \n  mutation CreateProjectTemplateIssue($input: CreateProjectTemplateIssueInput!) {\n    createProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n": types.CreateProjectTemplateIssueDocument,
    "\n  \n  mutation UpdateProjectTemplateIssue($input: UpdateProjectTemplateIssueInput!) {\n    updateProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n": types.UpdateProjectTemplateIssueDocument,
    "\n  mutation DeleteProjectTemplateIssue($id: UUID!) {\n    deleteProjectTemplateIssue(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteProjectTemplateIssueDocument,
    "\n  fragment ProjectUpdateFields on ProjectUpdate {\n    id\n    workspaceId\n    projectId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n": types.ProjectUpdateFieldsFragmentDoc,
    "\n  \n  mutation CreateProjectUpdate($input: CreateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    createProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n": types.CreateProjectUpdateDocument,
    "\n  \n  mutation UpdateProjectUpdate($input: UpdateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    updateProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n": types.UpdateProjectUpdateDocument,
    "\n  mutation DeleteProjectUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteProjectUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteProjectUpdateDocument,
    "\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ProjectStatusFieldsFragmentDoc,
    "\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    updateSchedule\n    updateReminderIntervalDays\n    updateReminderWeekday\n    updateReminderHour\n    archivedAt\n    deletedAt\n    deletedBy\n    projectTemplateId\n    createdAt\n    updatedAt\n  }\n": types.ProjectFieldsFragmentDoc,
    "\n  fragment ProjectTeamFields on ProjectTeam {\n    id\n    workspaceId\n    projectId\n    teamId\n    createdAt\n  }\n": types.ProjectTeamFieldsFragmentDoc,
    "\n  fragment ProjectMemberFields on ProjectMember {\n    id\n    workspaceId\n    projectId\n    userId\n    createdAt\n  }\n": types.ProjectMemberFieldsFragmentDoc,
    "\n  fragment ProjectMilestoneFields on ProjectMilestone {\n    id\n    workspaceId\n    projectId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ProjectMilestoneFieldsFragmentDoc,
    "\n  \n  mutation CreateProject($input: CreateProjectInput!, $clientId: UUID, $opId: UUID) {\n    createProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": types.CreateProjectDocument,
    "\n  \n  mutation UpdateProject($input: UpdateProjectInput!, $clientId: UUID, $opId: UUID) {\n    updateProject(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      project {\n        ...ProjectFields\n      }\n    }\n  }\n": types.UpdateProjectDocument,
    "\n  mutation DeleteProject($id: UUID!, $clientId: UUID, $opId: UUID) {\n    deleteProject(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteProjectDocument,
    "\n  \n  mutation AddProjectTeam($projectId: UUID!, $teamId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectTeam(projectId: $projectId, teamId: $teamId, clientId: $clientId, opId: $opId) {\n      version\n      projectTeam {\n        ...ProjectTeamFields\n      }\n    }\n  }\n": types.AddProjectTeamDocument,
    "\n  \n  mutation AddProjectMember($projectId: UUID!, $userId: UUID!, $clientId: UUID, $opId: UUID) {\n    addProjectMember(projectId: $projectId, userId: $userId, clientId: $clientId, opId: $opId) {\n      version\n      projectMember {\n        ...ProjectMemberFields\n      }\n    }\n  }\n": types.AddProjectMemberDocument,
    "\n  fragment ProjectDependencyFields on ProjectDependency {\n    id\n    workspaceId\n    blockingProjectId\n    blockedProjectId\n    createdAt\n  }\n": types.ProjectDependencyFieldsFragmentDoc,
    "\n  \n  mutation AddProjectDependency(\n    $blockingProjectId: UUID!\n    $blockedProjectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addProjectDependency(\n      blockingProjectId: $blockingProjectId\n      blockedProjectId: $blockedProjectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      projectDependency {\n        ...ProjectDependencyFields\n      }\n    }\n  }\n": types.AddProjectDependencyDocument,
    "\n  mutation RemoveProjectDependency($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    removeProjectDependency(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.RemoveProjectDependencyDocument,
    "\n  \n  mutation CreateProjectStatus($input: CreateProjectStatusInput!) {\n    createProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n": types.CreateProjectStatusDocument,
    "\n  \n  mutation UpdateProjectStatus($input: UpdateProjectStatusInput!) {\n    updateProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n": types.UpdateProjectStatusDocument,
    "\n  mutation ArchiveProjectStatus($id: UUID!, $archived: Boolean!) {\n    archiveProjectStatus(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveProjectStatusDocument,
    "\n  fragment PulseFeedFields on PulseFeed {\n    id\n    workspaceId\n    userId\n    name\n    projectIds\n    createdAt\n    updatedAt\n  }\n": types.PulseFeedFieldsFragmentDoc,
    "\n  \n  mutation CreatePulseFeed($input: CreatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    createPulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n": types.CreatePulseFeedDocument,
    "\n  \n  mutation UpdatePulseFeed($input: UpdatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    updatePulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n": types.UpdatePulseFeedDocument,
    "\n  mutation DeletePulseFeed($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deletePulseFeed(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeletePulseFeedDocument,
    "\n  fragment RecurringIssueFields on RecurringIssue {\n    id\n    workspaceId\n    teamId\n    title\n    body\n    properties\n    templateId\n    cadence\n    nextDueDate\n    lastCreatedAt\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.RecurringIssueFieldsFragmentDoc,
    "\n  \n  mutation CreateRecurringIssue($input: CreateRecurringIssueInput!) {\n    createRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n": types.CreateRecurringIssueDocument,
    "\n  \n  mutation UpdateRecurringIssue($input: UpdateRecurringIssueInput!) {\n    updateRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n": types.UpdateRecurringIssueDocument,
    "\n  mutation ArchiveRecurringIssue($id: UUID!, $archived: Boolean!) {\n    archiveRecurringIssue(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveRecurringIssueDocument,
    "\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n": types.SearchDocument,
    "\n  fragment SentryConnectionFields on SentryConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    organizationSlug\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": types.SentryConnectionFieldsFragmentDoc,
    "\n  query SentrySettings {\n    sentryWebhook {\n      url\n      secret\n    }\n  }\n": types.SentrySettingsDocument,
    "\n  \n  mutation CreateSentryConnection($input: CreateSentryConnectionInput!) {\n    createSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n": types.CreateSentryConnectionDocument,
    "\n  \n  mutation UpdateSentryConnection($input: UpdateSentryConnectionInput!) {\n    updateSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n": types.UpdateSentryConnectionDocument,
    "\n  mutation DeleteSentryConnection {\n    deleteSentryConnection {\n      version\n      id\n    }\n  }\n": types.DeleteSentryConnectionDocument,
    "\n  fragment SlackConnectionFields on SlackConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    channelName\n    notifyIssues\n    notifyComments\n    asksEnabled\n    connectedAt\n    createdAt\n    updatedAt\n  }\n": types.SlackConnectionFieldsFragmentDoc,
    "\n  query SlackInbound {\n    slackInbound {\n      commandUrl\n      eventsUrl\n      webhookConfigured\n      signingSecretConfigured\n      botTokenConfigured\n    }\n  }\n": types.SlackInboundDocument,
    "\n  \n  mutation CreateSlackConnection($input: CreateSlackConnectionInput!) {\n    createSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n": types.CreateSlackConnectionDocument,
    "\n  \n  mutation UpdateSlackConnection($input: UpdateSlackConnectionInput!) {\n    updateSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n": types.UpdateSlackConnectionDocument,
    "\n  mutation DeleteSlackConnection {\n    deleteSlackConnection {\n      version\n      id\n    }\n  }\n": types.DeleteSlackConnectionDocument,
    "\n  fragment SlaRuleFields on SlaRule {\n    id\n    workspaceId\n    position\n    filter\n    action\n    durationMinutes\n    createdAt\n    updatedAt\n  }\n": types.SlaRuleFieldsFragmentDoc,
    "\n  \n  mutation CreateSlaRule($input: CreateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    createSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n": types.CreateSlaRuleDocument,
    "\n  \n  mutation UpdateSlaRule($input: UpdateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n": types.UpdateSlaRuleDocument,
    "\n  mutation DeleteSlaRule($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteSlaRule(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteSlaRuleDocument,
    "\n  \n  mutation SetIssueSla($input: SetIssueSlaInput!, $clientId: UUID!, $opId: UUID!) {\n    setIssueSla(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.SetIssueSlaDocument,
    "\n  \n  mutation ClearIssueSla($issueId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    clearIssueSla(issueId: $issueId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n": types.ClearIssueSlaDocument,
    "\n  \n  query DeletedTeams {\n    deletedTeams {\n      ...TeamFields\n      deletedAt\n    }\n  }\n": types.DeletedTeamsDocument,
    "\n  \n  mutation RetireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    retireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.RetireTeamDocument,
    "\n  \n  mutation UnretireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    unretireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UnretireTeamDocument,
    "\n  mutation DeleteTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteTeamDocument,
    "\n  \n  mutation RestoreTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.RestoreTeamDocument,
    "\n  \n  mutation MoveTeam($teamId: UUID!, $parentTeamId: UUID, $clientId: UUID!, $opId: UUID!) {\n    moveTeam(teamId: $teamId, parentTeamId: $parentTeamId, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.MoveTeamDocument,
    "\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    subIssues {\n      title\n    }\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n    emailIntakeEnabled\n    emailIntakeAddress\n  }\n": types.IssueTemplateFieldsFragmentDoc,
    "\n  \n  mutation CreateIssueTemplate($input: CreateIssueTemplateInput!) {\n    createIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": types.CreateIssueTemplateDocument,
    "\n  \n  mutation UpdateIssueTemplate($input: UpdateIssueTemplateInput!) {\n    updateIssueTemplate(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": types.UpdateIssueTemplateDocument,
    "\n  mutation ArchiveIssueTemplate($id: UUID!, $archived: Boolean!) {\n    archiveIssueTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n": types.ArchiveIssueTemplateDocument,
    "\n  \n  mutation UpdateIssueTemplateEmailIntake($input: UpdateIssueTemplateEmailIntakeInput!) {\n    updateIssueTemplateEmailIntake(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n": types.UpdateIssueTemplateEmailIntakeDocument,
    "\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    projectId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.ViewFieldsFragmentDoc,
    "\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n": types.ViewPreferenceFieldsFragmentDoc,
    "\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    folderId\n    name\n    position\n    createdAt\n    updatedAt\n  }\n": types.FavoriteFieldsFragmentDoc,
    "\n  \n  mutation CreateView($input: CreateViewInput!) {\n    createView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": types.CreateViewDocument,
    "\n  \n  mutation UpdateView($input: UpdateViewInput!) {\n    updateView(input: $input) {\n      version\n      view {\n        ...ViewFields\n      }\n    }\n  }\n": types.UpdateViewDocument,
    "\n  mutation DeleteView($id: UUID!) {\n    deleteView(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteViewDocument,
    "\n  \n  mutation SetViewPreference($viewKey: String!, $display: JSON!) {\n    setViewPreference(viewKey: $viewKey, display: $display) {\n      version\n      preference {\n        ...ViewPreferenceFields\n      }\n    }\n  }\n": types.SetViewPreferenceDocument,
    "\n  \n  mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!, $afterFavoriteId: UUID) {\n    addFavorite(kind: $kind, targetId: $targetId, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": types.AddFavoriteDocument,
    "\n  mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {\n    removeFavorite(kind: $kind, targetId: $targetId) {\n      version\n      id\n    }\n  }\n": types.RemoveFavoriteDocument,
    "\n  \n  mutation CreateFavoriteFolder($name: String!, $afterFavoriteId: UUID) {\n    createFavoriteFolder(name: $name, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": types.CreateFavoriteFolderDocument,
    "\n  \n  mutation UpdateFavoriteFolder($id: UUID!, $name: String!) {\n    updateFavoriteFolder(id: $id, name: $name) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": types.UpdateFavoriteFolderDocument,
    "\n  \n  mutation MoveFavorite($input: MoveFavoriteInput!) {\n    moveFavorite(input: $input) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n": types.MoveFavoriteDocument,
    "\n  fragment ViewSubscriptionFields on ViewSubscription {\n    id\n    workspaceId\n    viewId\n    userId\n    added\n    completed\n    createdAt\n    updatedAt\n  }\n": types.ViewSubscriptionFieldsFragmentDoc,
    "\n  \n  mutation SetViewSubscription($input: SetViewSubscriptionInput!) {\n    setViewSubscription(input: $input) {\n      version\n      viewSubscription {\n        ...ViewSubscriptionFields\n      }\n    }\n  }\n": types.SetViewSubscriptionDocument,
    "\n  mutation DeleteViewSubscription($viewId: UUID!) {\n    deleteViewSubscription(viewId: $viewId) {\n      version\n      id\n    }\n  }\n": types.DeleteViewSubscriptionDocument,
    "\n  fragment WebhookSummary on Webhook {\n    id\n    url\n    enabled\n    allPublicTeams\n    teamId\n    resourceTypes\n    consecutiveFailures\n    disabledAt\n    createdAt\n  }\n": types.WebhookSummaryFragmentDoc,
    "\n  \n  query Webhooks {\n    webhooks {\n      ...WebhookSummary\n    }\n  }\n": types.WebhooksDocument,
    "\n  query WebhookDeliveries($webhookId: UUID!) {\n    webhookDeliveries(webhookId: $webhookId, first: 20) {\n      id\n      attempt\n      lastStatus\n      lastError\n      deliveredAt\n      createdAt\n      entityType\n    }\n  }\n": types.WebhookDeliveriesDocument,
    "\n  \n  mutation CreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      version\n      created {\n        secret\n        webhook {\n          ...WebhookSummary\n        }\n      }\n    }\n  }\n": types.CreateWebhookDocument,
    "\n  \n  mutation UpdateWebhook($input: UpdateWebhookInput!) {\n    updateWebhook(input: $input) {\n      version\n      webhook {\n        ...WebhookSummary\n      }\n    }\n  }\n": types.UpdateWebhookDocument,
    "\n  mutation DeleteWebhook($id: UUID!) {\n    deleteWebhook(id: $id) {\n      version\n      id\n    }\n  }\n": types.DeleteWebhookDocument,
    "\n  fragment WorkspaceFields on Workspace {\n    id\n    name\n    urlKey\n    logoUrl\n    plan\n    planExpiresAt\n    planLapsedAt\n    seatLimit\n    projectUpdateReminderIntervalDays\n    projectUpdateReminderWeekday\n    projectUpdateReminderHour\n    pulseEnabled\n    pulseDigestCadence\n    customerRequestsEnabled\n    customerDefaultTeamId\n    customerRevenueUnit\n    customerTiers\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.WorkspaceFieldsFragmentDoc,
    "\n  \n  mutation UpdateWorkspace($input: UpdateWorkspaceInput!) {\n    updateWorkspace(input: $input) {\n      version\n      workspace {\n        ...WorkspaceFields\n      }\n    }\n  }\n": types.UpdateWorkspaceDocument,
    "\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": types.IssueFieldsFragmentDoc,
    "\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    defaultTemplateForMembersId\n    defaultTemplateForNonMembersId\n    emailIntakeEnabled\n    emailIntakeAddress\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n": types.TeamFieldsFragmentDoc,
    "\n  fragment StateFields on WorkflowState {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    isSystem\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.StateFieldsFragmentDoc,
    "\n  fragment UserFields on User {\n    id\n    workspaceId\n    name\n    displayName\n    avatarUrl\n    timezone\n    role\n    status\n    kind\n    email\n    notificationPrefs\n    lastSeenAt\n    createdAt\n    updatedAt\n    archivedAt\n  }\n": types.UserFieldsFragmentDoc,
    "\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    anchorStart\n    anchorEnd\n    quote\n    createdAt\n    updatedAt\n  }\n": types.CommentFieldsFragmentDoc,
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
    "\n  \n  mutation ResolveComment($id: UUID!, $resolved: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    resolveComment(id: $id, resolved: $resolved, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n": types.ResolveCommentDocument,
    "\n  \n  mutation CreateAttachment($input: CreateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    createAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": types.CreateAttachmentDocument,
    "\n  \n  mutation UpdateAttachment($input: UpdateAttachmentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAttachment(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      attachment {\n        ...AttachmentFields\n      }\n    }\n  }\n": types.UpdateAttachmentDocument,
    "\n  mutation DeleteAttachment($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAttachment(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n": types.DeleteAttachmentDocument,
    "\n  \n  \n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n        states {\n          ...StateFields\n        }\n      }\n    }\n  }\n": types.CreateTeamDocument,
    "\n  \n  mutation UpdateTeam($input: UpdateTeamInput!) {\n    updateTeam(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamDocument,
    "\n  fragment CycleFields on Cycle {\n    id\n    workspaceId\n    teamId\n    number\n    name\n    description\n    startsAt\n    endsAt\n    completedAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n": types.CycleFieldsFragmentDoc,
    "\n  \n  mutation UpdateTeamCycles($input: UpdateTeamCyclesInput!) {\n    updateTeamCycles(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamCyclesDocument,
    "\n  \n  mutation UpdateTeamTriage($input: UpdateTeamTriageInput!) {\n    updateTeamTriage(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamTriageDocument,
    "\n  \n  mutation UpdateTeamEmailIntake($input: UpdateTeamEmailIntakeInput!) {\n    updateTeamEmailIntake(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamEmailIntakeDocument,
    "\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamArchiveDocument,
    "\n  \n  mutation UpdateTeamTemplates($input: UpdateTeamTemplatesInput!) {\n    updateTeamTemplates(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n": types.UpdateTeamTemplatesDocument,
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
export function graphql(source: "\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        subTeams\n        multiLevelSubTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        slas\n        slack\n        lapsed\n      }\n    }\n  }\n"): (typeof documents)["\n  query Entitlements {\n    workspace {\n      id\n      name\n      plan\n      planExpiresAt\n      planLapsedAt\n      seatLimit\n      entitlements {\n        plan\n        seatLimit\n        seatsUsed\n        teamLimit\n        historyDays\n        privateTeams\n        subTeams\n        multiLevelSubTeams\n        customViews\n        apiKeys\n        sso\n        auditLog\n        slas\n        slack\n        lapsed\n      }\n    }\n  }\n"];
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
export function graphql(source: "\n  fragment AskFormFields on AskForm {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    token\n    creatorId\n    archivedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment AskFormFields on AskForm {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    token\n    creatorId\n    archivedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateAskForm($input: CreateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    createAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateAskForm($input: CreateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    createAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateAskForm($input: UpdateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateAskForm($input: UpdateAskFormInput!, $clientId: UUID!, $opId: UUID!) {\n    updateAskForm(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      askForm {\n        ...AskFormFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveAskForm($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveAskForm(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveAskForm($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveAskForm(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAskForm($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAskForm(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteAskForm($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteAskForm(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CustomerFields on Customer {\n    id\n    workspaceId\n    name\n    domains\n    revenue\n    size\n    tier\n    status\n    ownerId\n    logoUrl\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment CustomerFields on Customer {\n    id\n    workspaceId\n    name\n    domains\n    revenue\n    size\n    tier\n    status\n    ownerId\n    logoUrl\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CustomerRequestFields on CustomerRequest {\n    id\n    workspaceId\n    customerId\n    issueId\n    projectId\n    body\n    important\n    creatorId\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment CustomerRequestFields on CustomerRequest {\n    id\n    workspaceId\n    customerId\n    issueId\n    projectId\n    body\n    important\n    creatorId\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateCustomer($input: CreateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    createCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateCustomer($input: CreateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    createCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateCustomer($input: UpdateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateCustomer($input: UpdateCustomerInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCustomer(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateCustomerRequest(\n    $input: CreateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateCustomerRequest(\n    $input: CreateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateCustomerRequest(\n    $input: UpdateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateCustomerRequest(\n    $input: UpdateCustomerRequestInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      customerRequest {\n        ...CustomerRequestFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteCustomerRequest($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteCustomerRequest(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteCustomerRequest($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteCustomerRequest(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveCustomer($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCustomer(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveCustomer($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveCustomer(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation MergeCustomers($sourceId: UUID!, $intoId: UUID!) {\n    mergeCustomers(sourceId: $sourceId, intoId: $intoId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation MergeCustomers($sourceId: UUID!, $intoId: UUID!) {\n    mergeCustomers(sourceId: $sourceId, intoId: $intoId) {\n      version\n      customer {\n        ...CustomerFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation EnsureCycleCalendarFeed($teamId: UUID!) {\n    ensureCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation EnsureCycleCalendarFeed($teamId: UUID!) {\n    ensureCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RotateCycleCalendarFeed($teamId: UUID!) {\n    rotateCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation RotateCycleCalendarFeed($teamId: UUID!) {\n    rotateCycleCalendarFeed(teamId: $teamId) {\n      version\n      url\n      cycleCalendarFeed {\n        id\n        workspaceId\n        teamId\n        userId\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateCycle($input: UpdateCycleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCycle(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateCycle($input: UpdateCycleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateCycle(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation StartCycleToday($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    startCycleToday(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation StartCycleToday($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    startCycleToday(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      cycle {\n        ...CycleFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment DashboardFields on Dashboard {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    filter\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment DashboardFields on Dashboard {\n    id\n    workspaceId\n    teamId\n    ownerId\n    name\n    description\n    filter\n    creatorId\n    sortOrder\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment DashboardTileFields on DashboardTile {\n    id\n    workspaceId\n    dashboardId\n    title\n    measure\n    slice\n    display\n    filter\n    sortOrder\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment DashboardTileFields on DashboardTile {\n    id\n    workspaceId\n    dashboardId\n    title\n    measure\n    slice\n    display\n    filter\n    sortOrder\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateDashboard($input: CreateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateDashboard($input: CreateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateDashboard($input: UpdateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateDashboard($input: UpdateDashboardInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboard(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboard {\n        ...DashboardFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteDashboard($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboard(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteDashboard($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboard(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateDashboardTile($input: CreateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateDashboardTile($input: CreateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    createDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateDashboardTile($input: UpdateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateDashboardTile($input: UpdateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDashboardTile(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      dashboardTile {\n        ...DashboardTileFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteDashboardTile($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboardTile(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteDashboardTile($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDashboardTile(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment DocumentFields on Document {\n    id\n    workspaceId\n    teamId\n    projectId\n    title\n    body\n    sortOrder\n    creatorId\n    updatedBy\n    createdAt\n    updatedAt\n    archivedAt\n    deletedAt\n  }\n"): (typeof documents)["\n  fragment DocumentFields on Document {\n    id\n    workspaceId\n    teamId\n    projectId\n    title\n    body\n    sortOrder\n    creatorId\n    updatedBy\n    createdAt\n    updatedAt\n    archivedAt\n    deletedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateDocument($input: CreateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    createDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateDocument($input: CreateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    createDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateDocument($input: UpdateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateDocument($input: UpdateDocumentInput!, $clientId: UUID!, $opId: UUID!) {\n    updateDocument(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      document {\n        ...DocumentFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveDocument($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveDocument(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveDocument($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveDocument(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteDocument($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDocument(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteDocument($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteDocument(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment DraftFields on Draft {\n    id\n    workspaceId\n    userId\n    kind\n    payload\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment DraftFields on Draft {\n    id\n    workspaceId\n    userId\n    kind\n    payload\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query Drafts {\n    drafts {\n      ...DraftFields\n    }\n  }\n"): (typeof documents)["\n  \n  query Drafts {\n    drafts {\n      ...DraftFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateDraft($input: CreateDraftInput!) {\n    createDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateDraft($input: CreateDraftInput!) {\n    createDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateDraft($input: UpdateDraftInput!) {\n    updateDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateDraft($input: UpdateDraftInput!) {\n    updateDraft(input: $input) {\n      version\n      draft {\n        ...DraftFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteDraft($id: UUID!) {\n    deleteDraft(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteDraft($id: UUID!) {\n    deleteDraft(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment FormTemplateFields on FormTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment FormTemplateFields on FormTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment FormTemplateFieldFields on FormTemplateField {\n    id\n    workspaceId\n    formTemplateId\n    fieldType\n    label\n    description\n    required\n    sortOrder\n    config\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment FormTemplateFieldFields on FormTemplateField {\n    id\n    workspaceId\n    formTemplateId\n    fieldType\n    label\n    description\n    required\n    sortOrder\n    config\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateFormTemplate($input: CreateFormTemplateInput!) {\n    createFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateFormTemplate($input: CreateFormTemplateInput!) {\n    createFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateFormTemplate($input: UpdateFormTemplateInput!) {\n    updateFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateFormTemplate($input: UpdateFormTemplateInput!) {\n    updateFormTemplate(input: $input) {\n      version\n      template {\n        ...FormTemplateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveFormTemplate($id: UUID!, $archived: Boolean!) {\n    archiveFormTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveFormTemplate($id: UUID!, $archived: Boolean!) {\n    archiveFormTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateFormTemplateField($input: CreateFormTemplateFieldInput!) {\n    createFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateFormTemplateField($input: CreateFormTemplateFieldInput!) {\n    createFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateFormTemplateField($input: UpdateFormTemplateFieldInput!) {\n    updateFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateFormTemplateField($input: UpdateFormTemplateFieldInput!) {\n    updateFormTemplateField(input: $input) {\n      version\n      field {\n        ...FormTemplateFieldFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteFormTemplateField($id: UUID!) {\n    deleteFormTemplateField(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteFormTemplateField($id: UUID!) {\n    deleteFormTemplateField(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GitHubConnectionFields on GitHubConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    orgLogin\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment GitHubConnectionFields on GitHubConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    orgLogin\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GitHubUserLinkFields on GitHubUserLink {\n    id\n    workspaceId\n    userId\n    githubLogin\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment GitHubUserLinkFields on GitHubUserLink {\n    id\n    workspaceId\n    userId\n    githubLogin\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GitHubSettings {\n    githubOAuthConfigured\n    githubCommitWebhook {\n      url\n      secret\n    }\n  }\n"): (typeof documents)["\n  query GitHubSettings {\n    githubOAuthConfigured\n    githubCommitWebhook {\n      url\n      secret\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateGitHubConnection($input: CreateGitHubConnectionInput!) {\n    createGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateGitHubConnection($input: CreateGitHubConnectionInput!) {\n    createGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateGitHubConnection($input: UpdateGitHubConnectionInput!) {\n    updateGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateGitHubConnection($input: UpdateGitHubConnectionInput!) {\n    updateGitHubConnection(input: $input) {\n      version\n      githubConnection {\n        ...GitHubConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteGitHubConnection {\n    deleteGitHubConnection {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteGitHubConnection {\n    deleteGitHubConnection {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateGitHubUserLink($input: CreateGitHubUserLinkInput!) {\n    createGitHubUserLink(input: $input) {\n      version\n      githubUserLink {\n        ...GitHubUserLinkFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateGitHubUserLink($input: CreateGitHubUserLinkInput!) {\n    createGitHubUserLink(input: $input) {\n      version\n      githubUserLink {\n        ...GitHubUserLinkFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteGitHubUserLink {\n    deleteGitHubUserLink {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteGitHubUserLink {\n    deleteGitHubUserLink {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GitHubTeamAutomationFields on GitHubTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n"): (typeof documents)["\n  fragment GitHubTeamAutomationFields on GitHubTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query GitHubTeamAutomation($teamId: UUID!) {\n    githubTeamAutomation(teamId: $teamId) {\n      ...GitHubTeamAutomationFields\n    }\n  }\n"): (typeof documents)["\n  \n  query GitHubTeamAutomation($teamId: UUID!) {\n    githubTeamAutomation(teamId: $teamId) {\n      ...GitHubTeamAutomationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateGitHubTeamAutomation($input: UpdateGitHubTeamAutomationInput!) {\n    updateGitHubTeamAutomation(input: $input) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateGitHubTeamAutomation($input: UpdateGitHubTeamAutomationInput!) {\n    updateGitHubTeamAutomation(input: $input) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation DeleteGitHubTeamAutomation($teamId: UUID!) {\n    deleteGitHubTeamAutomation(teamId: $teamId) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation DeleteGitHubTeamAutomation($teamId: UUID!) {\n    deleteGitHubTeamAutomation(teamId: $teamId) {\n      githubTeamAutomation {\n        ...GitHubTeamAutomationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GitLabConnectionFields on GitLabConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    instanceUrl\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment GitLabConnectionFields on GitLabConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    instanceUrl\n    branchNameFormat\n    linkCommits\n    linkbacks\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GitLabUserLinkFields on GitLabUserLink {\n    id\n    workspaceId\n    userId\n    gitlabUsername\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment GitLabUserLinkFields on GitLabUserLink {\n    id\n    workspaceId\n    userId\n    gitlabUsername\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GitLabSettings {\n    gitlabWebhook {\n      url\n      secret\n    }\n  }\n"): (typeof documents)["\n  query GitLabSettings {\n    gitlabWebhook {\n      url\n      secret\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateGitLabConnection($input: CreateGitLabConnectionInput!) {\n    createGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateGitLabConnection($input: CreateGitLabConnectionInput!) {\n    createGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateGitLabConnection($input: UpdateGitLabConnectionInput!) {\n    updateGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateGitLabConnection($input: UpdateGitLabConnectionInput!) {\n    updateGitLabConnection(input: $input) {\n      version\n      gitlabConnection {\n        ...GitLabConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteGitLabConnection {\n    deleteGitLabConnection {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteGitLabConnection {\n    deleteGitLabConnection {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateGitLabUserLink($input: CreateGitLabUserLinkInput!) {\n    createGitLabUserLink(input: $input) {\n      version\n      gitlabUserLink {\n        ...GitLabUserLinkFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateGitLabUserLink($input: CreateGitLabUserLinkInput!) {\n    createGitLabUserLink(input: $input) {\n      version\n      gitlabUserLink {\n        ...GitLabUserLinkFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteGitLabUserLink {\n    deleteGitLabUserLink {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteGitLabUserLink {\n    deleteGitLabUserLink {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GitLabTeamAutomationFields on GitLabTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n"): (typeof documents)["\n  fragment GitLabTeamAutomationFields on GitLabTeamAutomation {\n    teamId\n    configured\n    draftedStateId\n    openedStateId\n    reviewRequestedStateId\n    readyForMergeStateId\n    mergedStateId\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query GitLabTeamAutomation($teamId: UUID!) {\n    gitlabTeamAutomation(teamId: $teamId) {\n      ...GitLabTeamAutomationFields\n    }\n  }\n"): (typeof documents)["\n  \n  query GitLabTeamAutomation($teamId: UUID!) {\n    gitlabTeamAutomation(teamId: $teamId) {\n      ...GitLabTeamAutomationFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateGitLabTeamAutomation($input: UpdateGitLabTeamAutomationInput!) {\n    updateGitLabTeamAutomation(input: $input) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateGitLabTeamAutomation($input: UpdateGitLabTeamAutomationInput!) {\n    updateGitLabTeamAutomation(input: $input) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation DeleteGitLabTeamAutomation($teamId: UUID!) {\n    deleteGitLabTeamAutomation(teamId: $teamId) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation DeleteGitLabTeamAutomation($teamId: UUID!) {\n    deleteGitLabTeamAutomation(teamId: $teamId) {\n      gitlabTeamAutomation {\n        ...GitLabTeamAutomationFields\n      }\n    }\n  }\n"];
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
export function graphql(source: "\n  fragment InitiativeLabelFields on InitiativeLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment InitiativeLabelFields on InitiativeLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment InitiativeLabelLinkFields on InitiativeLabelLink {\n    id\n    workspaceId\n    initiativeId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n"): (typeof documents)["\n  fragment InitiativeLabelLinkFields on InitiativeLabelLink {\n    id\n    workspaceId\n    initiativeId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateInitiativeLabel($input: CreateInitiativeLabelInput!) {\n    createInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateInitiativeLabel($input: CreateInitiativeLabelInput!) {\n    createInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateInitiativeLabel($input: UpdateInitiativeLabelInput!) {\n    updateInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateInitiativeLabel($input: UpdateInitiativeLabelInput!) {\n    updateInitiativeLabel(input: $input) {\n      version\n      initiativeLabel {\n        ...InitiativeLabelFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveInitiativeLabel($id: UUID!, $archived: Boolean!) {\n    archiveInitiativeLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveInitiativeLabel($id: UUID!, $archived: Boolean!) {\n    archiveInitiativeLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    addInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      initiativeLabelLink {\n        ...InitiativeLabelLinkFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    addInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      initiativeLabelLink {\n        ...InitiativeLabelLinkFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    removeInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {\n    removeInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment InitiativeUpdateFields on InitiativeUpdate {\n    id\n    workspaceId\n    initiativeId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment InitiativeUpdateFields on InitiativeUpdate {\n    id\n    workspaceId\n    initiativeId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateInitiativeUpdate(\n    $input: CreateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateInitiativeUpdate(\n    $input: CreateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    createInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateInitiativeUpdate(\n    $input: UpdateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateInitiativeUpdate(\n    $input: UpdateInitiativeUpdateInput!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    updateInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiativeUpdate {\n        ...InitiativeUpdateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteInitiativeUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteInitiativeUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteInitiativeUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteInitiativeUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment InitiativeFields on Initiative {\n    id\n    workspaceId\n    name\n    description\n    status\n    priority\n    ownerId\n    leadTeamId\n    sortOrder\n    targetDate\n    targetDateGranularity\n    creatorId\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment InitiativeFields on Initiative {\n    id\n    workspaceId\n    name\n    description\n    status\n    priority\n    ownerId\n    leadTeamId\n    sortOrder\n    targetDate\n    targetDateGranularity\n    creatorId\n    archivedAt\n    deletedAt\n    deletedBy\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment InitiativeProjectFields on InitiativeProject {\n    id\n    workspaceId\n    initiativeId\n    projectId\n    createdAt\n  }\n"): (typeof documents)["\n  fragment InitiativeProjectFields on InitiativeProject {\n    id\n    workspaceId\n    initiativeId\n    projectId\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateInitiative($input: CreateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    createInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateInitiative($input: CreateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    createInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateInitiative($input: UpdateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    updateInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateInitiative($input: UpdateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {\n    updateInitiative(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      initiative {\n        ...InitiativeFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeProject {\n        ...InitiativeProjectFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeProject {\n        ...InitiativeProjectFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveInitiativeProject(\n    $initiativeId: UUID!\n    $projectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeProject(\n      initiativeId: $initiativeId\n      projectId: $projectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveInitiative($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveInitiative(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveInitiative($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    archiveInitiative(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment InitiativeRelationFields on InitiativeRelation {\n    id\n    workspaceId\n    parentInitiativeId\n    childInitiativeId\n    sortOrder\n    createdBy\n    createdAt\n  }\n"): (typeof documents)["\n  fragment InitiativeRelationFields on InitiativeRelation {\n    id\n    workspaceId\n    parentInitiativeId\n    childInitiativeId\n    sortOrder\n    createdBy\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeRelation {\n        ...InitiativeRelationFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      initiativeRelation {\n        ...InitiativeRelationFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveInitiativeRelation(\n    $parentInitiativeId: UUID!\n    $childInitiativeId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    removeInitiativeRelation(\n      parentInitiativeId: $parentInitiativeId\n      childInitiativeId: $childInitiativeId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query IntegrationSubmissions {\n    integrationSubmissions {\n      id\n      workspaceId\n      submittedBy\n      name\n      website\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query IntegrationSubmissions {\n    integrationSubmissions {\n      id\n      workspaceId\n      submittedBy\n      name\n      website\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitIntegration($input: SubmitIntegrationInput!) {\n    submitIntegration(input: $input) {\n      submission {\n        id\n        workspaceId\n        submittedBy\n        name\n        website\n        summary\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation SubmitIntegration($input: SubmitIntegrationInput!) {\n    submitIntegration(input: $input) {\n      submission {\n        id\n        workspaceId\n        submittedBy\n        name\n        website\n        summary\n        createdAt\n        updatedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment SubIssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"];
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
export function graphql(source: "\n  \n  mutation MergeLabels($sourceId: UUID!, $intoId: UUID!) {\n    mergeLabels(sourceId: $sourceId, intoId: $intoId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation MergeLabels($sourceId: UUID!, $intoId: UUID!) {\n    mergeLabels(sourceId: $sourceId, intoId: $intoId) {\n      version\n      label {\n        ...LabelFields\n      }\n    }\n  }\n"];
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
export function graphql(source: "\n  fragment OauthClientFields on OauthClient {\n    id\n    workspaceId\n    creatorId\n    clientId\n    name\n    description\n    developer\n    developerUrl\n    imageUrl\n    redirectUris\n    allowedScopes\n    publicEnabled\n    clientCredentialsEnabled\n    webhookUrl\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment OauthClientFields on OauthClient {\n    id\n    workspaceId\n    creatorId\n    clientId\n    name\n    description\n    developer\n    developerUrl\n    imageUrl\n    redirectUris\n    allowedScopes\n    publicEnabled\n    clientCredentialsEnabled\n    webhookUrl\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query OauthClients {\n    oauthClients {\n      ...OauthClientFields\n    }\n  }\n"): (typeof documents)["\n  \n  query OauthClients {\n    oauthClients {\n      ...OauthClientFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OauthClientInfo($clientId: String!) {\n    oauthClientInfo(clientId: $clientId) {\n      clientId\n      name\n      description\n      developer\n      developerUrl\n      imageUrl\n      allowedScopes\n    }\n  }\n"): (typeof documents)["\n  query OauthClientInfo($clientId: String!) {\n    oauthClientInfo(clientId: $clientId) {\n      clientId\n      name\n      description\n      developer\n      developerUrl\n      imageUrl\n      allowedScopes\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateOauthClient($input: CreateOauthClientInput!) {\n    createOauthClient(input: $input) {\n      version\n      created {\n        clientSecret\n        oauthClient {\n          ...OauthClientFields\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateOauthClient($input: CreateOauthClientInput!) {\n    createOauthClient(input: $input) {\n      version\n      created {\n        clientSecret\n        oauthClient {\n          ...OauthClientFields\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateOauthClient($input: UpdateOauthClientInput!) {\n    updateOauthClient(input: $input) {\n      version\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateOauthClient($input: UpdateOauthClientInput!) {\n    updateOauthClient(input: $input) {\n      version\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation RotateOauthClientSecret($id: UUID!) {\n    rotateOauthClientSecret(id: $id) {\n      version\n      clientSecret\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation RotateOauthClientSecret($id: UUID!) {\n    rotateOauthClientSecret(id: $id) {\n      version\n      clientSecret\n      oauthClient {\n        ...OauthClientFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteOauthClient($id: UUID!) {\n    deleteOauthClient(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteOauthClient($id: UUID!) {\n    deleteOauthClient(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateOauthAuthorization($input: CreateOauthAuthorizationInput!) {\n    createOauthAuthorization(input: $input) {\n      redirectUri\n    }\n  }\n"): (typeof documents)["\n  mutation CreateOauthAuthorization($input: CreateOauthAuthorizationInput!) {\n    createOauthAuthorization(input: $input) {\n      redirectUri\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectLabelFields on ProjectLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment ProjectLabelFields on ProjectLabel {\n    id\n    workspaceId\n    parentId\n    isGroup\n    name\n    description\n    color\n    position\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectLabelLinkFields on ProjectLabelLink {\n    id\n    workspaceId\n    projectId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n"): (typeof documents)["\n  fragment ProjectLabelLinkFields on ProjectLabelLink {\n    id\n    workspaceId\n    projectId\n    labelId\n    groupId\n    createdBy\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateProjectLabel($input: CreateProjectLabelInput!) {\n    createProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateProjectLabel($input: CreateProjectLabelInput!) {\n    createProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProjectLabel($input: UpdateProjectLabelInput!) {\n    updateProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProjectLabel($input: UpdateProjectLabelInput!) {\n    updateProjectLabel(input: $input) {\n      version\n      projectLabel {\n        ...ProjectLabelFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveProjectLabel($id: UUID!, $archived: Boolean!) {\n    archiveProjectLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveProjectLabel($id: UUID!, $archived: Boolean!) {\n    archiveProjectLabel(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    addProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      projectLabelLink {\n        ...ProjectLabelLinkFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    addProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      projectLabelLink {\n        ...ProjectLabelLinkFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    removeProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveProjectLabel($projectId: UUID!, $labelId: UUID!) {\n    removeProjectLabel(projectId: $projectId, labelId: $labelId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectTemplateFields on ProjectTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    summary\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment ProjectTemplateFields on ProjectTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    summary\n    body\n    properties\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectTemplateMilestoneFields on ProjectTemplateMilestone {\n    id\n    workspaceId\n    projectTemplateId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ProjectTemplateMilestoneFields on ProjectTemplateMilestone {\n    id\n    workspaceId\n    projectTemplateId\n    name\n    description\n    targetDate\n    sortOrder\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectTemplateIssueFields on ProjectTemplateIssue {\n    id\n    workspaceId\n    projectTemplateId\n    parentId\n    title\n    description\n    properties\n    sortOrder\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ProjectTemplateIssueFields on ProjectTemplateIssue {\n    id\n    workspaceId\n    projectTemplateId\n    parentId\n    title\n    description\n    properties\n    sortOrder\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateProjectTemplate($input: CreateProjectTemplateInput!) {\n    createProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateProjectTemplate($input: CreateProjectTemplateInput!) {\n    createProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProjectTemplate($input: UpdateProjectTemplateInput!) {\n    updateProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProjectTemplate($input: UpdateProjectTemplateInput!) {\n    updateProjectTemplate(input: $input) {\n      version\n      template {\n        ...ProjectTemplateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveProjectTemplate($id: UUID!, $archived: Boolean!) {\n    archiveProjectTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveProjectTemplate($id: UUID!, $archived: Boolean!) {\n    archiveProjectTemplate(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateProjectTemplateMilestone($input: CreateProjectTemplateMilestoneInput!) {\n    createProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateProjectTemplateMilestone($input: CreateProjectTemplateMilestoneInput!) {\n    createProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProjectTemplateMilestone($input: UpdateProjectTemplateMilestoneInput!) {\n    updateProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProjectTemplateMilestone($input: UpdateProjectTemplateMilestoneInput!) {\n    updateProjectTemplateMilestone(input: $input) {\n      version\n      milestone {\n        ...ProjectTemplateMilestoneFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteProjectTemplateMilestone($id: UUID!) {\n    deleteProjectTemplateMilestone(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteProjectTemplateMilestone($id: UUID!) {\n    deleteProjectTemplateMilestone(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateProjectTemplateIssue($input: CreateProjectTemplateIssueInput!) {\n    createProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateProjectTemplateIssue($input: CreateProjectTemplateIssueInput!) {\n    createProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProjectTemplateIssue($input: UpdateProjectTemplateIssueInput!) {\n    updateProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProjectTemplateIssue($input: UpdateProjectTemplateIssueInput!) {\n    updateProjectTemplateIssue(input: $input) {\n      version\n      issue {\n        ...ProjectTemplateIssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteProjectTemplateIssue($id: UUID!) {\n    deleteProjectTemplateIssue(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteProjectTemplateIssue($id: UUID!) {\n    deleteProjectTemplateIssue(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectUpdateFields on ProjectUpdate {\n    id\n    workspaceId\n    projectId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ProjectUpdateFields on ProjectUpdate {\n    id\n    workspaceId\n    projectId\n    health\n    body\n    authorId\n    editedAt\n    deletedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateProjectUpdate($input: CreateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    createProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateProjectUpdate($input: CreateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    createProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProjectUpdate($input: UpdateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    updateProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProjectUpdate($input: UpdateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {\n    updateProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      projectUpdate {\n        ...ProjectUpdateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteProjectUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteProjectUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteProjectUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteProjectUpdate(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment ProjectStatusFields on ProjectStatus {\n    id\n    workspaceId\n    name\n    description\n    color\n    category\n    position\n    isDefault\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    updateSchedule\n    updateReminderIntervalDays\n    updateReminderWeekday\n    updateReminderHour\n    archivedAt\n    deletedAt\n    deletedBy\n    projectTemplateId\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ProjectFields on Project {\n    id\n    workspaceId\n    name\n    summary\n    description\n    icon\n    color\n    statusId\n    priority\n    leadId\n    creatorId\n    sortOrder\n    startDate\n    startDateGranularity\n    targetDate\n    targetDateGranularity\n    updateSchedule\n    updateReminderIntervalDays\n    updateReminderWeekday\n    updateReminderHour\n    archivedAt\n    deletedAt\n    deletedBy\n    projectTemplateId\n    createdAt\n    updatedAt\n  }\n"];
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
export function graphql(source: "\n  fragment ProjectDependencyFields on ProjectDependency {\n    id\n    workspaceId\n    blockingProjectId\n    blockedProjectId\n    createdAt\n  }\n"): (typeof documents)["\n  fragment ProjectDependencyFields on ProjectDependency {\n    id\n    workspaceId\n    blockingProjectId\n    blockedProjectId\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation AddProjectDependency(\n    $blockingProjectId: UUID!\n    $blockedProjectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addProjectDependency(\n      blockingProjectId: $blockingProjectId\n      blockedProjectId: $blockedProjectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      projectDependency {\n        ...ProjectDependencyFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation AddProjectDependency(\n    $blockingProjectId: UUID!\n    $blockedProjectId: UUID!\n    $clientId: UUID!\n    $opId: UUID!\n  ) {\n    addProjectDependency(\n      blockingProjectId: $blockingProjectId\n      blockedProjectId: $blockedProjectId\n      clientId: $clientId\n      opId: $opId\n    ) {\n      version\n      projectDependency {\n        ...ProjectDependencyFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveProjectDependency($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    removeProjectDependency(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation RemoveProjectDependency($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    removeProjectDependency(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateProjectStatus($input: CreateProjectStatusInput!) {\n    createProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateProjectStatus($input: CreateProjectStatusInput!) {\n    createProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateProjectStatus($input: UpdateProjectStatusInput!) {\n    updateProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateProjectStatus($input: UpdateProjectStatusInput!) {\n    updateProjectStatus(input: $input) {\n      version\n      status {\n        ...ProjectStatusFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveProjectStatus($id: UUID!, $archived: Boolean!) {\n    archiveProjectStatus(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveProjectStatus($id: UUID!, $archived: Boolean!) {\n    archiveProjectStatus(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PulseFeedFields on PulseFeed {\n    id\n    workspaceId\n    userId\n    name\n    projectIds\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment PulseFeedFields on PulseFeed {\n    id\n    workspaceId\n    userId\n    name\n    projectIds\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreatePulseFeed($input: CreatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    createPulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreatePulseFeed($input: CreatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    createPulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdatePulseFeed($input: UpdatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    updatePulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdatePulseFeed($input: UpdatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {\n    updatePulseFeed(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      pulseFeed {\n        ...PulseFeedFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeletePulseFeed($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deletePulseFeed(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeletePulseFeed($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deletePulseFeed(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment RecurringIssueFields on RecurringIssue {\n    id\n    workspaceId\n    teamId\n    title\n    body\n    properties\n    templateId\n    cadence\n    nextDueDate\n    lastCreatedAt\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment RecurringIssueFields on RecurringIssue {\n    id\n    workspaceId\n    teamId\n    title\n    body\n    properties\n    templateId\n    cadence\n    nextDueDate\n    lastCreatedAt\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateRecurringIssue($input: CreateRecurringIssueInput!) {\n    createRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateRecurringIssue($input: CreateRecurringIssueInput!) {\n    createRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateRecurringIssue($input: UpdateRecurringIssueInput!) {\n    updateRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateRecurringIssue($input: UpdateRecurringIssueInput!) {\n    updateRecurringIssue(input: $input) {\n      version\n      recurringIssue {\n        ...RecurringIssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveRecurringIssue($id: UUID!, $archived: Boolean!) {\n    archiveRecurringIssue(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ArchiveRecurringIssue($id: UUID!, $archived: Boolean!) {\n    archiveRecurringIssue(id: $id, archived: $archived) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query Search($input: SearchInput!) {\n    search(input: $input) {\n      issueCount\n      issues {\n        id\n        identifier\n        title\n        priority\n        state {\n          id\n          name\n          category\n          color\n        }\n        assignee {\n          id\n          displayName\n          avatarUrl\n        }\n      }\n      comments {\n        id\n        issueId\n        body\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SentryConnectionFields on SentryConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    organizationSlug\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment SentryConnectionFields on SentryConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    organizationSlug\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SentrySettings {\n    sentryWebhook {\n      url\n      secret\n    }\n  }\n"): (typeof documents)["\n  query SentrySettings {\n    sentryWebhook {\n      url\n      secret\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateSentryConnection($input: CreateSentryConnectionInput!) {\n    createSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateSentryConnection($input: CreateSentryConnectionInput!) {\n    createSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateSentryConnection($input: UpdateSentryConnectionInput!) {\n    updateSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateSentryConnection($input: UpdateSentryConnectionInput!) {\n    updateSentryConnection(input: $input) {\n      version\n      sentryConnection {\n        ...SentryConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSentryConnection {\n    deleteSentryConnection {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteSentryConnection {\n    deleteSentryConnection {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SlackConnectionFields on SlackConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    channelName\n    notifyIssues\n    notifyComments\n    asksEnabled\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment SlackConnectionFields on SlackConnection {\n    id\n    workspaceId\n    creatorId\n    enabled\n    defaultTeamId\n    channelName\n    notifyIssues\n    notifyComments\n    asksEnabled\n    connectedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SlackInbound {\n    slackInbound {\n      commandUrl\n      eventsUrl\n      webhookConfigured\n      signingSecretConfigured\n      botTokenConfigured\n    }\n  }\n"): (typeof documents)["\n  query SlackInbound {\n    slackInbound {\n      commandUrl\n      eventsUrl\n      webhookConfigured\n      signingSecretConfigured\n      botTokenConfigured\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateSlackConnection($input: CreateSlackConnectionInput!) {\n    createSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateSlackConnection($input: CreateSlackConnectionInput!) {\n    createSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateSlackConnection($input: UpdateSlackConnectionInput!) {\n    updateSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateSlackConnection($input: UpdateSlackConnectionInput!) {\n    updateSlackConnection(input: $input) {\n      version\n      slackConnection {\n        ...SlackConnectionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSlackConnection {\n    deleteSlackConnection {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteSlackConnection {\n    deleteSlackConnection {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SlaRuleFields on SlaRule {\n    id\n    workspaceId\n    position\n    filter\n    action\n    durationMinutes\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment SlaRuleFields on SlaRule {\n    id\n    workspaceId\n    position\n    filter\n    action\n    durationMinutes\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateSlaRule($input: CreateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    createSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateSlaRule($input: CreateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    createSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateSlaRule($input: UpdateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateSlaRule($input: UpdateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {\n    updateSlaRule(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      slaRule {\n        ...SlaRuleFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSlaRule($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteSlaRule(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteSlaRule($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteSlaRule(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SetIssueSla($input: SetIssueSlaInput!, $clientId: UUID!, $opId: UUID!) {\n    setIssueSla(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SetIssueSla($input: SetIssueSlaInput!, $clientId: UUID!, $opId: UUID!) {\n    setIssueSla(input: $input, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation ClearIssueSla($issueId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    clearIssueSla(issueId: $issueId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation ClearIssueSla($issueId: UUID!, $clientId: UUID!, $opId: UUID!) {\n    clearIssueSla(issueId: $issueId, clientId: $clientId, opId: $opId) {\n      version\n      issue {\n        ...IssueFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query DeletedTeams {\n    deletedTeams {\n      ...TeamFields\n      deletedAt\n    }\n  }\n"): (typeof documents)["\n  \n  query DeletedTeams {\n    deletedTeams {\n      ...TeamFields\n      deletedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation RetireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    retireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation RetireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    retireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UnretireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    unretireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UnretireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    unretireTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    deleteTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation RestoreTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation RestoreTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {\n    restoreTeam(id: $id, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation MoveTeam($teamId: UUID!, $parentTeamId: UUID, $clientId: UUID!, $opId: UUID!) {\n    moveTeam(teamId: $teamId, parentTeamId: $parentTeamId, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation MoveTeam($teamId: UUID!, $parentTeamId: UUID, $clientId: UUID!, $opId: UUID!) {\n    moveTeam(teamId: $teamId, parentTeamId: $parentTeamId, clientId: $clientId, opId: $opId) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    subIssues {\n      title\n    }\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n    emailIntakeEnabled\n    emailIntakeAddress\n  }\n"): (typeof documents)["\n  fragment IssueTemplateFields on IssueTemplate {\n    id\n    workspaceId\n    teamId\n    name\n    description\n    title\n    body\n    properties\n    subIssues {\n      title\n    }\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n    emailIntakeEnabled\n    emailIntakeAddress\n  }\n"];
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
export function graphql(source: "\n  \n  mutation UpdateIssueTemplateEmailIntake($input: UpdateIssueTemplateEmailIntakeInput!) {\n    updateIssueTemplateEmailIntake(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateIssueTemplateEmailIntake($input: UpdateIssueTemplateEmailIntakeInput!) {\n    updateIssueTemplateEmailIntake(input: $input) {\n      version\n      template {\n        ...IssueTemplateFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    projectId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment ViewFields on View {\n    id\n    workspaceId\n    teamId\n    projectId\n    ownerId\n    name\n    description\n    icon\n    color\n    filter\n    display\n    position\n    createdBy\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ViewPreferenceFields on ViewPreference {\n    id\n    workspaceId\n    userId\n    viewKey\n    display\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    folderId\n    name\n    position\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment FavoriteFields on Favorite {\n    id\n    workspaceId\n    userId\n    kind\n    targetId\n    folderId\n    name\n    position\n    createdAt\n    updatedAt\n  }\n"];
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
export function graphql(source: "\n  \n  mutation CreateFavoriteFolder($name: String!, $afterFavoriteId: UUID) {\n    createFavoriteFolder(name: $name, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateFavoriteFolder($name: String!, $afterFavoriteId: UUID) {\n    createFavoriteFolder(name: $name, afterFavoriteId: $afterFavoriteId) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateFavoriteFolder($id: UUID!, $name: String!) {\n    updateFavoriteFolder(id: $id, name: $name) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateFavoriteFolder($id: UUID!, $name: String!) {\n    updateFavoriteFolder(id: $id, name: $name) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation MoveFavorite($input: MoveFavoriteInput!) {\n    moveFavorite(input: $input) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation MoveFavorite($input: MoveFavoriteInput!) {\n    moveFavorite(input: $input) {\n      version\n      favorite {\n        ...FavoriteFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ViewSubscriptionFields on ViewSubscription {\n    id\n    workspaceId\n    viewId\n    userId\n    added\n    completed\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment ViewSubscriptionFields on ViewSubscription {\n    id\n    workspaceId\n    viewId\n    userId\n    added\n    completed\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation SetViewSubscription($input: SetViewSubscriptionInput!) {\n    setViewSubscription(input: $input) {\n      version\n      viewSubscription {\n        ...ViewSubscriptionFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation SetViewSubscription($input: SetViewSubscriptionInput!) {\n    setViewSubscription(input: $input) {\n      version\n      viewSubscription {\n        ...ViewSubscriptionFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteViewSubscription($viewId: UUID!) {\n    deleteViewSubscription(viewId: $viewId) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteViewSubscription($viewId: UUID!) {\n    deleteViewSubscription(viewId: $viewId) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment WebhookSummary on Webhook {\n    id\n    url\n    enabled\n    allPublicTeams\n    teamId\n    resourceTypes\n    consecutiveFailures\n    disabledAt\n    createdAt\n  }\n"): (typeof documents)["\n  fragment WebhookSummary on Webhook {\n    id\n    url\n    enabled\n    allPublicTeams\n    teamId\n    resourceTypes\n    consecutiveFailures\n    disabledAt\n    createdAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  query Webhooks {\n    webhooks {\n      ...WebhookSummary\n    }\n  }\n"): (typeof documents)["\n  \n  query Webhooks {\n    webhooks {\n      ...WebhookSummary\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query WebhookDeliveries($webhookId: UUID!) {\n    webhookDeliveries(webhookId: $webhookId, first: 20) {\n      id\n      attempt\n      lastStatus\n      lastError\n      deliveredAt\n      createdAt\n      entityType\n    }\n  }\n"): (typeof documents)["\n  query WebhookDeliveries($webhookId: UUID!) {\n    webhookDeliveries(webhookId: $webhookId, first: 20) {\n      id\n      attempt\n      lastStatus\n      lastError\n      deliveredAt\n      createdAt\n      entityType\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation CreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      version\n      created {\n        secret\n        webhook {\n          ...WebhookSummary\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation CreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      version\n      created {\n        secret\n        webhook {\n          ...WebhookSummary\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateWebhook($input: UpdateWebhookInput!) {\n    updateWebhook(input: $input) {\n      version\n      webhook {\n        ...WebhookSummary\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateWebhook($input: UpdateWebhookInput!) {\n    updateWebhook(input: $input) {\n      version\n      webhook {\n        ...WebhookSummary\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteWebhook($id: UUID!) {\n    deleteWebhook(id: $id) {\n      version\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteWebhook($id: UUID!) {\n    deleteWebhook(id: $id) {\n      version\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment WorkspaceFields on Workspace {\n    id\n    name\n    urlKey\n    logoUrl\n    plan\n    planExpiresAt\n    planLapsedAt\n    seatLimit\n    projectUpdateReminderIntervalDays\n    projectUpdateReminderWeekday\n    projectUpdateReminderHour\n    pulseEnabled\n    pulseDigestCadence\n    customerRequestsEnabled\n    customerDefaultTeamId\n    customerRevenueUnit\n    customerTiers\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment WorkspaceFields on Workspace {\n    id\n    name\n    urlKey\n    logoUrl\n    plan\n    planExpiresAt\n    planLapsedAt\n    seatLimit\n    projectUpdateReminderIntervalDays\n    projectUpdateReminderWeekday\n    projectUpdateReminderHour\n    pulseEnabled\n    pulseDigestCadence\n    customerRequestsEnabled\n    customerDefaultTeamId\n    customerRevenueUnit\n    customerTiers\n    createdAt\n    updatedAt\n    archivedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateWorkspace($input: UpdateWorkspaceInput!) {\n    updateWorkspace(input: $input) {\n      version\n      workspace {\n        ...WorkspaceFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateWorkspace($input: UpdateWorkspaceInput!) {\n    updateWorkspace(input: $input) {\n      version\n      workspace {\n        ...WorkspaceFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment IssueFields on Issue {\n    id\n    workspaceId\n    teamId\n    number\n    identifier\n    title\n    description\n    stateId\n    assigneeId\n    creatorId\n    priority\n    sortOrder\n    estimate\n    dueDate\n    dueDateSource\n    parentId\n    subIssueSortOrder\n    templateId\n    formTemplateId\n    recurringIssueId\n    projectId\n    projectMilestoneId\n    cycleId\n    snoozedUntil\n    autoClosedAt\n    startedAt\n    completedAt\n    canceledAt\n    archivedAt\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    defaultTemplateForMembersId\n    defaultTemplateForNonMembersId\n    emailIntakeEnabled\n    emailIntakeAddress\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n"): (typeof documents)["\n  fragment TeamFields on Team {\n    id\n    workspaceId\n    key\n    name\n    description\n    icon\n    color\n    timezone\n    parentTeamId\n    private\n    estimateScale\n    estimateAllowZero\n    estimateExtended\n    cyclesEnabled\n    cycleDurationWeeks\n    cycleCooldownWeeks\n    cycleStartDay\n    cycleUpcomingCount\n    cycleAutoAddStarted\n    cycleAutoAddCompleted\n    triageEnabled\n    triageRequirePriority\n    autoCloseDays\n    autoArchiveDays\n    autoCloseParent\n    autoCloseChildren\n    defaultTemplateForMembersId\n    defaultTemplateForNonMembersId\n    emailIntakeEnabled\n    emailIntakeAddress\n    createdAt\n    updatedAt\n    retiredAt\n    archivedAt\n  }\n"];
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
export function graphql(source: "\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    anchorStart\n    anchorEnd\n    quote\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment CommentFields on Comment {\n    id\n    workspaceId\n    issueId\n    parentId\n    body\n    actor {\n      type\n      id\n    }\n    editedAt\n    resolvedAt\n    resolvedBy\n    anchorStart\n    anchorEnd\n    quote\n    createdAt\n    updatedAt\n  }\n"];
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
export function graphql(source: "\n  \n  mutation ResolveComment($id: UUID!, $resolved: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    resolveComment(id: $id, resolved: $resolved, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation ResolveComment($id: UUID!, $resolved: Boolean!, $clientId: UUID!, $opId: UUID!) {\n    resolveComment(id: $id, resolved: $resolved, clientId: $clientId, opId: $opId) {\n      version\n      comment {\n        ...CommentFields\n      }\n    }\n  }\n"];
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
export function graphql(source: "\n  \n  mutation UpdateTeamEmailIntake($input: UpdateTeamEmailIntakeInput!) {\n    updateTeamEmailIntake(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateTeamEmailIntake($input: UpdateTeamEmailIntakeInput!) {\n    updateTeamEmailIntake(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateTeamArchive($input: UpdateTeamArchiveInput!) {\n    updateTeamArchive(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  \n  mutation UpdateTeamTemplates($input: UpdateTeamTemplatesInput!) {\n    updateTeamTemplates(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"): (typeof documents)["\n  \n  mutation UpdateTeamTemplates($input: UpdateTeamTemplatesInput!) {\n    updateTeamTemplates(input: $input) {\n      version\n      team {\n        ...TeamFields\n      }\n    }\n  }\n"];
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