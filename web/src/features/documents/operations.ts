/**
 * Document GraphQL documents beside the code that sends them.
 */

export const DOCUMENT_FIELDS = /* GraphQL */ `
  fragment DocumentFields on Document {
    id
    workspaceId
    teamId
    projectId
    title
    body
    sortOrder
    creatorId
    updatedBy
    createdAt
    updatedAt
    archivedAt
    deletedAt
  }
`;

export const CREATE_DOCUMENT = /* GraphQL */ `
  ${DOCUMENT_FIELDS}
  mutation CreateDocument($input: CreateDocumentInput!, $clientId: UUID!, $opId: UUID!) {
    createDocument(input: $input, clientId: $clientId, opId: $opId) {
      version
      document {
        ...DocumentFields
      }
    }
  }
`;

export const UPDATE_DOCUMENT = /* GraphQL */ `
  ${DOCUMENT_FIELDS}
  mutation UpdateDocument($input: UpdateDocumentInput!, $clientId: UUID!, $opId: UUID!) {
    updateDocument(input: $input, clientId: $clientId, opId: $opId) {
      version
      document {
        ...DocumentFields
      }
    }
  }
`;

export const ARCHIVE_DOCUMENT = /* GraphQL */ `
  mutation ArchiveDocument($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {
    archiveDocument(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const DELETE_DOCUMENT = /* GraphQL */ `
  mutation DeleteDocument($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteDocument(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
