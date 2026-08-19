/**
 * Team archive settings, on-demand archive listings, and restore.
 *
 * Restore has no optimistic patch: the replica dropped the row when it was archived, so
 * there is no `before` to hold, and an archived restore is an upsert the next delta will
 * carry. Waiting for that delta is the only honest version.
 */

import { fromWire } from '~/gql/enums';
import { ARCHIVE_ISSUE, UPDATE_TEAM_ARCHIVE } from '~/gql/operations';
import type { Cycle, Issue, Project, Team, UUID } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ARCHIVE_CYCLE,
  ARCHIVE_PROJECT,
  ARCHIVED_CYCLES_QUERY,
  ARCHIVED_ISSUES_QUERY,
  ARCHIVED_PROJECTS_QUERY,
} from './operations';

export async function updateTeamArchive(
  engine: SyncEngine,
  teamId: UUID,
  patch: {
    autoCloseDays?: number | undefined;
    autoArchiveDays?: number | undefined;
    autoCloseParent?: boolean | undefined;
    autoCloseChildren?: boolean | undefined;
  },
): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const after: Team = {
    ...before,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_TEAM_ARCHIVE,
    variables: { input: { teamId, ...patch } },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}

export async function fetchArchivedIssues(
  teamId: UUID,
  signal?: AbortSignal,
): Promise<readonly Issue[]> {
  const data = await gql<{ archivedIssues: Issue[] }>(
    ARCHIVED_ISSUES_QUERY,
    { teamId },
    { signal },
  );
  return data.archivedIssues.map((issue) => fromWire('issue', issue));
}

export async function fetchArchivedCycles(
  teamId: UUID,
  signal?: AbortSignal,
): Promise<readonly Cycle[]> {
  const data = await gql<{ archivedCycles: Cycle[] }>(
    ARCHIVED_CYCLES_QUERY,
    { teamId },
    { signal },
  );
  return data.archivedCycles.map((cycle) => fromWire('cycle', cycle));
}

export async function fetchArchivedProjects(
  teamId: UUID,
  signal?: AbortSignal,
): Promise<readonly Project[]> {
  const data = await gql<{ archivedProjects: Project[] }>(
    ARCHIVED_PROJECTS_QUERY,
    { teamId },
    { signal },
  );
  return data.archivedProjects.map((project) => fromWire('project', project));
}

export async function unarchiveIssue(engine: SyncEngine, id: UUID): Promise<void> {
  await engine.mutate({ mutation: ARCHIVE_ISSUE, variables: { id, archived: false } });
}

export async function unarchiveCycle(engine: SyncEngine, id: UUID): Promise<void> {
  await engine.mutate({ mutation: ARCHIVE_CYCLE, variables: { id, archived: false } });
}

export async function unarchiveProject(engine: SyncEngine, id: UUID): Promise<void> {
  await engine.mutate({ mutation: ARCHIVE_PROJECT, variables: { id, archived: false } });
}
