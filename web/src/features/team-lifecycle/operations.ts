/**
 * Team retire, delete, and restore — the operations the settings screens call.
 *
 * Deleted teams are like deleted issues: the replica drops them on a delete op, so the
 * recently-deleted list is a plain network read. Restore waits for the delta rather than
 * optimistically writing a team back, for the same reason restoreIssue does.
 */

import { TEAM_FIELDS } from '~/gql/operations';

export const DELETED_TEAMS_QUERY = /* GraphQL */ `
  ${TEAM_FIELDS}
  query DeletedTeams {
    deletedTeams {
      ...TeamFields
      deletedAt
    }
  }
`;

export const RETIRE_TEAM = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation RetireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    retireTeam(id: $id, clientId: $clientId, opId: $opId) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const UNRETIRE_TEAM = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation UnretireTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    unretireTeam(id: $id, clientId: $clientId, opId: $opId) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const DELETE_TEAM = /* GraphQL */ `
  mutation DeleteTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteTeam(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const RESTORE_TEAM = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation RestoreTeam($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    restoreTeam(id: $id, clientId: $clientId, opId: $opId) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;

export const MOVE_TEAM = /* GraphQL */ `
  ${TEAM_FIELDS}
  mutation MoveTeam($teamId: UUID!, $parentTeamId: UUID, $clientId: UUID!, $opId: UUID!) {
    moveTeam(teamId: $teamId, parentTeamId: $parentTeamId, clientId: $clientId, opId: $opId) {
      version
      team {
        ...TeamFields
      }
    }
  }
`;
