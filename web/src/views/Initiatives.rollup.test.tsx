/**
 * The list's progress column, its target date, and a child reached through two parents.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Issue, Project, ProjectStatus } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Initiatives } from './Initiatives';

const W = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => null,
}));

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

function initiative(id: string, name: string, sortOrder: string, targetDate?: string): Entity {
  return {
    id,
    workspaceId: W,
    name,
    description: '',
    status: 'planned',
    priority: 0,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
    ...(targetDate === undefined ? null : { targetDate, targetDateGranularity: 'day' }),
  } as Entity;
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

function project(): Project {
  return {
    id: 'p1',
    workspaceId: W,
    name: 'Alpha',
    description: '',
    color: '#5e6ad2',
    statusId: 'ps1',
    priority: 0,
    sortOrder: 'a',
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, completed: boolean): Issue {
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
    projectId: 'p1',
    createdAt: AT,
    updatedAt: AT,
    ...(completed ? { completedAt: '2026-01-05T00:00:00.000Z' } : null),
  };
}

function renderList(changes: Change[]) {
  const store = new Store(W);
  store.applyChanges(changes);
  const engine = { store, mutate: async () => ({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Initiatives />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Initiatives list rollup', () => {
  it('shows progress over the linked projects and the target date', () => {
    renderList([
      upsert(1, 'projectStatus', status()),
      upsert(2, 'project', project()),
      upsert(3, 'initiative', initiative('i1', 'Company goals', 'a', '2026-06-01')),
      upsert(4, 'initiativeProject', {
        id: 'ip1',
        workspaceId: W,
        initiativeId: 'i1',
        projectId: 'p1',
        sortOrder: 'a',
        createdAt: AT,
      }),
      upsert(5, 'issue', issue('is1', true)),
      upsert(6, 'issue', issue('is2', false)),
      upsert(7, 'issue', issue('is3', false)),
      upsert(8, 'issue', issue('is4', false)),
    ]);
    expect(screen.getByLabelText('Company goals: 1 of 4 issues completed, 25%')).toBeTruthy();
    // Through `whenDay`, so the column reads the way every other date in the product does.
    expect(screen.getByText(/Jun\s*1/)).toBeTruthy();
  });

  it('says so rather than showing a bar when nothing is linked', () => {
    renderList([upsert(1, 'initiative', initiative('i1', 'Company goals', 'a'))]);
    expect(screen.getByText('No issues')).toBeTruthy();
    expect(screen.getByText('No target')).toBeTruthy();
  });

  it('renders a child reached through two parents once per parent', () => {
    // The same initiative at the same depth under two roots. Keyed by id and depth these
    // two rows collided, and React carried state between rows that are not the same row.
    renderList([
      upsert(1, 'initiative', initiative('a', 'Alpha goals', 'a')),
      upsert(2, 'initiative', initiative('b', 'Beta goals', 'b')),
      upsert(3, 'initiative', initiative('shared', 'Shared work', 'c')),
      upsert(4, 'initiativeRelation', {
        id: 'r1',
        workspaceId: W,
        parentInitiativeId: 'a',
        childInitiativeId: 'shared',
        sortOrder: 'a',
        createdAt: AT,
      }),
      upsert(5, 'initiativeRelation', {
        id: 'r2',
        workspaceId: W,
        parentInitiativeId: 'b',
        childInitiativeId: 'shared',
        sortOrder: 'a',
        createdAt: AT,
      }),
    ]);
    expect(screen.getAllByText('Shared work').length).toBe(2);
  });
});
