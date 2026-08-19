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
  mutation CreateRecurringIssue($input: CreateRecurringIssueInput!) {
    createRecurringIssue(input: $input) {
      version
      recurringIssue {
        ...RecurringIssueFields
      }
    }
  }
`;

export const UPDATE_RECURRING_ISSUE = /* GraphQL */ `
  ${RECURRING_ISSUE_FIELDS}
  mutation UpdateRecurringIssue($input: UpdateRecurringIssueInput!) {
    updateRecurringIssue(input: $input) {
      version
      recurringIssue {
        ...RecurringIssueFields
      }
    }
  }
`;

export const ARCHIVE_RECURRING_ISSUE = /* GraphQL */ `
  mutation ArchiveRecurringIssue($id: UUID!, $archived: Boolean!) {
    archiveRecurringIssue(id: $id, archived: $archived) {
      version
      id
    }
  }
`;
