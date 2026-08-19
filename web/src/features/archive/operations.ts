/**
 * Archives documents: on-demand listings the replica does not hold, and the restore
 * mutations that bring a row back.
 *
 * Archived work is emitted as a delete on the sync stream, the same way trash is. The
 * archives page therefore asks the server, keeps the answer in component state, and never
 * writes it into IndexedDB — which is why this screen has a loading state and why restore
 * has no optimistic patch.
 */

import { CYCLE_FIELDS, ISSUE_FIELDS, UPDATE_TEAM_ARCHIVE } from '~/gql/operations';
import { PROJECT_FIELDS } from '~/features/projects/operations';

export { UPDATE_TEAM_ARCHIVE };

export const ARCHIVED_ISSUES_QUERY = /* GraphQL */ `
  ${ISSUE_FIELDS}
  query ArchivedIssues($teamId: UUID!) {
    archivedIssues(teamId: $teamId) {
      ...IssueFields
    }
  }
`;

export const ARCHIVED_CYCLES_QUERY = /* GraphQL */ `
  ${CYCLE_FIELDS}
  query ArchivedCycles($teamId: UUID!) {
    archivedCycles(teamId: $teamId) {
      ...CycleFields
    }
  }
`;

export const ARCHIVED_PROJECTS_QUERY = /* GraphQL */ `
  ${PROJECT_FIELDS}
  query ArchivedProjects($teamId: UUID!) {
    archivedProjects(teamId: $teamId) {
      ...ProjectFields
    }
  }
`;

export const ARCHIVE_CYCLE = /* GraphQL */ `
  mutation ArchiveCycle($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {
    archiveCycle(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const ARCHIVE_PROJECT = /* GraphQL */ `
  mutation ArchiveProject($id: UUID!, $archived: Boolean!, $clientId: UUID!, $opId: UUID!) {
    archiveProject(id: $id, archived: $archived, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
