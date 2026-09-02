/**
 * The cycles list: what each row says about its own window, and what it asks before it
 * closes one.
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
