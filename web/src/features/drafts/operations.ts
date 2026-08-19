/**
 * Saved-draft documents. Not replicated — same reason as webhooks and API keys — so these
 * queries are the only read path for drafts that survive logout.
 */

export const DRAFT_FIELDS = /* GraphQL */ `
  fragment DraftFields on Draft {
    id
    workspaceId
    userId
    kind
    payload
    createdAt
    updatedAt
  }
`;

export const DRAFTS_QUERY = /* GraphQL */ `
  ${DRAFT_FIELDS}
  query Drafts {
    drafts {
      ...DraftFields
    }
  }
`;

export const CREATE_DRAFT = /* GraphQL */ `
  ${DRAFT_FIELDS}
  mutation CreateDraft($input: CreateDraftInput!) {
    createDraft(input: $input) {
      version
      draft {
        ...DraftFields
      }
    }
  }
`;

export const UPDATE_DRAFT = /* GraphQL */ `
  ${DRAFT_FIELDS}
  mutation UpdateDraft($input: UpdateDraftInput!) {
    updateDraft(input: $input) {
      version
      draft {
        ...DraftFields
      }
    }
  }
`;

export const DELETE_DRAFT = /* GraphQL */ `
  mutation DeleteDraft($id: UUID!) {
    deleteDraft(id: $id) {
      version
      id
    }
  }
`;
