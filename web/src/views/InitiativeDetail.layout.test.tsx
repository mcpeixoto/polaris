/**
 * The initiative overview's new shape: properties as a row of pills in the reading column,
 * the update card, the projects table, and the rollup in the rail rather than at the top of
 * the page.
 *
 * The properties are asserted as being in two places on purpose — the pill row and the rail
 * carry the same six facts, and the point of the pair is that neither is the only one. What
 * is worth holding is that they are not the same control twice in the same place: each opens
 * its own picker, and the row is outside the rail.
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
const AT = '2026-01-01T00:00:00.000Z';
/** Where the rail's folds are written. See `features/view/collapse`. */
const KEY = 'polaris.collapsedGroups:initiative.rail';

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
    upsert(1, 'projectStatus', {
      id: 's1',
      workspaceId: WORKSPACE,
      name: 'In progress',
      category: 'started',
      color: '#5e6ad2',
      position: 'a0',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'project', {
      id: 'p1',
      workspaceId: WORKSPACE,
      name: 'Alpha',
      description: '',
      statusId: 's1',
      icon: 'icon:cube',
      color: '#16a34a',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(3, 'initiative', {
      id: INITIATIVE,
      workspaceId: WORKSPACE,
      name: 'Platform reliability',
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(4, 'initiativeProject', {
      id: 'ip1',
      workspaceId: WORKSPACE,
      initiativeId: INITIATIVE,
      projectId: 'p1',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(5, 'issue', {
      id: 'is1',
      workspaceId: WORKSPACE,
      teamId: 't1',
      number: 1,
      identifier: 'ENG-1',
      title: 'Page less',
      description: '',
      stateId: 'st1',
      priority: 0,
      projectId: 'p1',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
  ]);
  return store;
}

function mount() {
  const engine = {
    store: seeded(),
    mutate: vi.fn().mockResolvedValue({}),
  } as unknown as SyncEngine;
  render(
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
  return { user: userEvent.setup() };
}

function rail(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Initiative properties' });
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

describe('the initiative reading column', () => {
  it('opens on the properties, as pills outside the rail', async () => {
    const { user } = mount();
    const pills = screen
      .getAllByRole('button', { name: 'Planned' })
      .filter((pill) => !rail().contains(pill));
    expect(pills).toHaveLength(1);

    await user.click(pills[0]!);
    expect(screen.getByRole('menuitem', { name: 'Active' })).toBeTruthy();
  });

  it('invites the first update rather than heading an empty space', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Write first initiative update' })).toBeTruthy();
    // The composer is open beneath it: the reason an initiative has no updates is never
    // that somebody could not find the form.
    expect(screen.getByLabelText('Health')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Post update' })).toBeTruthy();
  });

  it('draws a contributing project with its own icon, health, lead and progress', () => {
    mount();
    const row = screen.getByRole('link', { name: 'Alpha' }).closest('li');
    if (row === null) throw new Error('the project row is not in the document');

    expect(row.querySelector('[data-icon="cube"]')).toBeTruthy();
    expect(within(row).getByText('No update')).toBeTruthy();
    expect(within(row).getByText('No lead')).toBeTruthy();
    expect(within(row).getByLabelText('Alpha: 0 of 1 issues completed, 0%')).toBeTruthy();
  });
});

describe('the initiative rail', () => {
  it('counts the projects and draws the rollup', () => {
    mount();
    const progress = within(rail()).getByRole('region', { name: 'Progress' });

    expect(within(progress).getByText('Projects').nextElementSibling?.textContent).toBe('1');
    expect(within(progress).getByText('Started').nextElementSibling?.textContent).toBe('1');
    expect(within(progress).getByText('Completed').nextElementSibling?.textContent).toBe('0');
    expect(
      within(progress).getByLabelText('Platform reliability: 0 of 1 issues completed, 0%'),
    ).toBeTruthy();
    expect(within(progress).getByRole('img', { name: /Initiative graph/ })).toBeTruthy();
  });

  it('names every property beside the control that sets it', () => {
    mount();
    for (const label of [
      'Icon',
      'Status',
      'Priority',
      'Owner',
      'Target date',
      'Lead team',
      'Labels',
    ]) {
      expect(within(rail()).getByText(label)).toBeTruthy();
    }
  });

  it('folds a section away, writes the fold down, and unfolds it again', async () => {
    const { user } = mount();
    const fold = () => within(rail()).getByRole('button', { name: 'Progress' });

    await user.click(fold());
    expect(within(rail()).queryByRole('img', { name: /Initiative graph/ })).toBeNull();
    expect(window.localStorage.getItem(KEY)).toContain('progress');

    await user.click(fold());
    expect(within(rail()).getByRole('img', { name: /Initiative graph/ })).toBeTruthy();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
