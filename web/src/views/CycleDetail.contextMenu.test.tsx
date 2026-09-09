/**
 * The cycle header's menu, whichever way it was opened.
 *
 * The ⋯ button and a right-click on the header render the same array, so the two cannot
 * drift apart. They did drift once: the detail screen built its own list and so lacked the
 * list screen's `Copy link` and favourites rows, which meant a cycle opened directly had
 * fewer things you could do to it than the same cycle in the list.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Cycle, Issue, Team, WorkflowState } from '~/store/types';
import type { SyncEngine } from '~/sync/engine';

import { CycleDetail } from './CycleDetail';

// The favourites row exists only when the screen knows who is looking at it, and the real
// hook asks the API for that. Every other screen's tests pin it the same way.
// The issue list under the header uses the rest of the module, so only the id is pinned.
vi.mock('~/hooks/useViewer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/hooks/useViewer')>()),
  useViewerId: () => 'u1',
}));

const WORKSPACE = 'w1';
const TEAM = 't1';
const AT = '2026-01-01T00:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

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

function team(): Team {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: true,
    cycleDurationWeeks: 2,
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
}

function cycle(id: string, name: string, startsAt: number, endsAt: number): Cycle {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: Number(id.replace(/\D/g, '')),
    name,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: category,
    color: '#888',
    category,
    position: id,
    isDefault: category === 'unstarted',
    isSystem: category === 'completed',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, cycleId: string, stateId: string, createdAt: number): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId,
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    cycleId,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: AT,
  };
}

function seeded(): Store {
  const now = Date.now();
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team()),
    upsert(2, 'workflowState', state('s-todo', 'unstarted')),
    upsert(3, 'cycle', cycle('cy1', 'Cycle 1', now - 20 * DAY, now - 7 * DAY)),
    upsert(4, 'cycle', cycle('cy2', 'Cycle 2', now - 5 * DAY, now + 5 * DAY)),
    upsert(5, 'cycle', cycle('cy3', 'Cycle 3', now + 8 * DAY, now + 21 * DAY)),
    upsert(6, 'issue', issue('i1', 'cy2', 's-todo', now - 3 * DAY)),
  ]);
  return store;
}

function mount(store: Store, cycleId = 'cy2', phase: 'idle' | 'hydrating' = 'idle') {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/cycle/${cycleId}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase }}>
          <Routes>
            <Route path="/cycle/:cycleId" element={<CycleDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate };
}

/** What a menu offers, in the order it offers it. */
function labels(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

afterEach(cleanup);

describe('CycleDetail header menu', () => {
  it('opens on a right-click of the header, not only from the ⋯ button', async () => {
    const { user } = mount(seeded());

    const header = screen.getByRole('banner', { name: 'Cycle' });
    await user.pointer({ target: header, keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for Cycle 2' });
    expect(labels(menu).length).toBeGreaterThan(0);
  });

  it('offers the same items in the same order whichever way it was opened', async () => {
    const kebab = mount(seeded());
    await kebab.user.click(screen.getByRole('button', { name: 'Options for Cycle 2' }));
    const fromKebab = labels(await screen.findByRole('menu', { name: 'Cycle options' }));
    cleanup();

    const right = mount(seeded());
    await right.user.pointer({
      target: screen.getByRole('banner', { name: 'Cycle' }),
      keys: '[MouseRight]',
    });
    const fromRightClick = labels(await screen.findByRole('menu', { name: 'Options for Cycle 2' }));

    expect(fromRightClick).toEqual(fromKebab);
  });

  it('carries the list screen’s Copy link and favourites rows, which it used to lack', async () => {
    const { user } = mount(seeded());

    await user.pointer({
      target: screen.getByRole('banner', { name: 'Cycle' }),
      keys: '[MouseRight]',
    });
    const menu = await screen.findByRole('menu', { name: 'Options for Cycle 2' });

    expect(labels(menu)).toContain('Copy link');
    expect(labels(menu)).toContain('Add to favourites');
    // Still the detail screen's own rows, so the shared builder replaced the list rather
    // than the menu.
    expect(labels(menu)).toContain('Edit cycle');
    expect(labels(menu)).toContain('Subscribe to cycle calendar');
    // `Open cycle` is the one list row that is dropped: this is the cycle it would open.
    expect(labels(menu)).not.toContain('Open cycle');
  });
});
