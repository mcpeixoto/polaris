/**
 * A team's home page, and the difference between a team that is not here and one that is
 * not here yet.
 *
 * `snapshot()` answers null for both, and on a cold boot it answers null for every team:
 * the shell mounts before the first snapshot lands. So a bookmarked team page told the user
 * "Nothing in this workspace has the key ENG" about a team that was on the wire. The gate is
 * what this file is here to hold in place; the retired banner is the other claim this screen
 * makes that must not regress.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Team } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { TeamHome } from './TeamHome';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function team(extra: Partial<Team> = {}): Team {
  return {
    id: 't1',
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
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
    ...extra,
  };
}

function mount(store: Store, status: EngineStatus = { phase: 'idle' }) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/team/ENG/home']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Routes>
            <Route path="/team/:teamKey/home" element={<TeamHome />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

function seeded(extra: Partial<Team> = {}): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'team',
      id: 't1',
      op: 'upsert',
      actor: { type: 'system' },
      payload: team(extra),
    } as Change,
  ]);
  return store;
}

afterEach(cleanup);

describe('TeamHome', () => {
  it('waits while the replica is still filling rather than denying the team exists', () => {
    mount(new Store(WORKSPACE), { phase: 'hydrating' });

    expect(screen.queryByText('No such team')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading the team');
  });

  it('says the team does not exist once the store has settled', () => {
    mount(new Store(WORKSPACE));

    expect(screen.getByText('No such team')).toBeTruthy();
    expect(screen.getByText(/has the key ENG/)).toBeTruthy();
  });

  it('draws the team once it arrives', () => {
    mount(seeded());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Engineering');
    expect(screen.getByRole('button', { name: 'New issue' })).toBeTruthy();
  });

  it('refuses to offer a new issue on a retired team', () => {
    mount(seeded({ retiredAt: AT }));

    // The composer drops retired teams from its picker, so the button would file the issue
    // into a different team than the page it was pressed on.
    expect(screen.queryByRole('button', { name: 'New issue' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('This team is retired');
  });
});
