/**
 * The documents for project, initiative and customer bell subscriptions.
 *
 * Written here rather than in `~/gql/operations` because codegen scans `src/**` and a
 * feature's documents belong beside the code that sends them. Fragments select exactly the
 * fields the store's interfaces hold.
 */

export const PROJECT_SUBSCRIPTION_FIELDS = /* GraphQL */ `
  fragment ProjectSubscriptionFields on ProjectSubscription {
    id
    workspaceId
    projectId
    userId
    issuesAdded
    issuesCompleted
    updates
    createdAt
    updatedAt
  }
`;

export const SET_PROJECT_SUBSCRIPTION = /* GraphQL */ `
  ${PROJECT_SUBSCRIPTION_FIELDS}
  mutation SetProjectSubscription($input: SetProjectSubscriptionInput!) {
    setProjectSubscription(input: $input) {
      version
      projectSubscription {
        ...ProjectSubscriptionFields
      }
    }
  }
`;

export const DELETE_PROJECT_SUBSCRIPTION = /* GraphQL */ `
  mutation DeleteProjectSubscription($projectId: UUID!) {
    deleteProjectSubscription(projectId: $projectId) {
      version
      id
    }
  }
`;

export const INITIATIVE_SUBSCRIPTION_FIELDS = /* GraphQL */ `
  fragment InitiativeSubscriptionFields on InitiativeSubscription {
    id
    workspaceId
    initiativeId
    userId
    issuesAdded
    issuesCompleted
    updates
    createdAt
    updatedAt
  }
`;

export const SET_INITIATIVE_SUBSCRIPTION = /* GraphQL */ `
  ${INITIATIVE_SUBSCRIPTION_FIELDS}
  mutation SetInitiativeSubscription($input: SetInitiativeSubscriptionInput!) {
    setInitiativeSubscription(input: $input) {
      version
      initiativeSubscription {
        ...InitiativeSubscriptionFields
      }
    }
  }
`;

export const DELETE_INITIATIVE_SUBSCRIPTION = /* GraphQL */ `
  mutation DeleteInitiativeSubscription($initiativeId: UUID!) {
    deleteInitiativeSubscription(initiativeId: $initiativeId) {
      version
      id
    }
  }
`;

export const CUSTOMER_SUBSCRIPTION_FIELDS = /* GraphQL */ `
  fragment CustomerSubscriptionFields on CustomerSubscription {
    id
    workspaceId
    customerId
    userId
    requestAdded
    requestImportant
    requestCompleted
    createdAt
    updatedAt
  }
`;

export const SET_CUSTOMER_SUBSCRIPTION = /* GraphQL */ `
  ${CUSTOMER_SUBSCRIPTION_FIELDS}
  mutation SetCustomerSubscription($input: SetCustomerSubscriptionInput!) {
    setCustomerSubscription(input: $input) {
      version
      customerSubscription {
        ...CustomerSubscriptionFields
      }
    }
  }
`;

export const DELETE_CUSTOMER_SUBSCRIPTION = /* GraphQL */ `
  mutation DeleteCustomerSubscription($customerId: UUID!) {
    deleteCustomerSubscription(customerId: $customerId) {
      version
      id
    }
  }
`;
