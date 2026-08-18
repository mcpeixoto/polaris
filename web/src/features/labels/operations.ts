/**
 * The label operations, written here rather than in `~/gql/operations` because codegen
 * scans `src/**` and a feature's documents belong beside the code that sends them.
 *
 * The fragments mirror the fields the sync stream carries, exactly as the shared operations
 * do: a label fetched by mutation response and the same label arriving as a delta must land
 * in the store with identical shapes, or an optimistic row and the row that replaces it
 * differ in a field nobody thought to look at.
 *
 * The two application mutations are the ones worth reading the schema comment for.
 * `addIssueLabel` takes one label and `removeIssueLabel` takes one label — there is
 * deliberately no "set the labels on this issue", because a set written whole loses writes:
 * two people adding different labels a second apart both send the full new set and the
 * second silently overwrites the first. Every wrapper in `mutations.ts` is built to keep
 * that property, and nothing here should grow a variadic version of it.
 */

export const LABEL_FIELDS = /* GraphQL */ `
  fragment LabelFields on Label {
    id
    workspaceId
    teamId
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

export const ISSUE_LABEL_FIELDS = /* GraphQL */ `
  fragment IssueLabelFields on IssueLabel {
    id
    workspaceId
    issueId
    labelId
    teamId
    groupId
    createdBy
    createdAt
  }
`;

export const CREATE_LABEL = /* GraphQL */ `
  ${LABEL_FIELDS}
  mutation CreateLabel($input: CreateLabelInput!, $clientId: UUID, $opId: UUID) {
    createLabel(input: $input, clientId: $clientId, opId: $opId) {
      version
      label {
        ...LabelFields
      }
    }
  }
`;

export const UPDATE_LABEL = /* GraphQL */ `
  ${LABEL_FIELDS}
  mutation UpdateLabel($input: UpdateLabelInput!, $clientId: UUID, $opId: UUID) {
    updateLabel(input: $input, clientId: $clientId, opId: $opId) {
      version
      label {
        ...LabelFields
      }
    }
  }
`;

/**
 * Retiring a label. It takes no `opId`, and that is the schema's decision rather than an
 * omission: the server refuses while the label is still applied to anything, so there is no
 * queued-and-replayed case to be idempotent about — the call either succeeds now or tells
 * the user what to clear first.
 */
export const ARCHIVE_LABEL = /* GraphQL */ `
  mutation ArchiveLabel($id: UUID!, $archived: Boolean!) {
    archiveLabel(id: $id, archived: $archived) {
      version
      id
    }
  }
`;

export const ADD_ISSUE_LABEL = /* GraphQL */ `
  ${ISSUE_LABEL_FIELDS}
  mutation AddIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {
    addIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {
      version
      issueLabel {
        ...IssueLabelFields
      }
    }
  }
`;

/**
 * Unapplying one label. The response carries the id of the row that disappeared, which the
 * caller cannot know: it named an issue and a label, and the application between them is a
 * row with an id of its own.
 */
export const REMOVE_ISSUE_LABEL = /* GraphQL */ `
  mutation RemoveIssueLabel($issueId: UUID!, $labelId: UUID!, $clientId: UUID, $opId: UUID) {
    removeIssueLabel(issueId: $issueId, labelId: $labelId, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
