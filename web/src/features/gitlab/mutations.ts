/**
 * GitLab writes. Connection settings and the personal login are replicated, so the
 * settings screen reads them from the store; these mutations are the write path.
 */

import { gql } from '~/sync/api';

export const GITLAB_CONNECTION_FIELDS = /* GraphQL */ `
  fragment GitLabConnectionFields on GitLabConnection {
    id
    workspaceId
    creatorId
    enabled
    instanceUrl
    branchNameFormat
    linkCommits
    linkbacks
    connectedAt
    createdAt
    updatedAt
  }
`;

export const GITLAB_USER_LINK_FIELDS = /* GraphQL */ `
  fragment GitLabUserLinkFields on GitLabUserLink {
    id
    workspaceId
    userId
    gitlabUsername
    createdAt
    updatedAt
  }
`;

export const GITLAB_SETTINGS_QUERY = /* GraphQL */ `
  query GitLabSettings {
    gitlabWebhook {
      url
      secret
    }
  }
`;

export const CREATE_GITLAB_CONNECTION = /* GraphQL */ `
  ${GITLAB_CONNECTION_FIELDS}
  mutation CreateGitLabConnection($input: CreateGitLabConnectionInput!) {
    createGitLabConnection(input: $input) {
      version
      gitlabConnection {
        ...GitLabConnectionFields
      }
    }
  }
`;

export const UPDATE_GITLAB_CONNECTION = /* GraphQL */ `
  ${GITLAB_CONNECTION_FIELDS}
  mutation UpdateGitLabConnection($input: UpdateGitLabConnectionInput!) {
    updateGitLabConnection(input: $input) {
      version
      gitlabConnection {
        ...GitLabConnectionFields
      }
    }
  }
`;

export const DELETE_GITLAB_CONNECTION = /* GraphQL */ `
  mutation DeleteGitLabConnection {
    deleteGitLabConnection {
      version
      id
    }
  }
`;

export const CREATE_GITLAB_USER_LINK = /* GraphQL */ `
  ${GITLAB_USER_LINK_FIELDS}
  mutation CreateGitLabUserLink($input: CreateGitLabUserLinkInput!) {
    createGitLabUserLink(input: $input) {
      version
      gitlabUserLink {
        ...GitLabUserLinkFields
      }
    }
  }
`;

export const DELETE_GITLAB_USER_LINK = /* GraphQL */ `
  mutation DeleteGitLabUserLink {
    deleteGitLabUserLink {
      version
      id
    }
  }
`;

export interface GitLabSettingsQuery {
  readonly gitlabWebhook: { readonly url: string; readonly secret: string } | null;
}

export async function loadGitLabSettings(): Promise<GitLabSettingsQuery> {
  return gql<GitLabSettingsQuery>(GITLAB_SETTINGS_QUERY);
}

export async function enableGitLabConnection(input: {
  instanceUrl?: string;
  accessToken?: string;
  branchNameFormat?: string;
  linkCommits?: boolean;
  linkbacks?: boolean;
}): Promise<void> {
  await gql(CREATE_GITLAB_CONNECTION, { input });
}

export async function updateGitLabConnection(input: {
  instanceUrl?: string;
  accessToken?: string;
  branchNameFormat?: string;
  linkCommits?: boolean;
  linkbacks?: boolean;
  enabled?: boolean;
}): Promise<void> {
  await gql(UPDATE_GITLAB_CONNECTION, { input });
}

export async function disconnectGitLab(): Promise<void> {
  await gql(DELETE_GITLAB_CONNECTION);
}

export async function linkGitLabUsername(gitlabUsername: string): Promise<void> {
  await gql(CREATE_GITLAB_USER_LINK, { input: { gitlabUsername } });
}

export async function unlinkGitLabUsername(): Promise<void> {
  await gql(DELETE_GITLAB_USER_LINK);
}

export const GITLAB_TEAM_AUTOMATION_FIELDS = /* GraphQL */ `
  fragment GitLabTeamAutomationFields on GitLabTeamAutomation {
    teamId
    configured
    draftedStateId
    openedStateId
    reviewRequestedStateId
    readyForMergeStateId
    mergedStateId
  }
`;

export const GITLAB_TEAM_AUTOMATION_QUERY = /* GraphQL */ `
  ${GITLAB_TEAM_AUTOMATION_FIELDS}
  query GitLabTeamAutomation($teamId: UUID!) {
    gitlabTeamAutomation(teamId: $teamId) {
      ...GitLabTeamAutomationFields
    }
  }
`;

export const UPDATE_GITLAB_TEAM_AUTOMATION = /* GraphQL */ `
  ${GITLAB_TEAM_AUTOMATION_FIELDS}
  mutation UpdateGitLabTeamAutomation($input: UpdateGitLabTeamAutomationInput!) {
    updateGitLabTeamAutomation(input: $input) {
      gitlabTeamAutomation {
        ...GitLabTeamAutomationFields
      }
    }
  }
`;

export const DELETE_GITLAB_TEAM_AUTOMATION = /* GraphQL */ `
  ${GITLAB_TEAM_AUTOMATION_FIELDS}
  mutation DeleteGitLabTeamAutomation($teamId: UUID!) {
    deleteGitLabTeamAutomation(teamId: $teamId) {
      gitlabTeamAutomation {
        ...GitLabTeamAutomationFields
      }
    }
  }
`;

export interface GitLabTeamAutomation {
  readonly teamId: string;
  readonly configured: boolean;
  readonly draftedStateId: string | null;
  readonly openedStateId: string | null;
  readonly reviewRequestedStateId: string | null;
  readonly readyForMergeStateId: string | null;
  readonly mergedStateId: string | null;
}

export async function loadGitLabTeamAutomation(teamId: string): Promise<GitLabTeamAutomation> {
  const data = await gql<{ gitlabTeamAutomation: GitLabTeamAutomation }>(
    GITLAB_TEAM_AUTOMATION_QUERY,
    { teamId },
  );
  return data.gitlabTeamAutomation;
}

export async function updateGitLabTeamAutomation(
  teamId: string,
  mapping: {
    draftedStateId: string | null;
    openedStateId: string | null;
    reviewRequestedStateId: string | null;
    readyForMergeStateId: string | null;
    mergedStateId: string | null;
  },
): Promise<GitLabTeamAutomation> {
  const data = await gql<{
    updateGitLabTeamAutomation: { gitlabTeamAutomation: GitLabTeamAutomation };
  }>(UPDATE_GITLAB_TEAM_AUTOMATION, { input: { teamId, ...mapping } });
  return data.updateGitLabTeamAutomation.gitlabTeamAutomation;
}

export async function deleteGitLabTeamAutomation(teamId: string): Promise<GitLabTeamAutomation> {
  const data = await gql<{
    deleteGitLabTeamAutomation: { gitlabTeamAutomation: GitLabTeamAutomation };
  }>(DELETE_GITLAB_TEAM_AUTOMATION, { teamId });
  return data.deleteGitLabTeamAutomation.gitlabTeamAutomation;
}
