/**
 * Retire, delete, and restore teams.
 *
 * Retire and unretire patch `retiredAt` optimistically — the row stays in the replica and
 * the sidebar hides retired teams locally. Delete and restore follow the trash pattern:
 * delete emits an op the client drops; restore waits for the delta.
 */

import type { Team, UUID } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  DELETE_TEAM,
  DELETED_TEAMS_QUERY,
  RESTORE_TEAM,
  RETIRE_TEAM,
  UNRETIRE_TEAM,
} from './operations';

export const RESTORE_WINDOW_DAYS = 30;

export interface DeletedTeamRow {
  readonly id: UUID;
  readonly key: string;
  readonly name: string;
  readonly deletedAt: string;
}

export async function fetchDeletedTeams(signal?: AbortSignal): Promise<readonly DeletedTeamRow[]> {
  const data = await gql<{ deletedTeams: DeletedTeamRow[] }>(DELETED_TEAMS_QUERY, undefined, {
    signal,
  });
  return data.deletedTeams;
}

export async function retireTeam(engine: SyncEngine, teamId: UUID): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const retiredAt = new Date().toISOString();
  const after: Team = { ...before, retiredAt, updatedAt: retiredAt };

  await engine.mutate({
    mutation: RETIRE_TEAM,
    variables: { id: teamId },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}

export async function unretireTeam(engine: SyncEngine, teamId: UUID): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const { retiredAt: _removed, ...rest } = before;
  const updatedAt = new Date().toISOString();
  const after: Team = { ...rest, updatedAt };

  await engine.mutate({
    mutation: UNRETIRE_TEAM,
    variables: { id: teamId },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}

export async function deleteTeam(engine: SyncEngine, teamId: UUID): Promise<void> {
  await engine.mutate({ mutation: DELETE_TEAM, variables: { id: teamId } });
}

export async function restoreTeam(engine: SyncEngine, teamId: UUID): Promise<void> {
  await engine.mutate({ mutation: RESTORE_TEAM, variables: { id: teamId } });
}
