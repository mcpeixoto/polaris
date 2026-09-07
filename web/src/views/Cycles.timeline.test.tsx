/**
 * The cycles timeline: the order the windows are read in, the word each wears, and where
 * the burn-up lives.
 *
 * The order is newest-first inside each of the three groups rather than across the whole
 * list, which is what splitting Current / Upcoming / Past means: the running window is at
 * the top because it is the one being asked about, not because it is the newest.
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
  it('reads the running window first, then newest-first inside each group', () => {
    mount(seeded());
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => text.startsWith('Cycle'));
    expect(names.map((text) => text.slice(0, 7))).toEqual([
      'Cycle 2',
      'Cycle 4',
      'Cycle 3',
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

  it('draws no burn-up on a window with nothing to chart, whatever its tense', () => {
    // Nothing is on any of these cycles, so no row has a series — and a row that cannot
    // chart itself says nothing rather than printing a paragraph about it.
    mount(seeded());
    for (const name of ['Cycle 1', 'Cycle 2', 'Cycle 3', 'Cycle 4']) {
      const row = screen.getByRole('link', { name: new RegExp(name) }).closest('[role="option"]');
      expect(row?.textContent).not.toContain('Not enough data');
    }
    expect(screen.queryByRole('region', { name: 'Cycle graph' })).toBeNull();
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
