import type { UUID } from '~/store';
import { gql } from '~/sync/api';
import { LEAVE_WORKSPACE, REVOKE_AUTHORISED_OAUTH_APP } from './operations';

export interface AuthorisedOauthAppSummary {
  readonly id: UUID;
  readonly name: string;
  readonly clientId: string;
  readonly imageUrl: string | null;
  readonly developer: string | null;
  readonly scopes: readonly string[];
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export function revokeConsequence(app: AuthorisedOauthAppSummary): string {
  return `${app.name} will lose every live token you granted it in this workspace. It will have to ask for permission again. This cannot be undone.`;
}

export async function revokeAuthorisedOauthApp(id: UUID): Promise<void> {
  await gql(REVOKE_AUTHORISED_OAUTH_APP, { id });
}

export async function leaveWorkspace(): Promise<void> {
  await gql(LEAVE_WORKSPACE);
}
