/**
 * The two ways into a document's own menu, and the promise that they are one menu.
 *
 * The ⋯ button was the only way to archive or delete a document, while every row in the
 * lists that lead here answers a right-click. The header now answers one too, and both
 * openings are built by the same `menuItems()` — so the test worth having is not that each
 * one has some items, but that the two lists are identical, in order.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DocumentDetail } from './DocumentDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const TEAM = 't1';
const DOC = 'd1';
const AT = '2026-01-01T00:00:00.000Z';

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
    upsert(1, 'team', {
      id: TEAM,
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      private: false,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(2, 'document', {
      id: DOC,
      workspaceId: WORKSPACE,
      teamId: TEAM,
      title: 'Runbook',
      body: '',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

afterEach(cleanup);

function mount(store: Store, engine: SyncEngine) {
  const view = render(
    <MemoryRouter initialEntries={[`/document/${DOC}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/document/:documentId" element={<DocumentDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, view, user: userEvent.setup() };
}

function renderDetail() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  return { mutate, ...mount(store, { store, mutate } as unknown as SyncEngine) };
}

/** The header the right-click is aimed at — the one holding the ⋯ button. */
function header(): HTMLElement {
  const found = screen.getByRole('button', { name: 'Document options' }).closest('header');
  if (found === null) throw new Error('the document header is not on the screen');
  return found;
}

/** The names on a menu, in the order a reader meets them. */
function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

describe('DocumentDetail context menu', () => {
  it('opens a menu when the header is right-clicked', async () => {
    const { user } = renderDetail();

    await user.pointer({ target: header(), keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for Runbook' });
    expect(itemNames(menu).length).toBeGreaterThan(0);
  });

  it('offers the same items, in the same order, as the ⋯ button', async () => {
    const { user } = renderDetail();

    await user.click(screen.getByRole('button', { name: 'Document options' }));
    const fromKebab = itemNames(await screen.findByRole('menu', { name: 'Document options' }));

    await user.keyboard('{Escape}');

    await user.pointer({ target: header(), keys: '[MouseRight]' });
    const fromRightClick = itemNames(
      await screen.findByRole('menu', { name: 'Options for Runbook' }),
    );

    // Not a subset and not a set: a menu whose destructive item moved is a different menu.
    expect(fromRightClick).toEqual(fromKebab);
    expect(fromRightClick).toContain('Delete document');
  });

  it('names the document it is about', async () => {
    const { user } = renderDetail();

    await user.pointer({ target: header(), keys: '[MouseRight]' });

    // The label is what a screen reader announces on opening, and "Options" alone would
    // leave a reader who arrived by keyboard guessing which thing is about to be archived.
    expect(await screen.findByRole('menu', { name: 'Options for Runbook' })).toBeTruthy();
  });
});
