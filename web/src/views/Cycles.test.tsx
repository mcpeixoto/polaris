/**
 * The cycles list: what each row says about its own window, which group it is read in,
 * what the keyboard does to it, and what it asks before it closes one.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Cycle, Issue, Team, WorkflowState } from '~/store/types';
import type { SyncEngine } from '~/sync/engine';

import { Cycles } from './Cycles';

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

function issue(id: string, cycleId: string, stateId: string, over: Partial<Issue> = {}): Issue {
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
    createdAt: new Date(Date.now() - 30 * DAY).toISOString(),
    updatedAt: AT,
    ...over,
  };
}

function seeded(): Store {
  const now = Date.now();
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team()),
    upsert(2, 'workflowState', state('s-todo', 'unstarted')),
    upsert(3, 'workflowState', state('s-done', 'completed')),
    upsert(4, 'cycle', cycle('cy1', 'Cycle 1', now - 20 * DAY, now - 7 * DAY)),
    upsert(5, 'cycle', cycle('cy2', 'Cycle 2', now - 5 * DAY, now + 5 * DAY)),
    upsert(6, 'cycle', cycle('cy3', 'Cycle 3', now + 8 * DAY, now + 21 * DAY)),
    upsert(
      7,
      'issue',
      issue('i1', 'cy1', 's-done', { completedAt: new Date(now - 10 * DAY).toISOString() }),
    ),
    upsert(8, 'issue', issue('i2', 'cy1', 's-todo')),
    upsert(
      9,
      'issue',
      issue('i3', 'cy2', 's-done', { completedAt: new Date(now - 1 * DAY).toISOString() }),
    ),
    upsert(10, 'issue', issue('i4', 'cy2', 's-todo')),
  ]);
  return store;
}

function mount(store: Store, phase: 'idle' | 'hydrating' = 'idle') {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/team/ENG/cycles']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase }}>
          <Routes>
            <Route path="/team/:teamKey/cycles" element={<Cycles />} />
            <Route path="/cycle/:cycleId" element={<p>opened</p>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

function row(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name) });
}

afterEach(cleanup);

describe('Cycles rows', () => {
  it('reports progress on the running and finished cycles, not a bare issue count', () => {
    mount(seeded());

    expect(
      within(row('Cycle 2')).getByRole('img', { name: /1 of 2 issues completed/ }),
    ).toBeTruthy();
    expect(
      within(row('Cycle 1')).getByRole('img', { name: /1 of 2 issues completed/ }),
    ).toBeTruthy();
    expect(screen.queryByText('2 issues')).toBeNull();
  });

  it('says how long the running cycle has left', () => {
    mount(seeded());
    expect(within(row('Cycle 2')).getByText(/days left/)).toBeTruthy();
  });

  it('keeps the capacity dial on the cycle that has not started', () => {
    mount(seeded());
    expect(within(row('Cycle 3')).getByRole('img', { name: /Capacity/ })).toBeTruthy();
  });
});

describe('Cycles while the replica is still filling', () => {
  it('waits rather than claiming the team does not exist', () => {
    mount(new Store(WORKSPACE), 'hydrating');

    expect(screen.queryByText('No such team')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading cycles');
  });
});

describe('Cycles “start cycle today”', () => {
  it('asks first, names what closes, and only then writes', async () => {
    const { mutate, user } = mount(seeded());

    await user.click(screen.getByRole('button', { name: 'Options for Cycle 3' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start cycle today' }));

    const dialog = await screen.findByRole('dialog', { name: 'Start Cycle 3 today?' });
    expect(dialog.textContent).toContain('Cycle 2 is completed immediately');
    expect(dialog.textContent).toContain('1 open issue moves into it');
    expect(mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Start cycle today' }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });
});

describe('Cycles groups', () => {
  it('splits the list into the three tenses a sprint list is read in', () => {
    mount(seeded());

    for (const name of ['Current', 'Upcoming', 'Past']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    // Each heading counts its own rows rather than the whole list.
    const past = screen.getByRole('button', { name: /^Past/ });
    expect(past.textContent).toContain('1');
  });

  it('charts a finished cycle, which is the window whose outcome is actually asked about', () => {
    mount(seeded());

    const previous = screen.getByRole('link', { name: /Cycle 1/ }).closest('[role="option"]');
    expect(
      within(previous as HTMLElement).getByRole('region', { name: 'Cycle graph' }),
    ).toBeTruthy();
  });
});

describe('Cycles empty states', () => {
  it('offers settings when the team has cycles switched off', () => {
    const store = new Store(WORKSPACE);
    store.applyChanges([upsert(1, 'team', { ...team(), cyclesEnabled: false })]);
    mount(store);

    expect(screen.getByText('Cycles are off')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Team settings' })).toBeTruthy();
  });

  it('says to wait when cycles are on and the cadence has not minted one', () => {
    const store = new Store(WORKSPACE);
    store.applyChanges([upsert(1, 'team', team())]);
    mount(store);

    expect(screen.getByText('No cycles yet')).toBeTruthy();
    // A wait is not a misconfiguration, so it is not given a settings button.
    expect(screen.queryByRole('button', { name: 'Team settings' })).toBeNull();
  });
});

describe('Cycles keyboard', () => {
  it('moves a cursor with j and k and opens the row under it', async () => {
    const { user } = mount(seeded());

    await user.keyboard('j');
    const rows = screen.getAllByRole('option');
    expect(rows[1]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('k');
    expect(screen.getAllByRole('option')[0]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('opened')).toBeTruthy());
  });

  it('opens the row menu on a right-click, not only from the ⋯ button', async () => {
    const { user } = mount(seeded());

    const row = screen.getByRole('link', { name: /Cycle 2/ }).closest('[role="option"]');
    await user.pointer({ target: row as HTMLElement, keys: '[MouseRight]' });

    expect(await screen.findByRole('menu', { name: 'Options for Cycle 2' })).toBeTruthy();
  });
});
