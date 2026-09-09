/**
 * The initiative header answers a right-click with the same menu the `…` button opens.
 *
 * The two menus are built by one `moreItems()` call, so the thing worth holding is that
 * they cannot drift: same items, same order. And that neither offers Delete — an
 * initiative has never had one, archiving is the only way out.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeDetail } from './InitiativeDetail';
import { InitiativeShell } from './InitiativeShell';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const INITIATIVE = 'i1';
const NAME = 'Platform reliability';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({
    id: VIEWER,
    workspaceId: WORKSPACE,
    name: 'ada',
    displayName: 'Ada Lovelace',
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', {
      id: VIEWER,
      workspaceId: WORKSPACE,
      name: 'ada',
      displayName: 'Ada Lovelace',
      timezone: 'UTC',
      role: 'admin',
      status: 'active',
      kind: 'human',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'initiative', {
      id: INITIATIVE,
      workspaceId: WORKSPACE,
      name: NAME,
      description: '',
      status: 'planned',
      priority: 0,
      ownerId: VIEWER,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function mount() {
  const engine = { store: seeded(), mutate: vi.fn(async () => ({})) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/initiative/${INITIATIVE}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeShell />}>
              <Route index element={<InitiativeDetail />} />
            </Route>
            <Route path="/initiatives" element={<h1>Initiatives</h1>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup() };
}

function header(): HTMLElement {
  const found = screen.getByRole('heading', { name: NAME }).closest('header');
  if (found === null) throw new Error('the initiative header is not in the document');
  return found;
}

function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

describe('InitiativeShell context menu', () => {
  it('opens a menu on a right-click of the header', async () => {
    const { user } = mount();

    await user.pointer({ target: header(), keys: '[MouseRight]' });

    expect(await screen.findByRole('menu', { name: `Options for ${NAME}` })).toBeTruthy();
  });

  it('offers exactly what the ⋯ menu offers, in the same order', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const kebab = itemNames(await screen.findByRole('menu', { name: 'More actions' }));
    await user.keyboard('{Escape}');

    await user.pointer({ target: header(), keys: '[MouseRight]' });
    const context = itemNames(await screen.findByRole('menu', { name: `Options for ${NAME}` }));

    expect(kebab.length).toBeGreaterThan(0);
    expect(context).toEqual(kebab);
  });

  it('archives rather than deletes, from either menu', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const kebab = itemNames(await screen.findByRole('menu', { name: 'More actions' }));
    await user.keyboard('{Escape}');

    await user.pointer({ target: header(), keys: '[MouseRight]' });
    const context = itemNames(await screen.findByRole('menu', { name: `Options for ${NAME}` }));

    for (const names of [kebab, context]) {
      expect(names.some((name) => /delete/i.test(name))).toBe(false);
      expect(names).toContain('Archive initiative');
    }
  });
});
