/**
 * The chart's scale, which it did not have.
 *
 * Three curves floated in an unlabelled box, stretched by `preserveAspectRatio="none"` so
 * the same slope meant a different rate in a narrow panel than in a wide one, and the
 * per-period bars `computeProjectGraph` had been computing all along were drawn by nobody.
 * These pin the marks that make the numbers readable off the canvas.
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
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
import type { SyncEngine } from '~/sync/engine';

import { ProjectGraph } from './ProjectGraph';

const WORKSPACE = 'w';
const TEAM = 't1';
const PROJECT = 'p1';
const STATUS = 'ps1';
const AT = '2026-01-01T00:00:00.000Z';

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
  createdAt: AT,
  updatedAt: AT,
};

const status: ProjectStatus = {
  id: STATUS,
  workspaceId: WORKSPACE,
  name: 'In progress',
  color: '#5e6ad2',
  category: 'started',
  position: 'a',
  isDefault: true,
  createdAt: AT,
  updatedAt: AT,
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
  targetDate: '2026-03-01',
  targetDateGranularity: 'day',
  updateSchedule: 'default',
  createdAt: AT,
  updatedAt: AT,
};

const done: WorkflowState = {
  id: 's2',
  workspaceId: WORKSPACE,
  teamId: TEAM,
  name: 'Done',
  color: '#00aa00',
  category: 'completed',
  position: 'b',
  isDefault: false,
  isSystem: true,
  createdAt: AT,
  updatedAt: AT,
};

function issue(id: string, createdAt: string, completedAt: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: Number(id.slice(1)),
    identifier: `ENG-${id.slice(1)}`,
    title: id,
    description: '',
    stateId: done.id,
    priority: 0,
    sortOrder: id,
    dueDateSource: 'manual',
    projectId: PROJECT,
    createdAt,
    updatedAt: createdAt,
    completedAt,
  };
}

function renderGraph() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team),
    upsert(2, 'projectStatus', status),
    upsert(3, 'project', project),
    upsert(4, 'workflowState', done),
    upsert(5, 'issue', issue('i1', '2026-01-02T00:00:00.000Z', '2026-01-10T00:00:00.000Z')),
    upsert(6, 'issue', issue('i2', '2026-01-15T00:00:00.000Z', '2026-01-29T00:00:00.000Z')),
  ]);
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  return render(
    <EngineProvider engine={engine} status={{ phase: 'ready', connection: 'ready', pending: 0 }}>
      <ProjectGraph projectId={PROJECT} />
    </EngineProvider>,
  );
}

describe('ProjectGraph', () => {
  it('scales uniformly, so a slope means a rate', () => {
    const { container } = renderGraph();
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('preserveAspectRatio')).toBeNull();
  });

  it('draws a bar for each period that finished work', () => {
    const { container } = renderGraph();

    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('labels the scale and both ends of the plotted range', () => {
    const { container } = renderGraph();
    const labels = [...container.querySelectorAll('text')].map((node) => node.textContent);

    // A zero line, so a reader knows where the bottom of the chart is.
    expect(labels).toContain('0');
    // And the target, which is the one annotation the chart cannot leave unnamed.
    expect(labels).toContain('Target');
  });
});
