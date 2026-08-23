export const PROJECT_LABEL_FIELDS = /* GraphQL */ `
  fragment ProjectLabelFields on ProjectLabel {
    id
    workspaceId
    parentId
    isGroup
    name
    description
    color
    position
    createdAt
    updatedAt
    archivedAt
  }
`;

export const PROJECT_LABEL_LINK_FIELDS = /* GraphQL */ `
  fragment ProjectLabelLinkFields on ProjectLabelLink {
    id
    workspaceId
    projectId
    labelId
    groupId
    createdBy
    createdAt
  }
`;

export const CREATE_PROJECT_LABEL = /* GraphQL */ `
  ${PROJECT_LABEL_FIELDS}
  mutation CreateProjectLabel($input: CreateProjectLabelInput!, $clientId: UUID!, $opId: UUID!) {
    createProjectLabel(input: $input, clientId: $clientId, opId: $opId) {
      version
      projectLabel {
        ...ProjectLabelFields
      }
    }
  }
`;

export const UPDATE_PROJECT_LABEL = /* GraphQL */ `
  ${PROJECT_LABEL_FIELDS}
  mutation UpdateProjectLabel($input: UpdateProjectLabelInput!) {
    updateProjectLabel(input: $input) {
      version
      projectLabel {
        ...ProjectLabelFields
      }
    }
  }
`;

export const ARCHIVE_PROJECT_LABEL = /* GraphQL */ `
  mutation ArchiveProjectLabel($id: UUID!, $archived: Boolean!) {
    archiveProjectLabel(id: $id, archived: $archived) {
      version
      id
    }
  }
`;

export const ADD_PROJECT_LABEL = /* GraphQL */ `
  ${PROJECT_LABEL_LINK_FIELDS}
  mutation AddProjectLabel($projectId: UUID!, $labelId: UUID!) {
    addProjectLabel(projectId: $projectId, labelId: $labelId) {
      version
      projectLabelLink {
        ...ProjectLabelLinkFields
      }
    }
  }
`;

export const REMOVE_PROJECT_LABEL = /* GraphQL */ `
  mutation RemoveProjectLabel($projectId: UUID!, $labelId: UUID!) {
    removeProjectLabel(projectId: $projectId, labelId: $labelId) {
      version
      id
    }
  }
`;
