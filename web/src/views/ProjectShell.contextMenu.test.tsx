/**
 * The project header's two ways into the same menu.
 *
 * A right-click on the header is not a second, smaller menu: it is the ⋯ menu arriving where
 * the pointer already is. Both are built by the one `menuItems()` call, and the test that
 * matters is the one that fails the day somebody adds an item to only one of them — so it
 * compares the two lists item for item, in order, rather than asserting a hand-written list
 * that would have to be edited alongside the drift it exists to catch.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { EMPTY_FILTER } from '~/filter';
import { Store, type Change, type Entity, type Project, type ProjectStatus } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { ProjectShell } from './ProjectShell';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const STATUS = '01900000-0000-7000-8000-000000000003';
const VIEWER = '01900000-0000-7000-8000-000000000004';
const VIEW = '01900000-0000-7000-8000-000000000005';
const AT = '2026-01-01T00:00:00.000Z';
const READY: EngineStatus = { phase: 'ready', connection: 'ready', pending: 0 };

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
  targetDate: '2026-06-30',
  targetDateGranularity: 'quarter',
  updateSchedule: 'default',
  createdAt: AT,
  updatedAt: AT,
};

function renderShell(store: Store, status: EngineStatus) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Routes>
            <Route path="/project/:projectId" element={<ProjectShell />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([upsert(1, 'projectStatus', status), upsert(2, 'project', project)]);
  return store;
}

/** The same project, plus one saved view — which draws a tab inside the header. */
function seededWithView(): Store {
  const store = seeded();
  store.applyChanges([
    upsert(3, 'view', {
      id: VIEW,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      name: 'Bugs',
      filter: EMPTY_FILTER,
      display: {},
      position: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

/** The header itself, reached from the heading it carries rather than from a hashed class. */
function header(): HTMLElement {
  const found = screen.getByRole('heading', { level: 1, name: 'Launch' }).closest('header');
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

describe('ProjectShell context menu', () => {
  it('opens a menu on a right-click of the header, not only from the ⋯ button', async () => {
    const user = userEvent.setup();
    renderShell(seeded(), READY);

    await user.pointer({ target: header(), keys: '[MouseRight]' });

    expect(await screen.findByRole('menu', { name: 'Options for Launch' })).not.toBeNull();
  });

  it('offers the same items, in the same order, as the ⋯ menu', async () => {
    const user = userEvent.setup();
    renderShell(seeded(), READY);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const kebab = itemNames(await screen.findByRole('menu', { name: 'More actions' }));
    // Not an empty pass: the shared builder yields Copy link, favourites, the UUID, archive
    // and delete, and a menu that quietly rendered nothing would compare equal to nothing.
    expect(kebab.length).toBeGreaterThan(3);
    expect(kebab).toContain('Delete project');

    await user.keyboard('{Escape}');

    await user.pointer({ target: header(), keys: '[MouseRight]' });
    const contextual = itemNames(await screen.findByRole('menu', { name: 'Options for Launch' }));

    expect(contextual).toEqual(kebab);
  });

  it('leaves a right-click on a saved view tab to the tab', async () => {
    // The tabs are drawn inside this header, and the header's handler would otherwise fire
    // on the way up and stack the project's menu on top of the tab's — two menus at once,
    // neither of them clickable. It cost an e2e failure the first time.
    const user = userEvent.setup();
    renderShell(seededWithView(), READY);

    await user.pointer({ target: screen.getByRole('link', { name: 'Bugs' }), keys: '[MouseRight]' });

    expect(await screen.findByRole('menu', { name: 'View options' })).not.toBeNull();
    expect(screen.queryByRole('menu', { name: 'Options for Launch' })).toBeNull();
  });
});
