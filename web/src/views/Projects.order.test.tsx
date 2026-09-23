/**
 * Ordering, category grouping, and the shared filter grammar on the projects list.
 *
 * The status pills and the dependency menu were already here. These are the controls the
 * list grew so a project list and an issue list answer the same questions.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { toFilterParam } from '~/filter';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Projects } from './Projects';

function rows(): HTMLElement[] {
  return within(screen.getByRole('listbox', { name: 'Projects' })).getAllByRole('option');
}

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, workspaceId: WORKSPACE, role: 'admin', displayName: 'Ada' }),
  useViewerRole: () => 'admin',
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

function status(id: string, name: string, category: string, position: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function project(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-started',
    priority: 0,
    sortOrder: id,
    updateSchedule: 'never',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', status('ps-planned', 'Planned', 'planned', 'a')),
    upsert(2, 'projectStatus', status('ps-started', 'In progress', 'started', 'b')),
    upsert(3, 'project', project('p1', 'Launch', { createdAt: '2026-03-01T00:00:00.000Z' })),
    upsert(
      4,
      'project',
      project('p2', 'Migrate', {
        statusId: 'ps-planned',
        targetDate: '2026-09-01',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ),
  ]);
  return store;
}

function mount(url: string) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[url]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' } as EngineStatus}>
          <Routes>
            <Route path="/projects" element={<Projects />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('project ordering and the shared filter', () => {
  it('orders by when the project was created', () => {
    mount('/projects?group=none&order=created');
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Migrate'),
      expect.stringContaining('Launch'),
    ]);
  });

  it('groups by status category', () => {
    mount('/projects?group=statusCategory');
    const headings = screen.getAllByRole('button', { expanded: true });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Planned1', 'Started1']);
  });

  it('applies a project filter from the URL', () => {
    const filter = toFilterParam({ field: 'name', op: 'contains', values: ['Lau'] });
    mount(`/projects?filter=${filter}`);
    expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining('Launch')]);
  });
});
