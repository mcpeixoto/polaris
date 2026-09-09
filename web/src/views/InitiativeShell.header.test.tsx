/**
 * The initiative header after the Linear pass: one row of chrome, the sections under it, and
 * a rail that stays hidden once somebody has hidden it.
 *
 * The three assertions are the three things the restructure could quietly lose. The trail,
 * the name and the actions have to be on the same row — the old header stacked a crumb row
 * over a title row and printed the name twice. The sections have to be a row of their own,
 * in the order Linear reads them. And the toggle has to write its answer down, because a
 * rail that comes back on every navigation is a control that does not work.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function mount() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'initiative', {
      id: INITIATIVE,
      workspaceId: WORKSPACE,
      name: NAME,
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  const view = render(
    <MemoryRouter initialEntries={[`/initiative/${INITIATIVE}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeShell />}>
              <Route index element={<InitiativeDetail />} />
            </Route>
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { view, user: userEvent.setup() };
}

function header(): HTMLElement {
  const found = screen.getByRole('heading', { name: NAME }).closest('header');
  if (found === null) throw new Error('the initiative header is not in the document');
  return found;
}

/**
 * A `localStorage` of this file's own, installed before every test.
 *
 * Under Node 25 the runner is started with `--localstorage-file`, which hands every worker in
 * the run *one shared store* rather than the per-file one jsdom gives. A fold this file writes
 * is then a fold another file reads, and a rail this file hides is a rail another file's
 * assertion cannot find — a failure that depends on which two workers happened to overlap.
 *
 * `features/view/collapse` goes through `window.localStorage`, so replacing that object keeps
 * what this file remembers inside this file. It is the same contract, backed by a map.
 */
function privateStorage(): void {
  const held = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return held.size;
      },
      key: (index: number) => [...held.keys()][index] ?? null,
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, String(value)),
      removeItem: (key: string) => void held.delete(key),
      clear: () => held.clear(),
    } satisfies Storage,
  });
}

beforeEach(privateStorage);

describe('the initiative header', () => {
  it('carries the trail, the name and the actions on one row', () => {
    mount();
    const row = header();

    expect(within(row).getByRole('link', { name: 'Initiatives' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Change initiative icon' })).toBeTruthy();
    expect((within(row).getByLabelText('Name') as HTMLTextAreaElement).value).toBe(NAME);
    expect(within(row).getByRole('button', { name: 'Add to favourites' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'More actions' })).toBeTruthy();
  });

  it('leaves the status to the body, where the rest of the properties are', () => {
    mount();

    expect(within(header()).queryByRole('button', { name: 'Planned' })).toBeNull();
    // Still on the page, just not in the header: the pill row and the rail both carry it.
    expect(screen.getAllByRole('button', { name: 'Planned' }).length).toBe(2);
  });

  it('names its sections in a row of their own, under the header', () => {
    mount();
    const sections = screen.getByRole('navigation', { name: 'Initiative sections' });

    expect(
      within(sections)
        .getAllByRole('link')
        .map((tab) => tab.textContent),
    ).toEqual(['Overview', 'Activity']);
    expect(header().contains(sections)).toBe(false);
  });
});

describe('the initiative rail toggle', () => {
  it('hides the rail, and it stays hidden on the next visit', async () => {
    const first = mount();
    expect(screen.getByRole('complementary', { name: 'Initiative properties' })).toBeTruthy();

    await first.user.click(screen.getByRole('button', { name: 'Hide properties' }));

    expect(screen.queryByRole('complementary', { name: 'Initiative properties' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Show properties' }).getAttribute('aria-pressed'),
    ).toBe('false');

    first.view.unmount();
    const second = mount();
    expect(screen.queryByRole('complementary', { name: 'Initiative properties' })).toBeNull();

    await second.user.click(screen.getByRole('button', { name: 'Show properties' }));
    expect(screen.getByRole('complementary', { name: 'Initiative properties' })).toBeTruthy();
  });
});
