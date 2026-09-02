/**
 * The cycle header: which window this is, how far through it is, and the way to the one
 * either side of it — by pointer and by key.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Cycle, Team, WorkflowState } from '~/store/types';
import type { SyncEngine } from '~/sync/engine';

import { CycleDetail } from './CycleDetail';

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

function seeded(): Store {
  const now = Date.now();
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team()),
    upsert(2, 'workflowState', state('s-todo', 'unstarted')),
    upsert(3, 'cycle', cycle('cy1', 'Cycle 1', now - 20 * DAY, now - 7 * DAY)),
    upsert(4, 'cycle', cycle('cy2', 'Cycle 2', now - 5 * DAY, now + 5 * DAY)),
    upsert(5, 'cycle', cycle('cy3', 'Cycle 3', now + 8 * DAY, now + 21 * DAY)),
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
  return { user: userEvent.setup() };
}

afterEach(cleanup);

describe('CycleDetail header', () => {
  it('says which window this is, what phase it is in and how long is left', () => {
    mount(seeded());

    const header = screen.getByRole('banner', { name: 'Cycle' });
    expect(within(header).getByRole('heading', { name: 'Cycle 2' })).toBeTruthy();
    expect(header.textContent).toContain('Current');
    expect(header.textContent).toMatch(/days left|Ends today/);
  });

  it('steps to the cycle before and after this one', async () => {
    const { user } = mount(seeded());

    await user.click(screen.getByRole('button', { name: 'Previous cycle' }));
    await waitFor(() =>
      expect(screen.getByRole('banner', { name: 'Cycle' }).textContent).toContain('Cycle 1'),
    );
  });

  it('has nowhere to step back to from the first cycle', () => {
    mount(seeded(), 'cy1');
    // IconButton stays focusable and says why rather than going inert, so the fact lives on
    // aria-disabled.
    expect(
      screen.getByRole('button', { name: 'Previous cycle' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('steps from the keyboard, through the registry rather than a local listener', async () => {
    const { user } = mount(seeded());

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('banner', { name: 'Cycle' }).textContent).toContain('Cycle 3'),
    );
  });
});

describe('CycleDetail while the replica is still filling', () => {
  it('waits rather than saying the cycle does not exist', () => {
    mount(new Store(WORKSPACE), 'cy2', 'hydrating');

    expect(screen.queryByText('No such cycle')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading cycle');
  });

  it('says so once the store has settled and it really is not there', () => {
    mount(new Store(WORKSPACE), 'cy2');
    expect(screen.getByText('No such cycle')).toBeTruthy();
  });
});
