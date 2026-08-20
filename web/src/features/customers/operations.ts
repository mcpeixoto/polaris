/**
 * Customer GraphQL documents beside the code that sends them.
 */

export const CUSTOMER_FIELDS = /* GraphQL */ `
  fragment CustomerFields on Customer {
    id
    workspaceId
    name
    domains
    revenue
    size
    tier
    status
    ownerId
    logoUrl
    creatorId
    sortOrder
    archivedAt
    deletedAt
    deletedBy
    createdAt
    updatedAt
  }
`;

export const CUSTOMER_REQUEST_FIELDS = /* GraphQL */ `
  fragment CustomerRequestFields on CustomerRequest {
    id
    workspaceId
    customerId
    issueId
    projectId
    body
    important
    creatorId
    createdAt
    updatedAt
  }
`;

export const CREATE_CUSTOMER = /* GraphQL */ `
  ${CUSTOMER_FIELDS}
  mutation CreateCustomer($input: CreateCustomerInput!, $clientId: UUID!, $opId: UUID!) {
    createCustomer(input: $input, clientId: $clientId, opId: $opId) {
      version
      customer {
        ...CustomerFields
      }
    }
  }
`;

export const UPDATE_CUSTOMER = /* GraphQL */ `
  ${CUSTOMER_FIELDS}
  mutation UpdateCustomer($input: UpdateCustomerInput!, $clientId: UUID!, $opId: UUID!) {
    updateCustomer(input: $input, clientId: $clientId, opId: $opId) {
      version
      customer {
        ...CustomerFields
      }
    }
  }
`;

export const CREATE_CUSTOMER_REQUEST = /* GraphQL */ `
  ${CUSTOMER_REQUEST_FIELDS}
  mutation CreateCustomerRequest(
    $input: CreateCustomerRequestInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {
      version
      customerRequest {
        ...CustomerRequestFields
      }
    }
  }
`;

export const UPDATE_CUSTOMER_REQUEST = /* GraphQL */ `
  ${CUSTOMER_REQUEST_FIELDS}
  mutation UpdateCustomerRequest(
    $input: UpdateCustomerRequestInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    updateCustomerRequest(input: $input, clientId: $clientId, opId: $opId) {
      version
      customerRequest {
        ...CustomerRequestFields
      }
    }
  }
`;

export const DELETE_CUSTOMER_REQUEST = /* GraphQL */ `
  mutation DeleteCustomerRequest($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteCustomerRequest(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
