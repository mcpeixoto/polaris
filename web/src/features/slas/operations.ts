/**
 * SLA GraphQL documents beside the code that sends them.
 */

import { ISSUE_FIELDS } from '~/gql/operations';

export const SLA_RULE_FIELDS = /* GraphQL */ `
  fragment SlaRuleFields on SlaRule {
    id
    workspaceId
    position
    filter
    action
    durationMinutes
    createdAt
    updatedAt
  }
`;

export const CREATE_SLA_RULE = /* GraphQL */ `
  ${SLA_RULE_FIELDS}
  mutation CreateSlaRule($input: CreateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {
    createSlaRule(input: $input, clientId: $clientId, opId: $opId) {
      version
      slaRule {
        ...SlaRuleFields
      }
    }
  }
`;

export const UPDATE_SLA_RULE = /* GraphQL */ `
  ${SLA_RULE_FIELDS}
  mutation UpdateSlaRule($input: UpdateSlaRuleInput!, $clientId: UUID!, $opId: UUID!) {
    updateSlaRule(input: $input, clientId: $clientId, opId: $opId) {
      version
      slaRule {
        ...SlaRuleFields
      }
    }
  }
`;

export const DELETE_SLA_RULE = /* GraphQL */ `
  mutation DeleteSlaRule($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteSlaRule(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const SET_ISSUE_SLA = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation SetIssueSla($input: SetIssueSlaInput!, $clientId: UUID!, $opId: UUID!) {
    setIssueSla(input: $input, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;

export const CLEAR_ISSUE_SLA = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation ClearIssueSla($issueId: UUID!, $clientId: UUID!, $opId: UUID!) {
    clearIssueSla(issueId: $issueId, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;
