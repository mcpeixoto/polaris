export const WORKSPACE_FIELDS = /* GraphQL */ `
  fragment WorkspaceFields on Workspace {
    id
    name
    urlKey
    logoUrl
    plan
    planExpiresAt
    planLapsedAt
    seatLimit
    projectUpdateReminderIntervalDays
    projectUpdateReminderWeekday
    projectUpdateReminderHour
    pulseEnabled
    pulseDigestCadence
    customerRequestsEnabled
    customerDefaultTeamId
    customerRevenueUnit
    customerTiers
    createdAt
    updatedAt
    archivedAt
  }
`;

export const UPDATE_WORKSPACE = /* GraphQL */ `
  ${WORKSPACE_FIELDS}
  mutation UpdateWorkspace($input: UpdateWorkspaceInput!) {
    updateWorkspace(input: $input) {
      version
      workspace {
        ...WorkspaceFields
      }
    }
  }
`;
