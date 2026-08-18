/**
 * The issue-template documents, written here rather than in `~/gql/operations` because
 * codegen scans `src/**` and a feature's documents belong beside the code that sends them.
 *
 * `IssueTemplateFields` mirrors the store's `IssueTemplate` field for field, exactly as the
 * label and issue fragments mirror theirs. That is not tidiness. A template arriving as a
 * mutation response and the same template arriving as a sync delta have to land in the store
 * with identical shapes, or the response quietly overwrites the row with a copy missing
 * whatever the fragment forgot to ask for — and the symptom is a prefilled assignee that
 * disappears the moment somebody renames the template. `gql/fragments.test.ts` turns that
 * sentence into a failing test, so a field added to `IssueTemplate` is a red build here
 * rather than a data-loss report months later.
 *
 * Two asymmetries in the schema are worth knowing before reading the mutations:
 *
 * **`title`, `body` and `properties` are optional going in and non-null coming out.** The
 * columns are `NOT NULL DEFAULT ''`, because a template that prefills nothing but a set of
 * properties — a team, an assignee, three labels — is a legitimate thing to want. So an
 * omitted title comes back as `""` rather than as null, and every reader on this side treats
 * an empty title as "the person filing the issue writes their own".
 *
 * **`UpdateIssueTemplateInput` carries no `teamId`.** A template's scope is fixed at
 * creation. Moving one between a team and the workspace changes who is offered it, and the
 * people who would lose it have to be told rather than have a COALESCE decide for them. The
 * editor says so at creation time instead of offering a control the server would refuse.
 *
 * None of the three mutations declares `clientId` or `opId`: the schema's template mutations
 * take neither. `engine.mutate` puts both into every request's variables all the same, and a
 * variable an operation does not declare is dropped during coercion — which is why
 * `ARCHIVE_LABEL` gets away with the same thing.
 */

export const ISSUE_TEMPLATE_FIELDS = /* GraphQL */ `
  fragment IssueTemplateFields on IssueTemplate {
    id
    workspaceId
    teamId
    name
    description
    title
    body
    properties
    position
    createdBy
    createdAt
    updatedAt
    archivedAt
  }
`;

export const CREATE_ISSUE_TEMPLATE = /* GraphQL */ `
  ${ISSUE_TEMPLATE_FIELDS}
  mutation CreateIssueTemplate($input: CreateIssueTemplateInput!) {
    createIssueTemplate(input: $input) {
      version
      template {
        ...IssueTemplateFields
      }
    }
  }
`;

export const UPDATE_ISSUE_TEMPLATE = /* GraphQL */ `
  ${ISSUE_TEMPLATE_FIELDS}
  mutation UpdateIssueTemplate($input: UpdateIssueTemplateInput!) {
    updateIssueTemplate(input: $input) {
      version
      template {
        ...IssueTemplateFields
      }
    }
  }
`;

/**
 * Retiring a template, and the end of its life on this client.
 *
 * The payload is a `DeletePayload` rather than the template, and that is the honest name for
 * what happens: the row survives in Postgres — `issue.template_id` points at it, and the
 * question that column exists to answer needs the template to still be there — but the change
 * the server emits is a *delete*, so every replica forgets it. There is deliberately no
 * un-archive mutation, and `issueTemplate(id:)` answers not-found for an archived one, so
 * nothing on this side can show it again afterwards. See the note in `archiveTemplate`.
 */
export const ARCHIVE_ISSUE_TEMPLATE = /* GraphQL */ `
  mutation ArchiveIssueTemplate($id: UUID!, $archived: Boolean!) {
    archiveIssueTemplate(id: $id, archived: $archived) {
      version
      id
    }
  }
`;
