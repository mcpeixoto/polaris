/**
 * The writes the issue detail screen makes that the M0 operations did not cover: a child
 * issue, a link between two issues, and the viewer's subscription.
 *
 * They live beside the panels that send them rather than in `~/gql/operations`. Codegen
 * scans `src/**` for documents, so an operation is type-checked against the schema wherever
 * it is written, and keeping a relation mutation next to the panel that renders relations
 * means the two move together.
 *
 * `SubIssueFields` is the whole issue rather than the shared module's narrower
 * `IssueFields`, and that is load-bearing rather than tidiness. Creating a child swaps the
 * client's provisional row for the one the server returns, so a response that omitted
 * `parentId` would drop the new child out of its parent's list — visibly, until the delta
 * for the same write arrived to put it back.
 */

export const SUB_ISSUE_FIELDS = /* GraphQL */ `
  fragment SubIssueFields on Issue {
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

export const RELATION_FIELDS = /* GraphQL */ `
  fragment RelationFields on IssueRelation {
    id
    workspaceId
    issueId
    relatedIssueId
    type
    teamId
    relatedTeamId
    createdBy
    createdAt
  }
`;

export const SUBSCRIPTION_FIELDS = /* GraphQL */ `
  fragment SubscriptionFields on IssueSubscription {
    id
    workspaceId
    issueId
    userId
    reason
    unsubscribed
    createdAt
    updatedAt
  }
`;

export const CREATE_SUB_ISSUE = /* GraphQL */ `
  ${SUB_ISSUE_FIELDS}
  mutation CreateSubIssue($input: CreateIssueInput!, $clientId: UUID!, $opId: UUID!) {
    createIssue(input: $input, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...SubIssueFields
      }
    }
  }
`;

export const CREATE_ISSUE_RELATION = /* GraphQL */ `
  ${RELATION_FIELDS}
  mutation CreateIssueRelation(
    $issueId: UUID!
    $relatedIssueId: UUID!
    $type: RelationType!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createIssueRelation(
      issueId: $issueId
      relatedIssueId: $relatedIssueId
      type: $type
      clientId: $clientId
      opId: $opId
    ) {
      version
      relation {
        ...RelationFields
      }
    }
  }
`;

export const DELETE_ISSUE_RELATION = /* GraphQL */ `
  mutation DeleteIssueRelation($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteIssueRelation(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

/**
 * Subscribing takes no `opId`: the server keys the row on the issue and the user, so a
 * replayed request lands on the same row and says the same thing. The engine sends the pair
 * anyway, and a variable no operation declares is ignored — see `updateTeam` for the same
 * shape.
 */
export const SET_ISSUE_SUBSCRIPTION = /* GraphQL */ `
  ${SUBSCRIPTION_FIELDS}
  mutation SetIssueSubscription($issueId: UUID!, $subscribed: Boolean!) {
    setIssueSubscription(issueId: $issueId, subscribed: $subscribed) {
      version
      subscription {
        ...SubscriptionFields
      }
    }
  }
`;
