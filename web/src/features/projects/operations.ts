/**
 * Project operations. Beside the code that sends them, like the label documents: codegen
 * scans `src/**` and a feature's mutations belong with the feature.
 *
 * Fragments mirror the fields the sync stream carries, so a project fetched by mutation
 * response and the same project arriving as a delta land in the store with identical shapes.
 */

export const PROJECT_STATUS_FIELDS = /* GraphQL */ `
  fragment ProjectStatusFields on ProjectStatus {
    id
    workspaceId
    name
    description
    color
    category
    position
    isDefault
    createdAt
    updatedAt
    archivedAt
  }
`;

export const PROJECT_FIELDS = /* GraphQL */ `
  fragment ProjectFields on Project {
    id
    workspaceId
    name
    summary
    description
    icon
    color
    statusId
    priority
    leadId
    creatorId
    sortOrder
    startDate
    startDateGranularity
    targetDate
    targetDateGranularity
    archivedAt
    deletedAt
    deletedBy
    createdAt
    updatedAt
  }
`;

export const PROJECT_TEAM_FIELDS = /* GraphQL */ `
  fragment ProjectTeamFields on ProjectTeam {
    id
    workspaceId
    projectId
    teamId
    createdAt
  }
`;

export const PROJECT_MEMBER_FIELDS = /* GraphQL */ `
  fragment ProjectMemberFields on ProjectMember {
    id
    workspaceId
    projectId
    userId
    createdAt
  }
`;

export const PROJECT_MILESTONE_FIELDS = /* GraphQL */ `
  fragment ProjectMilestoneFields on ProjectMilestone {
    id
    workspaceId
    projectId
    name
    description
    targetDate
    sortOrder
    createdAt
    updatedAt
    archivedAt
  }
`;

export const CREATE_PROJECT = /* GraphQL */ `
  ${PROJECT_FIELDS}
  mutation CreateProject($input: CreateProjectInput!, $clientId: UUID, $opId: UUID) {
    createProject(input: $input, clientId: $clientId, opId: $opId) {
      version
      project {
        ...ProjectFields
      }
    }
  }
`;

export const UPDATE_PROJECT = /* GraphQL */ `
  ${PROJECT_FIELDS}
  mutation UpdateProject($input: UpdateProjectInput!, $clientId: UUID, $opId: UUID) {
    updateProject(input: $input, clientId: $clientId, opId: $opId) {
      version
      project {
        ...ProjectFields
      }
    }
  }
`;

export const DELETE_PROJECT = /* GraphQL */ `
  mutation DeleteProject($id: UUID!, $clientId: UUID, $opId: UUID) {
    deleteProject(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const ADD_PROJECT_TEAM = /* GraphQL */ `
  ${PROJECT_TEAM_FIELDS}
  mutation AddProjectTeam($projectId: UUID!, $teamId: UUID!, $clientId: UUID, $opId: UUID) {
    addProjectTeam(projectId: $projectId, teamId: $teamId, clientId: $clientId, opId: $opId) {
      version
      projectTeam {
        ...ProjectTeamFields
      }
    }
  }
`;

export const ADD_PROJECT_MEMBER = /* GraphQL */ `
  ${PROJECT_MEMBER_FIELDS}
  mutation AddProjectMember($projectId: UUID!, $userId: UUID!, $clientId: UUID, $opId: UUID) {
    addProjectMember(projectId: $projectId, userId: $userId, clientId: $clientId, opId: $opId) {
      version
      projectMember {
        ...ProjectMemberFields
      }
    }
  }
`;
