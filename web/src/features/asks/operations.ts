/**
 * Ask form GraphQL documents beside the code that sends them.
 */

export const ASK_FORM_FIELDS = /* GraphQL */ `
  fragment AskFormFields on AskForm {
    id
    workspaceId
    teamId
    name
    description
    token
    creatorId
    archivedAt
    deletedAt
    createdAt
    updatedAt
  }
`;

export const CREATE_ASK_FORM = /* GraphQL */ `
  ${ASK_FORM_FIELDS}
  mutation CreateAskForm($input: CreateAskFormInput!, $clientId: UUID!, $opId: UUID!) {
    createAskForm(input: $input, clientId: $clientId, opId: $opId) {
      version
      askForm {
        ...AskFormFields
      }
    }
  }
`;

export const UPDATE_ASK_FORM = /* GraphQL */ `
  ${ASK_FORM_FIELDS}
  mutation UpdateAskForm($input: UpdateAskFormInput!, $clientId: UUID!, $opId: UUID!) {
    updateAskForm(input: $input, clientId: $clientId, opId: $opId) {
      version
      askForm {
        ...AskFormFields
      }
    }
  }
`;

export const ARCHIVE_ASK_FORM = /* GraphQL */ `
  mutation ArchiveAskForm($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {
    archiveAskForm(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const DELETE_ASK_FORM = /* GraphQL */ `
  mutation DeleteAskForm($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteAskForm(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
