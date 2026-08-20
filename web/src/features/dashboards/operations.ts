/**
 * Dashboard GraphQL documents beside the code that sends them.
 */

export const DASHBOARD_FIELDS = /* GraphQL */ `
  fragment DashboardFields on Dashboard {
    id
    workspaceId
    teamId
    ownerId
    name
    description
    filter
    creatorId
    sortOrder
    archivedAt
    deletedAt
    deletedBy
    createdAt
    updatedAt
  }
`;

export const DASHBOARD_TILE_FIELDS = /* GraphQL */ `
  fragment DashboardTileFields on DashboardTile {
    id
    workspaceId
    dashboardId
    title
    measure
    slice
    display
    filter
    sortOrder
    createdAt
    updatedAt
  }
`;

export const CREATE_DASHBOARD = /* GraphQL */ `
  ${DASHBOARD_FIELDS}
  mutation CreateDashboard($input: CreateDashboardInput!, $clientId: UUID!, $opId: UUID!) {
    createDashboard(input: $input, clientId: $clientId, opId: $opId) {
      version
      dashboard {
        ...DashboardFields
      }
    }
  }
`;

export const UPDATE_DASHBOARD = /* GraphQL */ `
  ${DASHBOARD_FIELDS}
  mutation UpdateDashboard($input: UpdateDashboardInput!, $clientId: UUID!, $opId: UUID!) {
    updateDashboard(input: $input, clientId: $clientId, opId: $opId) {
      version
      dashboard {
        ...DashboardFields
      }
    }
  }
`;

export const DELETE_DASHBOARD = /* GraphQL */ `
  mutation DeleteDashboard($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteDashboard(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;

export const CREATE_DASHBOARD_TILE = /* GraphQL */ `
  ${DASHBOARD_TILE_FIELDS}
  mutation CreateDashboardTile($input: CreateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {
    createDashboardTile(input: $input, clientId: $clientId, opId: $opId) {
      version
      dashboardTile {
        ...DashboardTileFields
      }
    }
  }
`;

export const UPDATE_DASHBOARD_TILE = /* GraphQL */ `
  ${DASHBOARD_TILE_FIELDS}
  mutation UpdateDashboardTile($input: UpdateDashboardTileInput!, $clientId: UUID!, $opId: UUID!) {
    updateDashboardTile(input: $input, clientId: $clientId, opId: $opId) {
      version
      dashboardTile {
        ...DashboardTileFields
      }
    }
  }
`;

export const DELETE_DASHBOARD_TILE = /* GraphQL */ `
  mutation DeleteDashboardTile($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deleteDashboardTile(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
