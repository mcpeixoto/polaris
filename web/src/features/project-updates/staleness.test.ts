import { describe, expect, it } from 'vitest';

import type { Project, ProjectStatus, ProjectUpdate, Store, Workspace } from '~/store';

import { effectiveReminderIntervalDays, projectUpdateStaleness } from './staleness';

const NOW = new Date('2026-08-19T12:00:00Z');

function storeWith(
  project: Partial<Project> & Pick<Project, 'id' | 'statusId'>,
  workspace: Partial<Workspace> = {},
  status: ProjectStatus,
  updates: readonly ProjectUpdate[] = [],
): Store {
  const ws: Workspace = {
    id: 'w',
    name: 'Acme',
    urlKey: 'acme',
    plan: 'free',
    projectUpdateReminderIntervalDays: 7,
    projectUpdateReminderWeekday: 3,
    projectUpdateReminderHour: 9,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...workspace,
  };
  const fullProject: Project = {
    workspaceId: 'w',
    name: 'Alpha',
    description: '',
    color: '#000',
    priority: 0,
    sortOrder: 'a0',
    updateSchedule: 'default',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...project,
  };
  const tables = {
    workspace: new Map([[ws.id, ws]]),
    project: new Map([[fullProject.id, fullProject]]),
    projectStatus: new Map([[status.id, status]]),
    projectUpdate: new Map(updates.map((row) => [row.id, row])),
  };
  return {
    workspaceId: ws.id,
    workspaces: tables.workspace,
    projects: tables.project,
    projectStatuses: tables.projectStatus,
    projectUpdates: tables.projectUpdate,
    projectUpdateIdsFor: (projectId: string) =>
      new Set(
        updates
          .filter((row) => row.projectId === projectId && row.deletedAt === undefined)
          .map((row) => row.id),
      ),
  } as unknown as Store;
}

const started: ProjectStatus = {
  id: 'started',
  workspaceId: 'w',
  name: 'In progress',
  color: '#0af',
  category: 'started',
  position: 'a0',
  isDefault: false,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

describe('effectiveReminderIntervalDays', () => {
  it('uses workspace default', () => {
    expect(
      effectiveReminderIntervalDays(
        { updateSchedule: 'default', updateReminderIntervalDays: 14 },
        { projectUpdateReminderIntervalDays: 7 },
      ),
    ).toBe(7);
  });

  it('uses custom override', () => {
    expect(
      effectiveReminderIntervalDays(
        { updateSchedule: 'custom', updateReminderIntervalDays: 14 },
        { projectUpdateReminderIntervalDays: 7 },
      ),
    ).toBe(14);
  });
});

describe('projectUpdateStaleness', () => {
  it('marks completed projects as not expected', () => {
    const store = storeWith(
      { id: 'p1', statusId: 'done' },
      {},
      { ...started, id: 'done', category: 'completed' },
    );
    expect(projectUpdateStaleness(store, 'p1', NOW)).toBe('not_expected');
  });

  it('marks never-schedule projects as not expected', () => {
    const store = storeWith(
      { id: 'p1', statusId: started.id, updateSchedule: 'never' },
      {},
      started,
    );
    expect(projectUpdateStaleness(store, 'p1', NOW)).toBe('not_expected');
  });

  it('warns when an on-track update is overdue', () => {
    const store = storeWith({ id: 'p1', statusId: started.id }, {}, started, [
      {
        id: 'u1',
        workspaceId: 'w',
        projectId: 'p1',
        health: 'on_track',
        body: '',
        authorId: 'u1',
        createdAt: '2026-08-10T00:00:00Z',
        updatedAt: '2026-08-10T00:00:00Z',
      },
    ]);
    expect(projectUpdateStaleness(store, 'p1', NOW)).toBe('due_soon');
  });

  it('marks missing after interval plus grace', () => {
    const store = storeWith({ id: 'p1', statusId: started.id }, {}, started, [
      {
        id: 'u1',
        workspaceId: 'w',
        projectId: 'p1',
        health: 'on_track',
        body: '',
        authorId: 'u1',
        createdAt: '2026-08-08T00:00:00Z',
        updatedAt: '2026-08-08T00:00:00Z',
      },
    ]);
    expect(projectUpdateStaleness(store, 'p1', NOW)).toBe('missing');
  });
});
