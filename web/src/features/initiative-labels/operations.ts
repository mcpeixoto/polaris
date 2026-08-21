export const INITIATIVE_LABEL_FIELDS = /* GraphQL */ `
  fragment InitiativeLabelFields on InitiativeLabel {
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

export const INITIATIVE_LABEL_LINK_FIELDS = /* GraphQL */ `
  fragment InitiativeLabelLinkFields on InitiativeLabelLink {
    id
    workspaceId
    initiativeId
    labelId
    groupId
    createdBy
    createdAt
  }
`;

export const CREATE_INITIATIVE_LABEL = /* GraphQL */ `
  ${INITIATIVE_LABEL_FIELDS}
  mutation CreateInitiativeLabel($input: CreateInitiativeLabelInput!) {
    createInitiativeLabel(input: $input) {
      version
      initiativeLabel {
        ...InitiativeLabelFields
      }
    }
  }
`;

export const UPDATE_INITIATIVE_LABEL = /* GraphQL */ `
  ${INITIATIVE_LABEL_FIELDS}
  mutation UpdateInitiativeLabel($input: UpdateInitiativeLabelInput!) {
    updateInitiativeLabel(input: $input) {
      version
      initiativeLabel {
        ...InitiativeLabelFields
      }
    }
  }
`;

export const ARCHIVE_INITIATIVE_LABEL = /* GraphQL */ `
  mutation ArchiveInitiativeLabel($id: UUID!, $archived: Boolean!) {
    archiveInitiativeLabel(id: $id, archived: $archived) {
      version
      id
    }
  }
`;

export const ADD_INITIATIVE_LABEL = /* GraphQL */ `
  ${INITIATIVE_LABEL_LINK_FIELDS}
  mutation AddInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {
    addInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {
      version
      initiativeLabelLink {
        ...InitiativeLabelLinkFields
      }
    }
  }
`;

export const REMOVE_INITIATIVE_LABEL = /* GraphQL */ `
  mutation RemoveInitiativeLabel($initiativeId: UUID!, $labelId: UUID!) {
    removeInitiativeLabel(initiativeId: $initiativeId, labelId: $labelId) {
      version
      id
    }
  }
`;
