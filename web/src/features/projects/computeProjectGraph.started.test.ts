/**
 * The Started line, and what it is allowed to be a function of.
 *
 * An issue sitting in a started state without a `startedAt` used to be counted as started
 * from its `updatedAt`, which made the line move whenever anybody touched the row: renaming
 * an issue changed the moment it began, and a busy week's chart redrew itself every time
 * somebody fixed a typo in a title. There is no honest proxy for a fact the row does not
 * carry, so it is not guessed at any more.
 */

import { describe, expect, it } from 'vitest';

import {
  Store,
  type Change,
  type Entity,
  type Issue,
  type Project,
  type ProjectStatus,
  type Team,
  type WorkflowState,
} from '~/store';

import { buildProjectGraph } from './computeProjectGraph';

const WORKSPACE = 'w';
const TEAM = 't1';
const PROJECT = 'p1';
const STATUS = 'ps1';
const CREATED = '2026-01-01T00:00:00.000Z';
const MUCH_LATER = '2026-02-20T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

const team: Team = {
  id: TEAM,
  workspaceId: WORKSPACE,
  key: 'ENG',
  name: 'Engineering',
  timezone: 'UTC',
  private: false,
  estimateScale: 'none',
  estimateAllowZero: false,
  estimateExtended: false,
  cyclesEnabled: false,
  cycleDurationWeeks: 1,
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
  createdAt: CREATED,
  updatedAt: CREATED,
};

const status: ProjectStatus = {
  id: STATUS,
  workspaceId: WORKSPACE,
  name: 'In progress',
  color: '#5e6ad2',
  category: 'started',
  position: 'a',
  isDefault: true,
  createdAt: CREATED,
  updatedAt: CREATED,
};

const project: Project = {
  id: PROJECT,
  workspaceId: WORKSPACE,
  name: 'Launch',
  description: '',
  color: '',
  statusId: STATUS,
  priority: 0,
  sortOrder: 'a',
  startDate: '2026-01-01',
  updateSchedule: 'default',
  createdAt: CREATED,
  updatedAt: CREATED,
};

const doing: WorkflowState = {
  id: 's1',
  workspaceId: WORKSPACE,
  teamId: TEAM,
  name: 'In progress',
  color: '#888888',
  category: 'started',
  position: 'a',
  isDefault: true,
  isSystem: false,
  createdAt: CREATED,
  updatedAt: CREATED,
};

function issue(id: string, extra: Partial<Issue>): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId: doing.id,
    priority: 0,
    sortOrder: id,
    dueDateSource: 'manual',
    projectId: PROJECT,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...extra,
  };
}

function graphWith(rows: readonly Issue[]) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team),
    upsert(2, 'projectStatus', status),
    upsert(3, 'project', project),
    upsert(4, 'workflowState', doing),
    ...rows.map((row, index) => upsert(5 + index, 'issue', row)),
  ]);
  return buildProjectGraph(store, PROJECT);
}

describe('buildProjectGraph', () => {
  it('counts an issue as started only from its own startedAt', () => {
    const withStamp = graphWith([issue('i1', { startedAt: CREATED })]);
    expect(withStamp?.totalStarted).toBe(1);
  });

  it('does not read a later edit as a later start', () => {
    // Same issue, same state, one title edit later. The Started line must not move.
    const edited = graphWith([issue('i1', { updatedAt: MUCH_LATER })]);
    expect(edited?.totalStarted).toBe(0);
  });

  it('still counts a completed issue as having started', () => {
    const done = graphWith([issue('i1', { completedAt: '2026-01-10T00:00:00.000Z' })]);
    expect(done?.totalStarted).toBe(1);
  });
});
