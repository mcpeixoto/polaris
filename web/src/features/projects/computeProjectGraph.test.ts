import { describe, expect, it } from 'vitest';

import { Store } from '~/store/store';
import type {
  Change,
  Entity,
  Issue,
  Project,
  ProjectStatus,
  Team,
  WorkflowState,
} from '~/store/types';

import { buildProjectGraph } from './computeProjectGraph';

const NOW = '2026-02-10T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function team(id: string): Team {
  return {
    id,
    workspaceId: 'w',
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 2,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('buildProjectGraph', () => {
  it('charts scope and completed for a started project', () => {
    const store = new Store('w');
    const teamId = 't1';
    const projectId = 'p1';
    const statusId = 'ps1';

    const status: ProjectStatus = {
      id: statusId,
      workspaceId: 'w',
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: false,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const project: Project = {
      id: projectId,
      workspaceId: 'w',
      name: 'Launch',
      description: '',
      color: '#5e6ad2',
      statusId,
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      startDate: '2026-01-01',
      targetDate: '2026-03-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: NOW,
    };

    const todo: WorkflowState = {
      id: 's1',
      workspaceId: 'w',
      teamId,
      name: 'Todo',
      color: '#888',
      category: 'unstarted',
      position: 'a',
      isDefault: true,
      isSystem: false,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const done: WorkflowState = {
      id: 's2',
      workspaceId: 'w',
      teamId,
      name: 'Done',
      color: '#0a0',
      category: 'completed',
      position: 'b',
      isDefault: false,
      isSystem: true,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const issue = (id: string, createdAt: string, completedAt?: string): Issue => ({
      id,
      workspaceId: 'w',
      teamId,
      number: Number(id.slice(1)),
      identifier: `ENG-${id.slice(1)}`,
      title: id,
      description: '',
      stateId: completedAt === undefined ? todo.id : done.id,
      priority: 3,
      sortOrder: id,
      dueDateSource: 'manual',
      projectId,
      createdAt,
      updatedAt: NOW,
      ...(completedAt === undefined ? null : { completedAt }),
    });

    store.applyChanges([
      upsert(1, 'team', team(teamId)),
      upsert(2, 'projectStatus', status),
      upsert(3, 'project', project),
      upsert(4, 'workflowState', todo),
      upsert(5, 'workflowState', done),
      upsert(6, 'issue', issue('i1', '2026-01-02T00:00:00.000Z', '2026-01-10T00:00:00.000Z')),
      upsert(7, 'issue', issue('i2', '2026-01-15T00:00:00.000Z')),
      upsert(8, 'issue', issue('i3', '2026-01-22T00:00:00.000Z', '2026-01-29T00:00:00.000Z')),
    ]);

    const data = buildProjectGraph(store, projectId);
    expect(data).not.toBeNull();
    expect(data!.weeks.length).toBeGreaterThan(1);
    expect(data!.totalScope).toBe(3);
    expect(data!.totalCompleted).toBe(2);
    expect(data!.targetDate).toBe('2026-03-01');
    expect(data!.assignees.length).toBeGreaterThan(0);
  });

  it('keeps its data for a project too young to plot, rather than reporting no graph', () => {
    // `null` is the view's "there is nothing here yet, do something" answer, and it names
    // the two things to do: start the project, file an issue. A project started today with
    // an issue on it has done both, so answering `null` tells the person to repeat work
    // they have already done — and hides the honest line the view has for this case.
    const store = new Store('w');
    const today = new Date().toISOString();
    const status: ProjectStatus = {
      id: 'ps1',
      workspaceId: 'w',
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: false,
      createdAt: today,
      updatedAt: today,
    };
    const project: Project = {
      id: 'p1',
      workspaceId: 'w',
      name: 'Fresh',
      description: '',
      color: '#5e6ad2',
      statusId: 'ps1',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      createdAt: today,
      updatedAt: today,
    };
    const state: WorkflowState = {
      id: 's1',
      workspaceId: 'w',
      teamId: 't1',
      name: 'Todo',
      color: '#888',
      category: 'unstarted',
      position: 'a',
      isDefault: true,
      isSystem: true,
      createdAt: today,
      updatedAt: today,
    };
    const issue: Issue = {
      id: 'i1',
      workspaceId: 'w',
      teamId: 't1',
      number: 1,
      identifier: 'ENG-1',
      title: 'First',
      description: '',
      stateId: 's1',
      priority: 0,
      sortOrder: 'a',
      dueDateSource: 'manual',
      projectId: 'p1',
      createdAt: today,
      updatedAt: today,
    };
    store.applyChanges([
      upsert(1, 'team', team('t1')),
      upsert(2, 'projectStatus', status),
      upsert(3, 'project', project),
      upsert(4, 'workflowState', state),
      upsert(5, 'issue', issue),
    ]);

    const data = buildProjectGraph(store, 'p1');
    expect(data).not.toBeNull();
    expect(data!.weeks).toHaveLength(1);
    expect(data!.totalScope).toBe(1);
    expect(data!.prediction).toBeUndefined();
  });

  it('returns null for backlog projects', () => {
    const store = new Store('w');
    const status: ProjectStatus = {
      id: 'ps1',
      workspaceId: 'w',
      name: 'Backlog',
      color: '#888',
      category: 'backlog',
      position: 'a',
      isDefault: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const project: Project = {
      id: 'p1',
      workspaceId: 'w',
      name: 'Later',
      description: '',
      color: '#888',
      statusId: 'ps1',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      createdAt: NOW,
      updatedAt: NOW,
    };
    store.applyChanges([upsert(1, 'projectStatus', status), upsert(2, 'project', project)]);
    expect(buildProjectGraph(store, 'p1')).toBeNull();
  });
});
