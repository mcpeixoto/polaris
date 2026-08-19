/**
 * Project update GraphQL documents beside the code that sends them.
 */

export const PROJECT_UPDATE_FIELDS = /* GraphQL */ `
  fragment ProjectUpdateFields on ProjectUpdate {
    id
    workspaceId
    projectId
    health
    body
    authorId
    editedAt
    deletedAt
    createdAt
    updatedAt
  }
`;

export const CREATE_PROJECT_UPDATE = /* GraphQL */ `
  ${PROJECT_UPDATE_FIELDS}
  mutation CreateProjectUpdate($input: CreateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {
    createProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {
      version
      projectUpdate {
        ...ProjectUpdateFields
      }
    }
  }
`;

export const UPDATE_PROJECT_UPDATE = /* GraphQL */ `
  ${PROJECT_UPDATE_FIELDS}
  mutation UpdateProjectUpdate($input: UpdateProjectUpdateInput!, $clientId: UUID!, $opId: UUID!) {
    updateProjectUpdate(input: $input, clientId: $clientId, opId: $opId) {
      version
      projectUpdate {
        ...ProjectUpdateFields
      }
    }
  }
`;

export const DELETE_PROJECT_UPDATE = /* GraphQL */ `
  mutation DeleteProjectUpdate($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteProjectUpdate(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
