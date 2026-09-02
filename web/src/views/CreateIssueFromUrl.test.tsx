/**
 * `/new` reports on the composer rather than asserting one.
 *
 * The page used to render "The composer is open" from the first frame — before the replica
 * had a team to file into, and whether or not the shell accepted the request. On a slow first
 * sync that was a claim about a dialog nobody could see, and when a composer was already up
 * the shell dropped the seed and the page never mentioned it.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { CreateIssueProvider } from '~/features/issue/create-context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateIssueFromUrl } from './CreateIssueFromUrl';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const AT = '2026-01-01T00:00:00.000Z';

function store({ withTeam }: { withTeam: boolean }): Store {
  const replica = new Store(WORKSPACE);
  if (!withTeam) return replica;
  replica.applyChanges([
    {
      v: 1,
      type: 'team',
      id: TEAM,
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: TEAM,
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
      } as Entity,
    } as Change,
  ]);
  return replica;
}

function renderRoute(options: { withTeam: boolean; accepted: boolean }) {
  const engine = { store: store(options), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/new?title=Fix+the+flake']}>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <CreateIssueProvider value={{ open: () => options.accepted }}>
          <CreateIssueFromUrl />
        </CreateIssueProvider>
      </EngineProvider>
    </MemoryRouter>,
  );
}

describe('CreateIssueFromUrl', () => {
  it('says the composer is open only once it actually is', () => {
    renderRoute({ withTeam: true, accepted: true });

    expect(screen.getByText(/The composer is open/)).toBeTruthy();
  });

  it('waits visibly while the replica has no team to file into', () => {
    renderRoute({ withTeam: false, accepted: true });

    expect(screen.queryByText(/The composer is open/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Opening the composer');
  });

  it('says so when the shell dropped the request', () => {
    renderRoute({ withTeam: true, accepted: false });

    expect(screen.getByText('A composer is already open')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
