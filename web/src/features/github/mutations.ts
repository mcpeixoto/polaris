/**
 * GitHub writes. Connection settings and the personal login are replicated, so the
 * settings screen reads them from the store; these mutations are the write path.
 */

import { apiUrl, credentialsMode } from '~/sync/endpoint';
import { ApiError, authHeaders, ensureFreshToken, gql } from '~/sync/api';

export const GITHUB_CONNECTION_FIELDS = /* GraphQL */ `
  fragment GitHubConnectionFields on GitHubConnection {
    id
    workspaceId
    creatorId
    enabled
    orgLogin
    branchNameFormat
    linkCommits
    linkbacks
    connectedAt
    createdAt
    updatedAt
  }
`;

export const GITHUB_USER_LINK_FIELDS = /* GraphQL */ `
  fragment GitHubUserLinkFields on GitHubUserLink {
    id
    workspaceId
    userId
    githubLogin
    createdAt
    updatedAt
  }
`;

export const GITHUB_SETTINGS_QUERY = /* GraphQL */ `
  query GitHubSettings {
    githubOAuthConfigured
    githubCommitWebhook {
      url
      secret
    }
  }
`;

export const CREATE_GITHUB_CONNECTION = /* GraphQL */ `
  ${GITHUB_CONNECTION_FIELDS}
  mutation CreateGitHubConnection($input: CreateGitHubConnectionInput!) {
    createGitHubConnection(input: $input) {
      version
      githubConnection {
        ...GitHubConnectionFields
      }
    }
  }
`;

export const UPDATE_GITHUB_CONNECTION = /* GraphQL */ `
  ${GITHUB_CONNECTION_FIELDS}
  mutation UpdateGitHubConnection($input: UpdateGitHubConnectionInput!) {
    updateGitHubConnection(input: $input) {
      version
      githubConnection {
        ...GitHubConnectionFields
      }
    }
  }
`;

export const DELETE_GITHUB_CONNECTION = /* GraphQL */ `
  mutation DeleteGitHubConnection {
    deleteGitHubConnection {
      version
      id
    }
  }
`;

export const CREATE_GITHUB_USER_LINK = /* GraphQL */ `
  ${GITHUB_USER_LINK_FIELDS}
  mutation CreateGitHubUserLink($input: CreateGitHubUserLinkInput!) {
    createGitHubUserLink(input: $input) {
      version
      githubUserLink {
        ...GitHubUserLinkFields
      }
    }
  }
`;

export const DELETE_GITHUB_USER_LINK = /* GraphQL */ `
  mutation DeleteGitHubUserLink {
    deleteGitHubUserLink {
      version
      id
    }
  }
`;

export interface GitHubSettingsQuery {
  readonly githubOAuthConfigured: boolean;
  readonly githubCommitWebhook: { readonly url: string; readonly secret: string } | null;
}

export async function loadGitHubSettings(): Promise<GitHubSettingsQuery> {
  return gql<GitHubSettingsQuery>(GITHUB_SETTINGS_QUERY);
}

export async function enableGitHubConnection(input: {
  orgLogin?: string;
  branchNameFormat?: string;
  linkCommits?: boolean;
  linkbacks?: boolean;
}): Promise<void> {
  await gql(CREATE_GITHUB_CONNECTION, { input });
}

export async function updateGitHubConnection(input: {
  orgLogin?: string;
  branchNameFormat?: string;
  linkCommits?: boolean;
  linkbacks?: boolean;
  enabled?: boolean;
}): Promise<void> {
  await gql(UPDATE_GITHUB_CONNECTION, { input });
}

export async function disconnectGitHub(): Promise<void> {
  await gql(DELETE_GITHUB_CONNECTION);
}

export async function linkGitHubLogin(githubLogin: string): Promise<void> {
  await gql(CREATE_GITHUB_USER_LINK, { input: { githubLogin } });
}

export async function unlinkGitHubLogin(): Promise<void> {
  await gql(DELETE_GITHUB_USER_LINK);
}

export async function startGitHubOAuth(): Promise<void> {
  await ensureFreshToken();
  let res: Response;
  try {
    res = await fetch(apiUrl('/auth/github/start'), {
      method: 'GET',
      headers: authHeaders(),
      credentials: credentialsMode(),
    });
  } catch (err) {
    throw new ApiError('NETWORK', err instanceof Error ? err.message : 'network unavailable');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new ApiError('VALIDATION', body?.error?.message ?? 'GitHub OAuth is not configured');
  }
  const data = (await res.json()) as { url?: string };
  if (data.url === undefined || data.url === '') {
    throw new ApiError('INTERNAL', 'GitHub OAuth did not return a URL');
  }
  window.location.assign(data.url);
}
