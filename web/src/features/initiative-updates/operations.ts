/**
 * Initiative update GraphQL documents beside the code that sends them.
 */

export const INITIATIVE_UPDATE_FIELDS = /* GraphQL */ `
  fragment InitiativeUpdateFields on InitiativeUpdate {
    id
    workspaceId
    initiativeId
    health
    body
    authorId
    editedAt
    deletedAt
    createdAt
    updatedAt
  }
`;

export const CREATE_INITIATIVE_UPDATE = /* GraphQL */ `
  ${INITIATIVE_UPDATE_FIELDS}
  mutation CreateInitiativeUpdate(
    $input: CreateInitiativeUpdateInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {
      version
      initiativeUpdate {
        ...InitiativeUpdateFields
      }
    }
  }
`;

export const UPDATE_INITIATIVE_UPDATE = /* GraphQL */ `
  ${INITIATIVE_UPDATE_FIELDS}
  mutation UpdateInitiativeUpdate(
    $input: UpdateInitiativeUpdateInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    updateInitiativeUpdate(input: $input, clientId: $clientId, opId: $opId) {
      version
      initiativeUpdate {
        ...InitiativeUpdateFields
      }
    }
  }
`;

export const DELETE_INITIATIVE_UPDATE = /* GraphQL */ `
  mutation DeleteInitiativeUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteInitiativeUpdate(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
