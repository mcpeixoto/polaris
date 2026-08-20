/**
 * OAuth application writes. Plain `gql`, not `engine.mutate`: there is no replica entity,
 * and the client secret exists in the create/rotate response once.
 */

import type { UUID } from '~/store';
import { gql } from '~/sync/api';
import {
  CREATE_OAUTH_AUTHORIZATION,
  CREATE_OAUTH_CLIENT,
  DELETE_OAUTH_CLIENT,
  OAUTH_CLIENT_INFO_QUERY,
  ROTATE_OAUTH_SECRET,
  UPDATE_OAUTH_CLIENT,
} from './operations';

export type OauthScope =
  | 'read'
  | 'write'
  | 'issues:create'
  | 'comments:create'
  | 'timeSchedule:write'
  | 'admin'
  | 'app:assignable'
  | 'app:mentionable'
  | 'customer:read'
  | 'customer:write'
  | 'initiative:read'
  | 'initiative:write';

export interface OauthScopeOption {
  readonly value: OauthScope;
  readonly label: string;
  readonly detail: string;
}

export const OAUTH_SCOPES: readonly OauthScopeOption[] = [
  {
    value: 'read',
    label: 'Read',
    detail: 'Always present. Every read the token’s actor can make.',
  },
  { value: 'write', label: 'Write', detail: 'Create and update as the actor. Implies read.' },
  { value: 'issues:create', label: 'Create issues', detail: 'Mint issues without full write.' },
  {
    value: 'comments:create',
    label: 'Create comments',
    detail: 'Mint comments without full write.',
  },
  {
    value: 'timeSchedule:write',
    label: 'Time schedules',
    detail: 'Create and modify on-call time schedules.',
  },
  {
    value: 'admin',
    label: 'Admin',
    detail: 'Full workspace admin. Never request this unless needed.',
  },
  {
    value: 'app:assignable',
    label: 'App assignable',
    detail: 'The app user can be a delegate on issues.',
  },
  { value: 'app:mentionable', label: 'App mentionable', detail: 'The app user can be @mentioned.' },
  { value: 'customer:read', label: 'Customer read', detail: 'Read customer records.' },
  { value: 'customer:write', label: 'Customer write', detail: 'Create and update customers.' },
  { value: 'initiative:read', label: 'Initiative read', detail: 'Read initiatives.' },
  {
    value: 'initiative:write',
    label: 'Initiative write',
    detail: 'Create and update initiatives.',
  },
];

export interface OauthClientSummary {
  readonly id: UUID;
  readonly clientId: string;
  readonly name: string;
  readonly description: string | null;
  readonly developer: string | null;
  readonly developerUrl: string | null;
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly publicEnabled: boolean;
  readonly clientCredentialsEnabled: boolean;
  readonly webhookUrl: string | null;
  readonly createdAt: string;
}

export interface OauthClientInfo {
  readonly clientId: string;
  readonly name: string;
  readonly description: string | null;
  readonly developer: string | null;
  readonly developerUrl: string | null;
  readonly imageUrl: string | null;
  readonly allowedScopes: readonly string[];
}

export interface CreatedOauthClient {
  readonly oauthClient: OauthClientSummary;
  readonly clientSecret: string;
}

export interface NewOauthClient {
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly developer?: string;
  readonly developerUrl?: string;
  readonly description?: string;
  readonly publicEnabled?: boolean;
  readonly clientCredentialsEnabled?: boolean;
  readonly webhookUrl?: string;
}

export async function createOauthClient(input: NewOauthClient): Promise<CreatedOauthClient> {
  const data = await gql<{
    createOauthClient: { created: { clientSecret: string; oauthClient: OauthClientSummary } };
  }>(CREATE_OAUTH_CLIENT, { input });
  return {
    oauthClient: data.createOauthClient.created.oauthClient,
    clientSecret: data.createOauthClient.created.clientSecret,
  };
}

export async function updateOauthClient(
  input: { id: UUID } & Partial<NewOauthClient>,
): Promise<OauthClientSummary> {
  const data = await gql<{ updateOauthClient: { oauthClient: OauthClientSummary } }>(
    UPDATE_OAUTH_CLIENT,
    { input },
  );
  return data.updateOauthClient.oauthClient;
}

export async function rotateOauthClientSecret(
  id: UUID,
): Promise<{ oauthClient: OauthClientSummary; clientSecret: string }> {
  const data = await gql<{
    rotateOauthClientSecret: { clientSecret: string; oauthClient: OauthClientSummary };
  }>(ROTATE_OAUTH_SECRET, { id });
  return {
    oauthClient: data.rotateOauthClientSecret.oauthClient,
    clientSecret: data.rotateOauthClientSecret.clientSecret,
  };
}

export async function deleteOauthClient(id: UUID): Promise<void> {
  await gql(DELETE_OAUTH_CLIENT, { id });
}

export async function loadOauthClientInfo(clientId: string): Promise<OauthClientInfo> {
  const data = await gql<{ oauthClientInfo: OauthClientInfo }>(OAUTH_CLIENT_INFO_QUERY, {
    clientId,
  });
  return data.oauthClientInfo;
}

export async function createOauthAuthorization(input: {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  actor?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): Promise<string> {
  const data = await gql<{ createOauthAuthorization: { redirectUri: string } }>(
    CREATE_OAUTH_AUTHORIZATION,
    { input },
  );
  return data.createOauthAuthorization.redirectUri;
}

export function parseRedirectUris(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
