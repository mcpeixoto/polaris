/**
 * The session writes. Neither goes through `engine.mutate`.
 *
 * There is no `accountSession` entity in the store, so there is no optimistic patch for
 * the outbox to protect; and the entire point of pressing revoke is that the login stops
 * working, so a revoke sitting silently in a queue is worse than a failure the user can
 * see and retry.
 */

import type { UUID } from '~/store';
import { gql } from '~/sync/api';
import { REVOKE_ACCOUNT_SESSION, REVOKE_OTHER_SESSIONS } from './operations';

export interface AccountSessionSummary {
  readonly id: UUID;
  readonly label: string;
  readonly userAgent: string | null;
  readonly ip: string | null;
  readonly country: string | null;
  readonly current: boolean;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export function locationOf(session: AccountSessionSummary): string {
  if (session.country !== null && session.country !== '') return session.country;
  return 'Unknown location';
}

export function revocationConsequence(session: AccountSessionSummary): string {
  if (session.current) {
    return `This browser will be signed out. You will have to sign in again to keep working here. Other devices are not affected.`;
  }
  return `${session.label} will have to sign in again. Anything it was doing as you stops on its next request. This cannot be undone.`;
}

export function revokeOthersConsequence(count: number): string {
  const devices =
    count === 1 ? 'The other signed-in device' : `All ${count} other signed-in devices`;
  return `${devices} will have to sign in again. This browser stays signed in. Stolen or forgotten logins are the reason to press this.`;
}

export async function revokeAccountSession(id: UUID): Promise<void> {
  await gql(REVOKE_ACCOUNT_SESSION, { id });
}

export async function revokeOtherSessions(): Promise<void> {
  await gql(REVOKE_OTHER_SESSIONS);
}
