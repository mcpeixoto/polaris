/**
 * The overview's rollup: progress, the graph's written name, and a project reached through
 * a sub-initiative listed beside the ones this initiative owns.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Issue, Project, ProjectStatus } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeDetail } from './InitiativeDetail';

const W = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function status(): ProjectStatus {
  return {
    id: 'ps1',
    workspaceId: W,
    name: 'In progress',
    color: '#5e6ad2',
    category: 'started',
    position: 'a',
    isDefault: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function project(id: string, name: string): Project {
  return {
    id,
    workspaceId: W,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps1',
    priority: 0,
    sortOrder: id,
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, projectId: string, completed: boolean): Issue {
  return {
    id,
    workspaceId: W,
    teamId: 't1',
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId: 's1',
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    projectId,
    createdAt: AT,
    updatedAt: AT,
    ...(completed ? { completedAt: '2026-01-08T00:00:00.000Z' } : null),
  };
}

function initiative(id: string, name: string): Entity {
  return {
    id,
    workspaceId: W,
    name,
    description: '',
    status: 'planned',
    priority: 0,
    sortOrder: id,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function renderOverview() {
  const store = new Store(W);
  store.applyChanges([
    upsert(1, 'projectStatus', status()),
    upsert(2, 'project', project('p1', 'Alpha')),
    upsert(3, 'project', project('p2', 'Beta')),
    upsert(4, 'initiative', initiative('parent', 'Company goals')),
    upsert(5, 'initiative', initiative('child', 'Platform')),
    upsert(6, 'initiativeRelation', {
      id: 'ir1',
      workspaceId: W,
      parentInitiativeId: 'parent',
      childInitiativeId: 'child',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(7, 'initiativeProject', {
      id: 'ip1',
      workspaceId: W,
      initiativeId: 'parent',
      projectId: 'p1',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(8, 'initiativeProject', {
      id: 'ip2',
      workspaceId: W,
      initiativeId: 'child',
      projectId: 'p2',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(9, 'issue', issue('i1', 'p1', true)),
    upsert(10, 'issue', issue('i2', 'p1', false)),
    upsert(11, 'issue', issue('i3', 'p2', false)),
    upsert(12, 'issue', issue('i4', 'p2', false)),
  ]);
  const engine = { store, mutate: async () => ({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/initiative/parent']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Initiative overview rollup', () => {
  it('rolls progress up over the descendants', () => {
    renderOverview();
    expect(screen.getByLabelText('Company goals: 1 of 4 issues completed, 25%')).toBeTruthy();
  });

  it('gives the graph a written name rather than an unlabelled drawing', () => {
    renderOverview();
    expect(
      screen.getByRole('img', { name: /Initiative graph: 1 of 4 issues completed/ }),
    ).toBeTruthy();
  });

  it('lists a sub-initiative’s project and does not offer to remove it here', () => {
    renderOverview();
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();
    expect(screen.getByText('Via a sub-initiative')).toBeTruthy();
    // One Remove, for the one project this initiative owns directly.
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBe(1);
  });
});
