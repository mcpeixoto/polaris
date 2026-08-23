/**
 * Recurring issue documents. Beside the mutations that send them, the same bargain as
 * templates: a fragment that mirrors the store entity so a mutation response and a sync
 * delta land with identical shapes.
 */

export const RECURRING_ISSUE_FIELDS = /* GraphQL */ `
  fragment RecurringIssueFields on RecurringIssue {
    id
    workspaceId
    teamId
    title
    body
    properties
    templateId
    cadence
    nextDueDate
    lastCreatedAt
    createdBy
    createdAt
    updatedAt
    archivedAt
  }
`;

export const CREATE_RECURRING_ISSUE = /* GraphQL */ `
  ${RECURRING_ISSUE_FIELDS}
  mutation CreateRecurringIssue(
    $input: CreateRecurringIssueInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createRecurringIssue(input: $input, clientId: $clientId, opId: $opId) {
      version
      recurringIssue {
        ...RecurringIssueFields
      }
    }
  }
`;

export const UPDATE_RECURRING_ISSUE = /* GraphQL */ `
  ${RECURRING_ISSUE_FIELDS}
  mutation UpdateRecurringIssue(
    $input: UpdateRecurringIssueInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    updateRecurringIssue(input: $input, clientId: $clientId, opId: $opId) {
      version
      recurringIssue {
        ...RecurringIssueFields
      }
    }
  }
`;

export const ARCHIVE_RECURRING_ISSUE = /* GraphQL */ `
  mutation ArchiveRecurringIssue($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {
    archiveRecurringIssue(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
