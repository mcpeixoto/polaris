/**
 * Initiative GraphQL documents beside the code that sends them.
 */

export const INITIATIVE_FIELDS = /* GraphQL */ `
  fragment InitiativeFields on Initiative {
    id
    workspaceId
    name
    description
    status
    priority
    ownerId
    leadTeamId
    sortOrder
    targetDate
    targetDateGranularity
    creatorId
    archivedAt
    deletedAt
    deletedBy
    createdAt
    updatedAt
  }
`;

export const INITIATIVE_PROJECT_FIELDS = /* GraphQL */ `
  fragment InitiativeProjectFields on InitiativeProject {
    id
    workspaceId
    initiativeId
    projectId
    createdAt
  }
`;

export const CREATE_INITIATIVE = /* GraphQL */ `
  ${INITIATIVE_FIELDS}
  mutation CreateInitiative($input: CreateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {
    createInitiative(input: $input, clientId: $clientId, opId: $opId) {
      version
      initiative {
        ...InitiativeFields
      }
    }
  }
`;

export const UPDATE_INITIATIVE = /* GraphQL */ `
  ${INITIATIVE_FIELDS}
  mutation UpdateInitiative($input: UpdateInitiativeInput!, $clientId: UUID!, $opId: UUID!) {
    updateInitiative(input: $input, clientId: $clientId, opId: $opId) {
      version
      initiative {
        ...InitiativeFields
      }
    }
  }
`;

export const ADD_INITIATIVE_PROJECT = /* GraphQL */ `
  ${INITIATIVE_PROJECT_FIELDS}
  mutation AddInitiativeProject(
    $initiativeId: UUID!
    $projectId: UUID!
    $clientId: UUID!
    $opId: UUID!
  ) {
    addInitiativeProject(
      initiativeId: $initiativeId
      projectId: $projectId
      clientId: $clientId
      opId: $opId
    ) {
      version
      initiativeProject {
        ...InitiativeProjectFields
      }
    }
  }
`;

export const REMOVE_INITIATIVE_PROJECT = /* GraphQL */ `
  mutation RemoveInitiativeProject(
    $initiativeId: UUID!
    $projectId: UUID!
    $clientId: UUID!
    $opId: UUID!
  ) {
    removeInitiativeProject(
      initiativeId: $initiativeId
      projectId: $projectId
      clientId: $clientId
      opId: $opId
    ) {
      version
      id
    }
  }
`;

export const ARCHIVE_INITIATIVE = /* GraphQL */ `
  mutation ArchiveInitiative($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {
    archiveInitiative(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
