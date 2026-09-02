/**
 * Team membership documents.
 *
 * They live here rather than in `gql/operations.ts` for the same reason
 * `features/team-lifecycle/operations.ts` does: nothing outside this feature asks who is on
 * a team, and the shared file is already the largest in the client.
 */

export const ADD_TEAM_MEMBER = /* GraphQL */ `
  mutation AddTeamMember($teamId: UUID!, $userId: UUID!, $role: TeamRole) {
    addTeamMember(teamId: $teamId, userId: $userId, role: $role) {
      version
      membership {
        id
        workspaceId
        teamId
        userId
        role
        createdAt
        updatedAt
      }
    }
  }
`;

export const REMOVE_TEAM_MEMBER = /* GraphQL */ `
  mutation RemoveTeamMember($teamId: UUID!, $userId: UUID!) {
    removeTeamMember(teamId: $teamId, userId: $userId) {
      version
      id
    }
  }
`;
