/**
 * Two claims the projects list used to get wrong.
 *
 * An empty replica is not an empty workspace: on a cold start the list rendered "No
 * projects yet" over rows that were still on the wire, and offered to create one.
 *
 * And the filters were local state while the display options were in the URL, so a reload
 * or a shared link kept the layout and dropped the filtering.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Projects } from './Projects';

const WORKSPACE = 'w1';
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

function status(id: string, name: string, category: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    color: '#5e6ad2',
    category,
    position: 'a',
    isDefault: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function project(id: string, name: string, statusId: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    color: '#5e6ad2',
    statusId,
    priority: 0,
    sortOrder: id,
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', status('ps-started', 'In progress', 'started')),
    upsert(2, 'projectStatus', status('ps-done', 'Shipped', 'completed')),
    upsert(3, 'project', project('p1', 'Live project', 'ps-started')),
    upsert(4, 'project', project('p2', 'Finished project', 'ps-done')),
  ]);
  return store;
}

function renderList(options: { store?: Store; phase?: EngineStatus; url?: string } = {}) {
  const engine = {
    store: options.store ?? seeded(),
    mutate: vi.fn(),
  } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[options.url ?? '/projects']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={options.phase ?? { phase: 'idle' }}>
          <Projects />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Projects list', () => {
  it('shows a skeleton, not "No projects yet", before the first sync settles', () => {
    renderList({ store: new Store(WORKSPACE), phase: { phase: 'hydrating' } });
    expect(screen.getByRole('status').textContent).toContain('Loading projects');
    expect(screen.queryByText('No projects yet')).toBeNull();
  });

  it('says the workspace is empty once the store has settled', () => {
    renderList({ store: new Store(WORKSPACE) });
    expect(screen.getByText('No projects yet')).toBeTruthy();
  });

  it('reads the status filter out of the URL', () => {
    renderList({ url: '/projects?status=started' });
    expect(screen.getByText('Live project')).toBeTruthy();
    expect(screen.queryByText('Finished project')).toBeNull();
  });

  it('shows everything when the query string names no filter', () => {
    renderList();
    expect(screen.getByText('Live project')).toBeTruthy();
    expect(screen.getByText('Finished project')).toBeTruthy();
  });

  it('distinguishes an empty result from an empty workspace', () => {
    renderList({ url: '/projects?status=canceled' });
    expect(screen.getByText('Nothing matches these filters')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear the filters' })).toBeTruthy();
  });
});
