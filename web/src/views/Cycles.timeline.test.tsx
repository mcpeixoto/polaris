/**
 * The cycles timeline: the order the windows are read in, the word each wears, and where
 * the burn-up lives.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Cycle, Team } from '~/store/types';
import type { SyncEngine } from '~/sync/engine';

import { Cycles, cycleChip } from './Cycles';

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
    icon: '🛠️',
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

function seeded(): Store {
  const now = Date.now();
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team()),
    upsert(2, 'cycle', cycle('cy1', 'Cycle 1', now - 20 * DAY, now - 7 * DAY)),
    upsert(3, 'cycle', cycle('cy2', 'Cycle 2', now - 5 * DAY, now + 5 * DAY)),
    upsert(4, 'cycle', cycle('cy3', 'Cycle 3', now + 8 * DAY, now + 21 * DAY)),
    upsert(5, 'cycle', cycle('cy4', 'Cycle 4', now + 22 * DAY, now + 35 * DAY)),
  ]);
  return store;
}

function mount(store: Store) {
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/team/ENG/cycles']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey/cycles" element={<Cycles />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Cycles timeline', () => {
  it('reads newest first: planned, upcoming, current, completed', () => {
    mount(seeded());
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => text.startsWith('Cycle'));
    expect(names.map((text) => text.slice(0, 7))).toEqual([
      'Cycle 4',
      'Cycle 3',
      'Cycle 2',
      'Cycle 1',
    ]);
  });

  it('wears the tense on each row, with only the next window called Upcoming', () => {
    mount(seeded());
    expect(within(screen.getByRole('link', { name: /Cycle 4/ })).getByText('Planned')).toBeTruthy();
    expect(
      within(screen.getByRole('link', { name: /Cycle 3/ })).getByText('Upcoming'),
    ).toBeTruthy();
    expect(within(screen.getByRole('link', { name: /Cycle 2/ })).getByText('Current')).toBeTruthy();
    expect(
      within(screen.getByRole('link', { name: /Cycle 1/ })).getByText('Completed'),
    ).toBeTruthy();
  });

  it('says how much of the window is scope, not how many issues it has', () => {
    mount(seeded());
    expect(within(screen.getByRole('link', { name: /Cycle 2/ })).getByText('0 scope')).toBeTruthy();
    expect(screen.queryByText(/issues$/)).toBeNull();
  });

  it('opens the burn-up under the current row only', () => {
    mount(seeded());
    const current = screen.getByRole('link', { name: /Cycle 2/ }).closest('li');
    expect(current?.textContent).toContain('Not enough data to chart this cycle yet.');
    const previous = screen.getByRole('link', { name: /Cycle 1/ }).closest('li');
    expect(previous?.textContent).not.toContain('Not enough data');
  });

  it('puts the team in the breadcrumb', () => {
    mount(seeded());
    expect(screen.getByRole('heading', { name: /Engineering.*Cycles/ })).toBeTruthy();
  });
});

describe('cycleChip', () => {
  it('maps the three phases onto Linear’s four words', () => {
    expect(cycleChip('Current', false)).toBe('Current');
    expect(cycleChip('Previous', false)).toBe('Completed');
    expect(cycleChip('Upcoming', true)).toBe('Upcoming');
    expect(cycleChip('Upcoming', false)).toBe('Planned');
  });
});
